// App contracts (fm-s9n): exports, tile action table, batch walkthroughs, progress, recovery classification
// vectors, scheduler walkthroughs, preflight cases and payload fuzzing. Plain values in, plain values out;
// the recovery cases read the candidate-written still fixtures through stylegan-js's real reader.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { embedRecovery, readRecovery } from 'stylegan-js';
import * as api from '../../src/contracts/index.ts';
import {
  PREFLIGHT_BUDGETS,
  advance,
  allocateKeypoints,
  allows,
  applyClick,
  classifyRecovery,
  eligibility,
  estimateFrom,
  initialScheduler,
  overlapCost,
  parseBatchSelection,
  retrySlot,
  schedule,
  validateWords,
  type BatchSelection,
  type CandidateId,
  type CommandsOf,
  type InputRevision,
  type PreflightEvidence,
  type ProviderContextId,
  type SchedulerAction,
  type SchedulerEvent,
  type SchedulerState,
  type TileActionState,
} from '../../src/contracts/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const is = <T extends true>(): T => true as T;

const VALUES = [
  'SEED_RANGE',
  'WORDS_MAX_UTF8_BYTES',
  'validateWords',
  'validSeed',
  'nextRevision',
  'allows',
  'applyClick',
  'allocateKeypoints',
  'retrySlot',
  'parseBatchSelection',
  'holdPixels',
  'releasePixels',
  'COMPLETION_BOUNDARIES',
  'advance',
  'overlapCost',
  'classifyRecovery',
  'MAX_HEAVY_OPS_PER_PROVIDER_CONTEXT',
  'SOURCE_RGBA_MAX_BYTES',
  'RESIDENCY_OF',
  'tearsDownBetweenPhases',
  'schedule',
  'initialScheduler',
  'PREFLIGHT_BUDGETS',
  'estimateFrom',
  'eligibility',
  'EXPORT_KINDS',
  'SUFFIX_ALPHABET',
  'SUFFIX_LENGTH',
  'SUFFIX_MAX_LENGTH',
  'FILENAME_MAX_STEM',
  'ExportNameCollision',
  'exportIdentityDigest',
  'exportIdentity',
  'sanitizeLabel',
  'labelFromSource',
  'withEditedName',
  'suggestFilename',
  'decideWrite',
  'preparedFileCacheMaxBytes',
  'preparedFileKey',
  'planCacheInsert',
  'touchCacheEntry',
  'pinCacheEntry',
  'lookupPreparedFile',
  'EMPTY_PREPARED_FILE_CACHE',
] as const satisfies readonly (keyof typeof api)[];
export type CitableTypes = [
  api.InputMode,
  api.InputRevision,
  api.WordsValidation,
  api.FaceInput,
  api.TileCommand,
  api.TileActionState,
  api.TileKeyboard,
  api.CandidateId,
  api.BatchFile,
  api.BatchSelection,
  api.SelectionClick,
  api.GlobalClickOrder,
  api.KeypointAllocation,
  api.BatchCancel,
  api.BatchPayloadError,
  api.RetryPixelRef,
  api.ProgressAction,
  api.CompletionBoundary,
  api.WholeActionProgress,
  api.PerCropProgress,
  api.ComputeReadyVsFileComplete,
  api.AppGrantState,
  api.RecoveryClassification,
  api.RecoveryActions,
  api.ClassifiedRecovery,
  api.ComputePermit,
  api.ResidencyReservation,
  api.AssetLeaseRef,
  api.MorphParentIntent,
  api.IntentSettlement,
  api.RouteSnapshot,
  api.FrameBudget,
  api.CapabilityStatus,
  api.ConstrainedTeardownPolicy,
  api.PreflightEvidence,
  api.CapabilityFact<number>,
  api.SampleResult,
  api.PreflightOutcome,
  api.RouteEligibility,
  api.StageEstimate,
  api.CalibrationScope,
  api.EstimateSourceClass,
  api.AdmissionSplit,
  api.ConsentCostRow,
  api.MaterialCostChange,
  api.ExportKind,
  api.ExportIdentityInput,
  api.ExportIdentity,
  api.KnownExport,
  api.ExportName,
  api.NoClobberMode,
  api.WriteDecision,
  api.PreparedFileEntry,
  api.PreparedFileCacheState,
  api.PreparedFileNotRetained,
  api.PreparedFileLookup,
  api.CompletionBoundary,
];

