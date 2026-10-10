#!/usr/bin/env python3
"""Validate the frozen paired screen and retain descriptive matched statistics."""
import collections
import hashlib
import json
import pathlib
import statistics
import sys

root = pathlib.Path(__file__).resolve().parent
raw = root / 'ci-built-ui.json'
report = json.loads(raw.read_text())
assert report['passed'] and not report['errors'], 'Incomplete screen is inconclusive'
samples = [s for s in report['samples'] if not s['warmup']]
assert len(samples) == 12
assert [s['side'] for s in samples] == ['control', 'candidate', 'candidate', 'control'] * 3
assert len([s for s in report['samples'] if s['warmup'] and s.get('passed')]) == 2


def distribution(values):
    return {'n': len(values), 'min': min(values), 'median': statistics.median(values),
            'max': max(values), 'samples': values}


paired = collections.defaultdict(dict)
steps = collections.defaultdict(lambda: collections.defaultdict(dict))
stages = collections.defaultdict(lambda: collections.defaultdict(list))
for sample in samples:
    side, case = sample['side'], sample['caseId']
    assert sample['passed'] and not sample.get('pageErrors')
    assert sample['navigation']['visibility'] == 'visible'
    assert sample['navigation']['isolation'] and sample['navigation']['webdriver']
    assert sample['loadBefore'][0] <= 4 and sample['loadAfter'][0] <= 4
    assert sample['navigation']['workers'] == 0
    assert sample['navigation']['restoredDecodedMs'] is not None
    paired[case][side] = sample
    for step in sample['steps']:
        assert step['passed'] and step['ms'] > 0
        assert 'CPU' in step['route']
        steps[step['name']][case][side] = step
        if step['name'] in ['repeat-original', 'repeat-download']:
            assert step['newWorkers'] == 0 and not step['events']
        if step['name'].startswith('photo-') and step['name'] != 'photo-download':
            assert any(e.get('posted') == 'encode-aligned' for e in step['events'])
            assert any(e.get('stage') == 'encoding-complete' for e in step['events'])
        for event in step['events']:
            if event.get('stage') in ['model-loaded', 'encoder-loaded', 'encoding-complete']:
                stages[step['name'] + '/' + event['stage']][side].append(event['elapsedMs'])
        if step['name'] in ['photo-first', 'photo-next']:
            # Timestamp spans are elapsed wall intervals, not isolated CPU costs.
            for stage in ['alignment-manifest', 'alignment-runtime', 'alignment-model',
                          'alignment-model-deserialize', 'photo-decode',
                          'face-landmarks', 'photo-warp-resize']:
                start = [e['at'] for e in step['events'] if e.get('stage') == stage]
                finish = [e['at'] for e in step['events'] if e.get('stage') == stage + '-complete']
                assert len(start) == len(finish) == 1 and finish[0] >= start[0], stage
                stages[step['name'] + '/' + stage + '-wall'][side].append(finish[0] - start[0])
            posted = {e['posted']: e['at'] for e in step['events'] if e.get('posted') in ['align', 'encode-aligned', 'synthesize']}
            assert set(posted) == {'align', 'encode-aligned', 'synthesize'}
            for name, start, finish in [('alignment-handoff-wall', 'align', 'encode-aligned'),
                                        ('encoder-handoff-wall', 'encode-aligned', 'synthesize')]:
                assert posted[finish] >= posted[start]
                stages[step['name'] + '/' + name][side].append(posted[finish] - posted[start])
    assert sample['video']['width'] == sample['video']['height'] == 1024
    assert abs(sample['video']['duration'] - 2) < .05 and sample['video']['readyState'] >= 2

for case, sides in paired.items():
    assert set(sides) == {'control', 'candidate'}
    for name in ['photo-first', 'photo-next']:
        assert steps[name][case]['control']['inputSha256'] == steps[name][case]['candidate']['inputSha256']
    for side in sides:
        assert steps['photo-first'][case][side]['inputSha256'] != steps['photo-next'][case][side]['inputSha256']
        assert steps['first-download'][case][side]['sha256'] == steps['repeat-download'][case][side]['sha256']

analysis = {'rawSha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
            'workflowRun': int(sys.argv[1]), 'artifacts': report['artifacts'],
            'policy': report['policy'], 'loadBefore': report['loadBefore'],
            'loadAfter': report['loadAfter'], 'timings': {}, 'bytes': {}, 'stages': {},
            'limits': 'Descriptive n=6 matched cases per side; not population percentiles or current-user latency. Stage reports may overlap background admission/other requests; no synthesis-stage subtraction or additive attribution. Process/GPU/codec memory and OS delivery unmeasured.'}


def compare(pairs):
    ordered = [pairs[case] for case in sorted(pairs)]
    controls = [p['control'] for p in ordered]
    candidates = [p['candidate'] for p in ordered]
    delta = [p['candidate'] - p['control'] for p in ordered]
    return {'control': distribution(controls), 'candidate': distribution(candidates),
            'pairedDeltaCandidateMinusControl': distribution(delta),
            'pairedPercentChange': distribution([100 * d / c for d, c in zip(delta, controls)]),
            'candidateFasterCases': sum(d < 0 for d in delta)}


analysis['timings']['navigation-restored'] = compare({case: {side: s['navigation']['restoredDecodedMs'] for side, s in sides.items()} for case, sides in paired.items()})
for name, cases in steps.items():
    analysis['timings'][name] = compare({case: {side: s['ms'] for side, s in sides.items()} for case, sides in cases.items()})
    if 'download' in name:
        analysis['bytes'][name] = {side: distribution([cases[c][side]['bytes'] for c in sorted(cases)]) for side in ['control', 'candidate']}
for name, sides in stages.items():
    analysis['stages'][name] = {side: distribution(values) for side, values in sides.items()}

(root / 'built-ui-analysis.json').write_text(json.dumps(analysis, indent=2) + '\n')
for name, row in analysis['timings'].items():
    print(name, 'control', round(row['control']['median'], 2), 'candidate', round(row['candidate']['median'], 2),
          'paired delta', round(row['pairedDeltaCandidateMinusControl']['median'], 2),
          'faster', row['candidateFasterCases'])
for name, row in analysis['bytes'].items():
    print(name, 'bytes', {side: row[side]['median'] for side in row})
print('stages', json.dumps(analysis['stages']))
