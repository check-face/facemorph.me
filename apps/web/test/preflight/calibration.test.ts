import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CalibrationScope, EstimatedStage } from '../../src/contracts/preflight.ts';
import { estimateJob, estimateStage, heldOutErrors } from '../../src/preflight/calibration.ts';
import { init } from '../../src/controller/init.ts';
import { estimate as productEstimate, perFrameText } from '../../src/controller/derived.ts';
import type {
  CalibrationContext,
  PairedMeasurement,
  StageRequest,
} from '../../src/preflight/calibration.ts';

const evidence = JSON.parse(
  readFileSync(new URL('../../src/preflight/calibration-v1.json', import.meta.url), 'utf8'),
);
const measured = evidence.measurements as PairedMeasurement[];
const row = measured[0]!;
const request: StageRequest = { stage: row.stage, scope: row.scope, units: 1 };
const context: CalibrationContext = {
  profile: row.profile,
  checkerUnitMs: row.checkerUnitMs,
  nowMs: Date.parse(row.at) + 1000,
};

test('versioned paired evidence binds every measurement to device, browser, build and model', (t) => {
  assert.equal(evidence.schema, 'facemorph-calibration/1');
  assert.equal(evidence.threshold, 'measured, no threshold');
  assert.equal(measured.filter((r) => r.partition === 'training').length, 3);
  assert.equal(measured.filter((r) => r.partition === 'held-out').length, 2);
  assert.equal(new Set(measured.map((r) => r.id)).size, measured.length);
  for (const input of evidence.measurements) {
    const provenance = evidence.provenance[input.provenanceKey];
    assert.ok(provenance.device.cpu && provenance.device.hostname && provenance.browser.version);
    assert.match(provenance.artifact.source.commit, /^[a-f0-9]{40}$/);
    assert.match(provenance.artifact.digest, /^[a-f0-9]{64}$/);
    assert.equal(provenance.runtimeSha256, input.scope.runtime);
    assert.equal(provenance.model.modelSourceSha256, input.scope.checkpoint);
    assert.equal(input.checker.outcome, 'ok');
    assert.equal(input.checker.resourcesRemaining, 0);
    assert.equal(input.durationMs, input.workerSynthesis.at(-1).elapsedMs);
    assert.equal(input.journey.typedExactly, true);
    assert.match(input.journey.documentSha256, /^[a-f0-9]{64}$/);
    assert.ok(input.checkerUnitMs > 0 && input.durationMs > 0);
    assert.ok(provenance.implementationAssets.length >= 3);
  }
  for (const result of heldOutErrors(measured)) {
    assert.ok(Number.isFinite(result.relativeError));
    t.diagnostic(JSON.stringify(result));
  }
  for (const cell of evidence.platformCells) {
    assert.equal(
      cell.status === 'tested',
      cell.cell === 'eris-cpu' && cell.stage === 'synthesis-per-output',
    );
    if (cell.status !== 'tested') assert.equal(cell.measurementIds.length, 0);
  }
});

test('recent compatible actual timings precede calibration and comparable-device data', () => {
  assert.equal(
    estimateStage(request, { ...context, device: 'eris', allowComparable: true }, measured)?.source,
    'recent-actual-device',
  );
  assert.equal(estimateStage(request, context, measured)?.source, 'calibrated-local-check');
  assert.equal(
    estimateStage(request, { ...context, checkerUnitMs: 1e6, allowComparable: true }, measured)
      ?.source,
    'comparable-device',
  );
  assert.equal(estimateStage(request, { ...context, checkerUnitMs: 1e6 }, measured), null);
  assert.equal(
    estimateStage(
      request,
      { ...context, device: 'eris', nowMs: Date.parse(row.at) - 1, checkerUnitMs: 1e6 },
      measured,
    ),
    null,
  );
});

test('every scope key, compatibility profile and missing stage can withhold the cost/copy range', () => {
  for (const [key, value] of Object.entries({
    checkpoint: 'other',
    resolution: 512,
    provider: 'webgpu',
    runtime: 'other',
    threadMode: 'single',
    workload: 'morph-frame',
  })) {
    const scope = { ...row.scope, [key]: value } as CalibrationScope;
    assert.equal(estimateJob([{ ...request, scope }], context, measured).rangeMs, null, key);
  }
  assert.equal(
    estimateStage(request, { ...context, profile: 'another browser/CPU' }, measured),
    null,
  );
  for (const stage of [
    'photo-preprocessing',
    'e4e-per-confirmed-crop',
    'model-load-and-check',
    'video-export',
  ] as const)
    assert.equal(
      estimateJob([{ ...request, stage }], context, measured).kind,
      'no-reliable-estimate',
    );
  assert.equal(
    estimateJob([request, { ...request, stage: 'video-export' }], context, measured).rangeMs,
    null,
  );
});

test('multi-stage jobs compose each stage separately, and held-out values never fit', () => {
  // Synthetic distinct-stage data isolates composition; the committed evidence above remains real.
  const stage: EstimatedStage = 'video-export';
  const exportRows = measured.map<PairedMeasurement>((r) => ({
    ...r,
    stage,
    durationMs: r.durationMs * 20,
  }));
  const rows = [...measured, ...exportRows];
  const synthesis = estimateStage(request, context, rows)!;
  const encoding = estimateStage({ ...request, stage }, context, rows)!;
  const job = estimateJob(
    [
      { ...request, units: 3 },
      { ...request, stage, units: 2 },
    ],
    context,
    rows,
  );
  assert.deepEqual(job.rangeMs, [
    synthesis.rangeMs[0] * 3 + encoding.rangeMs[0] * 2,
    synthesis.rangeMs[1] * 3 + encoding.rangeMs[1] * 2,
  ]);
  const poisoned = measured.map((r) =>
    r.partition === 'held-out' ? { ...r, durationMs: 1e9 } : r,
  );
  assert.deepEqual(
    estimateStage(request, context, poisoned),
    estimateStage(request, context, measured),
  );
  assert.equal(estimateJob([{ ...request, units: -1 }], context, rows).rangeMs, null);
});

test('the existing product copy builder withholds uncalibrated costs and measured-device wording', () => {
  const state = init({
    today: '2026-10-27',
    url: 'https://next.facemorph.me/',
    consentAnswered: false,
    sliderPreference: false,
    sliderPosition: 1,
  }).state;
  const unknown = estimateJob([{ ...request, stage: 'video-export' }], context, measured);
  assert.equal(unknown.kind, 'no-reliable-estimate');
  const facts = {
    faceMs: unknown.rangeMs?.[1] ?? null,
    frameMs: null,
    videoMs: null,
    plannedFrames: 32,
  };
  // Product.tsx renders its measured-device estimate only when this public builder returns a value.
  assert.equal(productEstimate(state, facts), null);
  assert.equal(perFrameText(facts), '');
  // A calibration is not an actual timing on the visitor's device: it must not acquire that label.
  const calibrated = estimateStage(request, context, measured)!;
  const actualFacts = {
    ...facts,
    faceMs: calibrated.source === 'recent-actual-device' ? calibrated.rangeMs[1] : null,
  };
  assert.equal(productEstimate(state, actualFacts), null);
  assert.equal(perFrameText(actualFacts), '');
});