test('every listed app contract value is exported', () => {
  for (const name of VALUES) assert.ok(name in api, name);
  assert.equal(api.SOURCE_RGBA_MAX_BYTES, 480 * 1024 * 1024);
  assert.deepEqual(api.SEED_RANGE, { min: 0, max: 4294967295 });
});

// ---- Tile action table: each row offers only its commands.
is<Equal<CommandsOf<'empty-or-invalid'>, never>>();
is<Equal<CommandsOf<'ready'>, 'generate'>>();
is<Equal<CommandsOf<'active'>, 'cancel'>>();
is<Equal<CommandsOf<'cancelling'>, never>>();
is<Equal<CommandsOf<'failed-retryable'>, 'retry'>>();
is<Equal<CommandsOf<'retry-pixels-lost'>, 'encode-image'>>();
is<Equal<CommandsOf<'file-failed'>, 'retry-file-preparation'>>();
// @ts-expect-error a valid unfinished tile offers Generate, not Cancel
export const readyCancel: TileActionState = { state: 'ready', commands: ['cancel'] };
const cancelOnly = ['cancel'] as const;
const retryOnly = ['retry'] as const;
// @ts-expect-error a stopping, non-preemptible job shows a disabled Cancelling: no command
export const cancellingCancel: TileActionState = {
  state: 'cancelling',
  commands: cancelOnly,
  attemptId: 'a',
};
// @ts-expect-error lost retry pixels mean Encode image, never Retry
export const lostRetry: TileActionState = {
  state: 'retry-pixels-lost',
  commands: retryOnly,
  retryPixels: false,
};
// The same rows with their own commands are accepted.
export const rows: TileActionState[] = [
  { state: 'ready', commands: ['generate'] },
  { state: 'cancelling', commands: [], attemptId: 'a' },
  { state: 'retry-pixels-lost', commands: ['encode-image'], retryPixels: false },
];

test('tile commands at runtime follow the table; words keep exact string semantics', () => {
  assert.equal(allows({ state: 'active', commands: ['cancel'], attemptId: 'a1' }, 'cancel'), true);
  assert.equal(allows({ state: 'empty-or-invalid', commands: [] }, 'generate'), false);
  assert.deepEqual(validateWords(''), { valid: false, reason: 'empty' });
  assert.deepEqual(validateWords('   '), { valid: false, reason: 'whitespace-only' });
  assert.deepEqual(validateWords(' Émile '), { valid: true, words: ' Émile ' });
  assert.deepEqual(validateWords('é'.repeat(257)), { valid: false, reason: 'too-long' }); // 514 UTF-8 bytes
});

// ---- Batch walkthroughs.
const files = (...specs: [string, 'photo' | 'recovered-still' | 'corrupt', number][]) =>
  specs.map(([id, kind, n]) => ({
    id,
    kind,
    candidates: Array.from({ length: n }, (_, i) => `${id}#${i + 1}` as CandidateId),
  }));
const clicks = (sel: BatchSelection, ...cs: CandidateId[]) =>
  cs.reduce((s, candidate) => applyClick(s, { candidate }), sel);
const rev = (n: number) => n as InputRevision;

test('batch: A1, B2, A2 across two files with a corrupt third', () => {
  const sel = clicks(
    { files: files(['A', 'photo', 2], ['B', 'photo', 2], ['C', 'corrupt', 0]), order: [] },
    'A#1',
    'B#2',
    'A#2',
  );
  assert.deepEqual(sel.order, ['A#1', 'B#2', 'A#2']);
  const slots = allocateKeypoints(sel.order, {
    source: rev(1),
    sourceNow: rev(1),
    target: rev(4),
    targetNow: rev(4),
  });
  assert.notEqual(slots, 'stale');
  assert.deepEqual(slots !== 'stale' && slots.map((s) => [s.candidate, s.target]), [
    ['A#1', 'first-target'],
    ['B#2', 'additional-keypoint'],
    ['A#2', 'additional-keypoint'],
  ]);
});

