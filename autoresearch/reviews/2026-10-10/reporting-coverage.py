#!/usr/bin/env python3
"""Read consented diagnostics in memory; emit only non-identifying cohort aggregates."""
import argparse
import collections
import concurrent.futures
import datetime
import json
import pathlib
import statistics
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--window-start', required=True, help='ISO UTC receipt boundary')
parser.add_argument('--live-build', required=True, help='Build ID verified in live application bytes')
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[3]
bucket = 'facemorph-diagnostics'


def request(arguments):
    result = subprocess.run(
        ['cf', 'r2', 'objects', *arguments, '--bucket-name', bucket],
        cwd=root / 'hosting/next-static', capture_output=True, text=True,
        check=True, timeout=45,
    )
    return json.loads(result.stdout)


def distribution(values):
    return {'n': len(values), 'min': min(values), 'median': statistics.median(values),
            'max': max(values)} if values else None


objects = request(['list', '--prefix', 'runs/', '--per-page', '1000'])
if not isinstance(objects, list) or len(objects) >= 1000:
    raise RuntimeError('Bounded listing may be truncated; paginate before claiming coverage')
selected = [row for row in objects if row['last_modified'] >= args.window_start]
by_run = collections.defaultdict(list)
expired = 0
now = datetime.datetime.now(datetime.timezone.utc)


def read(row):
    return request(['get', row['key'], '--text'])


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for events in pool.map(read, selected):
        for event in events:
            expiry = datetime.datetime.fromisoformat(event['expiresAt'].replace('Z', '+00:00'))
            if expiry <= now:
                expired += 1
                continue
            by_run[event['run']].append(event)

cohorts = collections.defaultdict(list)
for events in by_run.values():
    starts = [event for event in events if event.get('event') == 'start']
    context = starts[0] if starts else {}
    routes = tuple(sorted({event.get('provider') for event in events
                           if event.get('provider') in ['cpu', 'webgl', 'webgl2', 'webgpu', 'native-cpu', 'native-gpu']}))
    identity = (*tuple(context.get(field) for field in
                       ['build', 'platform', 'browser', 'browserMajor', 'action', 'provider']), routes)
    cohorts[identity].append(events)

summaries = []
for identity, runs in cohorts.items():
    terminal_counts = collections.Counter()
    completions = []
    multiple_terminals = 0
    cache_hits = load_runs = 0
    stages = collections.defaultdict(list)
    for events in runs:
        terminal = [event for event in events if event.get('event') in
                    ['completed', 'failed', 'cancelled', 'interrupted']]
        terminal_counts.update(event['event'] for event in terminal)
        multiple_terminals += len(terminal) > 1
        completions.extend(event['elapsedMs'] for event in terminal
                           if event['event'] == 'completed' and 'elapsedMs' in event)
        cache_hits += any(event.get('stage') == 'original-cache-hit' for event in events)
        load_runs += any(event.get('stage') == 'model-loaded' for event in events)
        for event in events:
            if event.get('stage') in ['model-loaded', 'alignment-complete',
                                     'encoder-loaded', 'encoding-complete', 'synthesis-complete']:
                value = event.get('stageMs')
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    stages[event['stage']].append(value)
    summaries.append({
        **dict(zip(['build', 'platform', 'browser', 'browser_major', 'action', 'requested_route'], identity[:6])),
        'observed_provider_values': list(identity[6]),
        'matches_live_build': identity[0] == args.live_build,
        'run_ids': len(runs), 'terminal_events': dict(terminal_counts),
        'run_ids_with_multiple_terminal_events': multiple_terminals,
        'run_ids_with_original_cache_hit': cache_hits,
        'run_ids_with_model_loaded': load_runs,
        'completed_job_ms': distribution(completions),
        'reported_stage_ms': {stage: distribution(values) for stage, values in stages.items()},
    })

report = {
    'schema_version': 2, 'queried_at_utc': now.isoformat(), 'source': 'Private consented diagnostics R2',
    'live_build': args.live_build, 'receipt_window_start': args.window_start,
    'receipt_window_end': max((row['last_modified'] for row in selected), default=None),
    'listed_objects': len(objects), 'selected_objects': len(selected),
    'run_ids': len(by_run),
    'run_ids_without_start_in_window': sum(not any(event.get('event') == 'start'
                                                  for event in events)
                                           for events in by_run.values()),
    'expired_events_excluded': expired,
    'limitations': [
        'R2 only; excludes KV fallback and GA4. Receipt time can differ from execution time.',
        'Stage events can include canaries, endpoints and loading; they are not warm frame throughput.',
        'Cohorts retain requested route and observed provider values separately; observed values alone do not establish successful admission or exclude fallback.',
        'No exact GPU/physical device, workload settings or cache-state inference from platform alone.',
        'Completed job timer is not a decoded-image or playable-video timestamp.',
        'Multiple terminal events are not independent requests; no outcome rate is computed.',
        'Raw events, run/device/session IDs and storage object keys are never written to output.',
    ],
    'cohorts': sorted(summaries, key=lambda item: str((item['build'], item['platform'],
                                                    item['browser_major'], item['action']))),
}
pathlib.Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'output': args.output, 'selected_objects': len(selected),
                  'run_ids': len(by_run), 'matching_live_build_run_ids':
                  sum(item['run_ids'] for item in summaries if item['matches_live_build'])}))
