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
warmups = [s for s in report['samples'] if s['warmup'] and s.get('passed')]
assert len(warmups) == 2 and {s['side'] for s in warmups} == {'control', 'candidate'}
assert report['artifacts']['control']['source'] == 'e0b2192c26f6b921b9fb5e24c94be358c508c052'
assert report['artifacts']['candidate']['source'] == 'bce320418a694bc48f25a609217bb81861ee6e47'
assert all(a['runtimeManifestSha256'] == 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c' for a in report['artifacts'].values())


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
labels = {
    'navigation-restored': 'Navigation → first decoded restored 1024px original',
    'new-face-face-1': 'First new face after browser reopen; retained model bytes',
    'new-face-face-2': 'Next different face in the session',
    'first-download': 'First Save after both faces; browser download complete',
    'repeat-original': 'Same original requested again',
    'repeat-download': 'Repeat Save of the prepared file',
    'video32': 'New 32-frame / 16 FPS / 1024px decoded playable video',
    'photo-first': 'First metadata-free RGB-offset photo after reopen',
    'photo-next': 'Next different RGB-offset photo; encoder required',
    'photo-download': 'Save reconstructed photo; browser download complete',
}
lines = ['# Paired built-UI screen — 10 October 2026', '',
         f"[Successful campaign {analysis['workflowRun']}](https://github.com/check-face/facemorph.me/actions/runs/{analysis['workflowRun']}) compares exact qualified `e0b2192` and `bce3204` artifacts. [Raw report](ci-built-ui.json) · [descriptive statistics](built-ui-analysis.json) · [analysis recipe](analyze-built-ui.py).",
         '', 'Ubuntu 24.04 hosted CPU (processor model not recorded), headless Chrome 155 / Playwright 1.55, visible isolated persistent profiles reopened each visit; fixed discarded warmup per side, then ABBA ×3, six matched cases per side. Model bytes and photo assets are retained. Pinned local runtime mirror; this is not a network benchmark. Webdriver remains true; ordinary-user admission is explicitly emulated. Artifact receipts, source hashes, fixture hashes, input hashes, order and load are retained in the raw report.',
         '', '| Journey / observable finish | Control median | Candidate median | Median matched change | Faster cases |',
         '| --- | --- | --- | --- | --- |']
for name, row in analysis['timings'].items():
    lines.append(f"| {labels[name]} | {row['control']['median']:,.2f} ms | {row['candidate']['median']:,.2f} ms | {row['pairedPercentChange']['median']:+.2f}% | {row['candidateFasterCases']}/6 |")
lines += ['', 'Matched change is the median of the six candidate-minus-control percentages; it is not the ratio of the two pooled medians. These are descriptive fixed-screen results, not population percentiles, current-user latency or physical-device estimates. Drawn/decoded-and-idle is not compositor paint; decoded playable media is not OS sharing.',
          '', '## Download sizes', '', '| Download | Control median | Candidate median |', '| --- | --- | --- |']
for name, sides in analysis['bytes'].items():
    lines.append(f"| {labels[name]} | {sides['control']['median']:,.0f} B | {sides['candidate']['median']:,.0f} B |")
lines += ['', 'Sizes include recovery metadata. Download completion includes the browser handoff and file generation, excludes OS/recipient delivery. The first Save occurs after both faces have generated; it is not an immediate-after-first-display file-ready measurement. Exact Chrome product qualification separately checks WebP recovery and repeated-file reuse.',
          '', '## Stage interpretation and limits', '',
          'Photo inputs are deterministic RGB-offset versions of one public face, encoded outside timing. Both sides use the same pixels per case; first/next variants differ and execute the encoder. The warp/padding path is content-dependent and can differ by orders of magnitude between cases. Do not treat a pooled photo or warp median as typical real-photo performance. Full per-case timings and inputs remain in the reports.',
          '', 'Worker events lack request IDs and may overlap resumed background admission. Stage figures are exploratory timestamp spans or worker-reported totals; they cannot be added or subtracted to attribute the UI total. No isolated synthesis speed claim follows from this trace. Internal memory/surfaces, physical-device budgets, OS sharing, FFmpeg-specific speed and varied real-photo quality remain unmeasured.',
          '', 'The [earlier timeout](built-ui-timeout.json) is inconclusive and is not merged with this fresh campaign. Numerical kernels are unchanged; seven original canaries plus synthetic raw/canonical agreement and the separate shipping checks do not constitute a new fixed-full31 qualification.', '']
(root / 'built-ui-analysis.md').write_text('\n'.join(lines))
for name, row in analysis['timings'].items():
    print(name, 'control', round(row['control']['median'], 2), 'candidate', round(row['candidate']['median'], 2),
          'paired delta', round(row['pairedDeltaCandidateMinusControl']['median'], 2),
          'faster', row['candidateFasterCases'])
for name, row in analysis['bytes'].items():
    print(name, 'bytes', {side: row[side]['median'] for side in row})
print('stages', json.dumps(analysis['stages']))