test('batch: R -> A2 -> B1 with a corrupt fourth; deselect removes, reselect appends', () => {
  let sel = clicks(
    {
      files: files(
        ['R', 'recovered-still', 1],
        ['A', 'photo', 2],
        ['B', 'photo', 1],
        ['D', 'corrupt', 0],
      ),
      order: [],
    },
    'R#1',
    'A#2',
    'B#1',
  );
  assert.deepEqual(sel.order, ['R#1', 'A#2', 'B#1']);
  sel = clicks(sel, 'A#2'); // deselect
  assert.deepEqual(sel.order, ['R#1', 'B#1']);
  sel = clicks(sel, 'A#2'); // reselect appends
  assert.deepEqual(sel.order, ['R#1', 'B#1', 'A#2']);
  assert.equal(
    allocateKeypoints(sel.order, {
      source: rev(1),
      sourceNow: rev(2),
      target: rev(1),
      targetNow: rev(1),
    }),
    'stale',
  );
});

test('click order survives cancel, retry and out-of-order completion', () => {
  const sel = clicks(
    { files: files(['A', 'photo', 2], ['B', 'photo', 1]), order: [] },
    'B#1',
    'A#2',
    'A#1',
  );
  type J = { slot: string; attemptId: string };
  let queue: readonly J[] = sel.order.map((c) => ({ slot: c, attemptId: `${c}:1` }));
  queue = queue.filter((j) => j.slot !== 'A#2'); // A2 cancelled
  queue = retrySlot(queue, 'A#2', 'A#2:2', (slot, attemptId) => ({ slot, attemptId })); // retried: appended to the queue
  const completed = ['A#1', 'A#2', 'B#1']; // completion order differs
  assert.deepEqual(sel.order, ['B#1', 'A#2', 'A#1'], 'only clicks change the order');
  assert.deepEqual(
    queue.map((j) => j.attemptId),
    ['B#1:1', 'A#1:1', 'A#2:2'],
  );
  void completed;
});

// ---- Progress.
test('progress never decreases within an attempt; overlap counts once; unknown totals are indeterminate', () => {
  let p = advance(undefined, 'a1', 'morph', 30, 100);
  p = advance(p, 'a1', 'morph', 10, 100); // a stage restarting at a lower number
  assert.deepEqual(p.kind === 'determinate' && p.fraction, 0.3);
  p = advance(p, 'a1', 'morph', 60, 100);
  assert.deepEqual(p.kind === 'determinate' && p.fraction, 0.6);
  assert.deepEqual(
    advance(p, 'a2', 'morph', 5, 100).kind === 'determinate' &&
      (advance(p, 'a2', 'morph', 5, 100) as { fraction: number }).fraction,
    0.05,
  );
  assert.equal(advance(p, 'a1', 'morph', 70, null).kind, 'indeterminate');
  assert.equal(
    overlapCost([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
      { start: 20, end: 25 },
    ]),
    20,
  );
  assert.equal(api.COMPLETION_BOUNDARIES.morph, 'playable-mp4-with-project-metadata');
});

// ---- Recovery classification vectors.
const vectors = JSON.parse(
  readFileSync(
    new URL('../../src/contracts/recovery-classification.vectors.json', import.meta.url),
    'utf8',
  ),
);
const still = (name: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`../../../../packages/stylegan-js/test/vectors/stills/${name}`, import.meta.url),
    ),
  );

test('classifyRecovery vectors: each parse result x loaded-model case', () => {
  for (const c of vectors.cases) {
    let bytes: Uint8Array;
    if (c.synthetic === 'schema-9') {
      const ok = embedRecovery(still('../plain.png'), {
        generationKind: 'seed',
        generationSha256: 'a'.repeat(64),
        provenance: c.loaded,
        latent: { space: 'w-plus', shape: [18, 512], values: new Float32Array(18 * 512) },
      });
      const text = new TextDecoder('latin1').decode(ok);
      const at = text.indexOf('"schema":2');
      bytes = ok.slice();
      bytes[at + 9] = '9'.charCodeAt(0);
      // Re-seal the tEXt chunk's CRC so the envelope is well formed, just of an unknown version.
      const start = text.lastIndexOf('tEXt', at) - 4;
      const size = new DataView(bytes.buffer).getUint32(start);
      let n = 0xffffffff;
      for (const b of bytes.subarray(start + 4, start + 8 + size)) {
        n ^= b;
        for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      }
      new DataView(bytes.buffer).setUint32(start + 8 + size, (n ^ 0xffffffff) >>> 0);
    } else bytes = still(c.still);
    const r = classifyRecovery(readRecovery(bytes), { loaded: c.loaded, known: c.known });
    assert.equal(r.classification, c.classification, c.name);
    const { reason: _reason, ...actions } = r.actions;
    assert.deepEqual(actions, c.actions, c.name);
  }
});

// ---- Scheduler walkthroughs.
const GPU = 'webgpu:main' as ProviderContextId;
const CPU = 'cpu:main' as ProviderContextId;
function run(
  state: SchedulerState,
  ...events: SchedulerEvent[]
): { state: SchedulerState; actions: SchedulerAction[][] } {
  const actions: SchedulerAction[][] = [];
  let s = state;
  for (const e of events) {
    const r = schedule(s, e);
    s = r.state;
    actions.push([...r.actions]);
  }
  return { state: s, actions };
}
const face = (
  slot: string,
  op: 'face-synthesis' | 'photo-encode' = 'face-synthesis',
  context = GPU,
) => ({ id: `${slot}:${op}`, slot, revision: 1, op, context });
const types = (as: SchedulerAction[]) => as.map((a) => a.type);

test('scheduler: a photo encode, then a queued morph; one heavy op per context; waiting jobs hold no reservation', () => {
  const s0 = initialScheduler([GPU], { memory: 'ample' });
  const r = run(
    s0,
    { type: 'request', job: face('p1', 'photo-encode'), owner: 'user' },
    {
      type: 'request-morph',
      intent: 'm1',
      slots: ['p1', 'f2'],
      revisions: { p1: 1, f2: 1 },
      context: GPU,
      consent: true,
    },
  );
  assert.equal(r.state.contexts[GPU]!.active?.id, 'p1:photo-encode');
  assert.equal(r.state.reservations.length, 1, 'only the active job is reserved');
  assert.equal(r.state.intents[0]!.permit, null, 'the morph waits without a permit');
  const done = run(r.state, { type: 'complete', jobId: 'p1:photo-encode' });
  // Encoder warm, generator needed next: the encoder is released before the generator is reserved.
  assert.deepEqual(types(done.actions[0]!).slice(0, 3), [
    'release-warm',
    'reserve',
    'grant-permit',
  ]);
});

test('scheduler: morph auto-generation joins an explicit face request; Cancel detaches the parent only', () => {
  const s0 = initialScheduler([GPU], { memory: 'ample' });
  const r = run(
    s0,
    { type: 'request', job: face('busy'), owner: 'user' },
    {
      type: 'request-morph',
      intent: 'm1',
      slots: ['a', 'b'],
      revisions: { a: 1, b: 1 },
      context: GPU,
      consent: true,
    },
    { type: 'request', job: { ...face('a'), id: 'm1:a' }, owner: 'user' }, // the person asks for face a explicitly
  );
  const a = r.state.queue.find((j) => j.slot === 'a')!;
  assert.deepEqual([...a.owners].sort(), ['m1', 'user'], 'one job, two owners');
  const edited = run(r.state, {
    type: 'request',
    job: { ...face('b'), id: 'b:r2', revision: 2 },
    owner: 'user',
  });
  assert.equal(
    edited.state.queue.filter((j) => j.slot === 'b').length,
    2,
    "an edited input (revision 2) is a new job, not the morph's revision-1 face",
  );
  const cancelled = run(r.state, { type: 'cancel', owner: 'm1' });
  assert.ok(
    cancelled.state.queue.some((j) => j.slot === 'a'),
    'face a still runs for the explicit request',
  );
  assert.ok(
    !cancelled.state.queue.some((j) => j.slot === 'b'),
    'face b, wanted only by the morph, is cancelled',
  );
  assert.deepEqual(cancelled.state.intents[0]!.settlement, { status: 'cancelled' });
});

test('scheduler: Cancel at each dependency boundary settles the intent', () => {
  for (const at of ['awaiting-consent', 'awaiting-dependencies', 'producing'] as const) {
    let s = initialScheduler([GPU], { memory: 'ample' });
    s = run(s, {
      type: 'request-morph',
      intent: 'm',
      slots: ['a'],
      revisions: { a: 1 },
      context: GPU,
      consent: at !== 'awaiting-consent',
    }).state;
    if (at === 'producing') s = run(s, { type: 'complete', jobId: 'm:a' }).state;
    assert.equal(s.intents[0]!.state, at === 'producing' ? 'producing' : at);
    const c = run(s, { type: 'cancel', owner: 'm' });
    assert.deepEqual(c.state.intents[0]!.settlement, { status: 'cancelled' }, at);
    assert.equal(c.state.reservations.length, 0, `${at}: nothing stays reserved`);
  }
});

test('scheduler: capability loss while queued settles with a recovery action', () => {
  const s = run(
    initialScheduler([GPU], { memory: 'ample' }),
    { type: 'request', job: face('x'), owner: 'user' },
    {
      type: 'request-morph',
      intent: 'm',
      slots: ['a'],
      revisions: { a: 1 },
      context: GPU,
      consent: true,
    },
    { type: 'capability', context: GPU, status: 'unavailable' },
  );
  assert.deepEqual(s.state.intents[0]!.settlement, { status: 'failed', recovery: 'retry-on-cpu' });
  assert.equal(s.state.queue.length, 0);
});

test('scheduler: competing provider loads share one load; constrained teardown vs qualified warm reuse', () => {
  const loads = run(
    initialScheduler([GPU], { memory: 'ample' }),
    { type: 'provider-load', context: GPU },
    { type: 'provider-load', context: GPU },
  );
  assert.deepEqual(loads.actions.map(types), [['start-load'], ['join-load']]);
  for (const memory of ['ample', 'constrained'] as const) {
    const r = run(
      initialScheduler([CPU], { memory }),
      { type: 'request', job: face('a', 'face-synthesis', CPU), owner: 'user' },
      { type: 'request', job: face('b', 'face-synthesis', CPU), owner: 'user' },
      { type: 'complete', jobId: 'a:face-synthesis' },
    );
    const last = types(r.actions[2]!);
    if (memory === 'ample')
      assert.ok(last.includes('reuse-warm') && !last.includes('terminate-workers'));
    else assert.ok(last.includes('terminate-workers') && !last.includes('reuse-warm'));
  }
});

test('scheduler: an idle retained encoder is released when a generator load is requested', () => {
  const r = run(
    initialScheduler([CPU], { memory: 'unknown' }),
    { type: 'request', job: face('p', 'photo-encode', CPU), owner: 'user' },
    { type: 'complete', jobId: 'p:photo-encode' },
    { type: 'request', job: face('f', 'face-synthesis', CPU), owner: 'user' },
  );
  // Unknown memory tears down between phases, so nothing stays warm to release.
  assert.ok(types(r.actions[1]!).includes('terminate-workers'));
  const ample = run(
    initialScheduler([CPU], { memory: 'ample' }),
    { type: 'request', job: face('p', 'photo-encode', CPU), owner: 'user' },
    { type: 'complete', jobId: 'p:photo-encode' },
    { type: 'request', job: face('f', 'face-synthesis', CPU), owner: 'user' },
  );
  assert.deepEqual(types(ample.actions[2]!), ['release-warm', 'reserve', 'grant-permit']);
});

// ---- Preflight.
const unknown = { state: 'unknown' } as const;
const evidence = (over: Partial<PreflightEvidence> = {}): PreflightEvidence => ({
  webgpuAdapter: unknown,
  wasmSimd: { state: 'known', value: true },
  wasmThreads: unknown,
  hardwareConcurrency: unknown,
  deviceMemoryGiB: unknown,
  cpuSample: unknown,
  gpuSample: unknown,
  ...over,
});

test('preflight: unknown memory, no adapter, timeout and an eligible GPU are typed states with no model asset', () => {
  assert.deepEqual(eligibility(evidence()).generator, {
    route: 'cpu',
    eligibility: 'eligible-model-check-pending',
  });
  assert.deepEqual(
    eligibility(evidence({ webgpuAdapter: { state: 'failed', reason: 'no adapter' } })).generator
      .route,
    'cpu',
  );
  const gpu = eligibility(
    evidence({
      webgpuAdapter: {
        state: 'known',
        value: { features: ['shader-f16'], maxBufferSize: 268435456 },
      },
    }),
  );
  assert.deepEqual(gpu.generator, { route: 'webgpu', eligibility: 'eligible-model-check-pending' });
  assert.equal(gpu.encoder.route, 'cpu');
  for (const outcome of ['skip', 'timeout', 'gpu-lost'] as const)
    assert.deepEqual(estimateFrom(outcome, []), { kind: 'no-reliable-estimate', outcome });
  assert.deepEqual(PREFLIGHT_BUDGETS, {
    samplingMs: 2000,
    uiDeadlineMs: 5000,
    scratchBytes: 16777216,
    checkerCodeBytesCompressed: 102400,
  });
  const text = readFileSync(new URL('../../src/contracts/preflight.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(
    text,
    /manifest|\.onnx|modelSha|synthesis\.|encoder\.onnx/i,
    'preflight references no model asset',
  );
});

// ---- Fuzzing untrusted payloads.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('payload fuzz (seed 909, 3000 cases): batch selections and words are accepted or typed rejections', () => {
  const random = mulberry32(909);
  const base = clicks(
    {
      files: files(['A', 'photo', 2], ['B', 'recovered-still', 1], ['C', 'corrupt', 0]),
      order: [],
    },
    'A#2',
    'B#1',
  );
  const odd: unknown[] = [
    null,
    -1,
    0,
    '',
    'A#1',
    'Z#1',
    '#1',
    'A#',
    [],
    {},
    true,
    'photo',
    'corrupt',
    ['A#1', 'A#1'],
  ];
  const counts: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) {
    const copy = JSON.parse(JSON.stringify(base));
    const target = random() < 0.5 ? copy : copy.files[Math.floor(random() * copy.files.length)];
    const keys = Object.keys(target);
    target[keys[Math.floor(random() * keys.length)]!] = odd[Math.floor(random() * odd.length)];
    const r = parseBatchSelection(copy);
    const k = r.ok ? 'accepted' : r.error.code;
    if (!r.ok)
      assert.ok(['not-an-object', 'invalid-file', 'invalid-order'].includes(r.error.code), k);
    counts[k] = (counts[k] ?? 0) + 1;
    const w = String.fromCodePoint(
      ...Array.from({ length: Math.floor(random() * 300) }, () => Math.floor(random() * 0x2fff)),
    );
    const v = validateWords(w);
    assert.ok(
      v.valid ? v.words === w : ['empty', 'whitespace-only', 'too-long'].includes(v.reason),
    );
  }
  assert.equal(parseBatchSelection(base).ok, true);
  assert.ok((counts['invalid-file'] ?? 0) + (counts['invalid-order'] ?? 0) > 1000);
  console.log('app payload fuzz: 3000 cases', counts);
});
