// Numeric ceilings, boundary vectors and validator fuzzing (fm-2o8q). The decode bounds are derived a
// third time here from the raw fm-4cp rows (ceilings.ts and tools/ceilings/make_vectors.py are the other
// two); every vector is run at its boundary and one over; the vector files validate against their types;
// and the app's untrusted payload validators are fuzzed with fixed seeds and recorded case counts.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ACQUISITION_BUDGETS,
  LIVE_RESIDENCY_LIMIT,
  type AcquisitionBudget,
  type LiveResidencyLimit,
} from 'browser-model-manager';
import {
  CROP_MAX_BYTES,
  MAX_MORPH_FRAMES,
  MEMORY_BOUNDS,
  readRecovery,
  type MemoryBoundName,
} from 'stylegan-js';
import {
  CEILINGS,
  CLASSIC_COMMIT,
  DECODE_LANES,
  DECODE_ROUTES,
  DECODE_TRANSIENT_BYTES,
  MORPH_FRAME_BUDGET,
  checkCeiling,
  checkDecode,
  lookupCeiling,
  scopeKey,
  type CeilingName,
  type CeilingScope,
} from '../../src/contracts/ceilings.ts';
import { PREFLIGHT_BUDGETS } from '../../src/contracts/preflight.ts';
import {
  PREPARED_FILE_CACHE_MAX_BYTES_NAME,
  planCacheInsert,
  preparedFileCacheMaxBytes,
  EMPTY_PREPARED_FILE_CACHE,
} from '../../src/contracts/prepared-file-cache.ts';
import { classifyRecovery } from '../../src/contracts/recovery-classification.ts';
import {
  admitUntrustedFileSize,
  parseUntrustedJson,
  utf8Length,
} from '../../src/contracts/untrusted-files.ts';
import {
  parseCeilingVectors,
  parseExportIdentityVectors,
} from '../../src/contracts/vector-files.ts';

const read = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const contracts = new URL('../../src/contracts/', import.meta.url);
const measurements = new URL(
  '../../../../packages/stylegan-js/src/contracts/decode-measurements/',
  import.meta.url,
);
const ceilingVectorsJson = read(new URL('ceilings.vectors.json', contracts));
const exportVectorsJson = read(new URL('export-identity.vectors.json', contracts));
const MiB = 1024 * 1024;

const ALL: CeilingScope = { kind: 'all-routes' };
const value = (name: CeilingName, scope: CeilingScope = ALL): number => {
  const found = lookupCeiling(name, scope);
  assert.ok(found.admitted, `${name} ${scopeKey(scope)}`);
  return found.ceiling.value;
};

// ---- Every ceiling is complete.

/** Exhaustive: a CeilingName added without a value fails tsc here, and the test below fails at runtime. */
const EVERY_NAME: { readonly [N in CeilingName]: true } = {
  DECODE_TRANSIENT_BYTES: true,
  RETAINED_SOURCE_BYTES: true,
  CROP_BUFFER_BYTES: true,
  BATCH_RETAINED_INPUT_BYTES: true,
  MORPH_FRAME_BUDGET: true,
  STORED_SESSION_BYTES: true,
  PROJECT_FILE_PARSE_BYTES: true,
  SESSION_FILE_PARSE_BYTES: true,
  IMAGE_PREPARATION_BYTES: true,
  FILE_ENCODE_BYTES: true,
  PREPARED_FILE_CACHE_MAX_BYTES: true,
  ACQUISITION_READ_AHEAD_BYTES: true,
  ACQUISITION_HASH_BYTES: true,
  ACQUISITION_WRITE_BUFFER_BYTES: true,
  LIVE_RESIDENT_BYTES: true,
  LIVE_SESSIONS: true,
  ENGINE_LIVE_ENCODER_SESSIONS: true,
  ENGINE_WASM_HEAP_BYTES: true,
  ENGINE_RETAINED_FRAMES: true,
  ENGINE_RETAINED_FRAME_BYTES: true,
  ENGINE_CODEC_QUEUE_FRAMES: true,
  ENGINE_GPU_BUFFER_BYTES: true,
  PREFLIGHT_SAMPLING_MS: true,
  PREFLIGHT_UI_DEADLINE_MS: true,
  PREFLIGHT_SCRATCH_BYTES: true,
  PREFLIGHT_CHECKER_CODE_BYTES: true,
};

test('every ceiling has a positive integer value, a unit, a route scope and a reference; each (name, scope) once', () => {
  const keys = new Set<string>();
  for (const c of CEILINGS) {
    const key = `${c.name} ${scopeKey(c.scope)}`;
    assert.ok(!keys.has(key), `duplicate ${key}`);
    keys.add(key);
    assert.ok(Number.isSafeInteger(c.value) && c.value > 0, key);
    assert.ok(['bytes', 'frames', 'sessions', 'ms'].includes(c.unit), key);
    assert.ok(c.counts.length > 0, key);
    switch (c.reference.kind) {
      case 'decode-measurement':
        assert.ok(readdirSync(measurements).includes(c.reference.file.split('/').pop()!), key);
        break;
      case 'candidate-constant':
        assert.equal(c.reference.classicCommit, CLASSIC_COMMIT, key);
        assert.match(c.reference.source, /^src\/Next\//u, key);
        break;
      case 'plan-budget':
        assert.match(c.reference.anchor, /^#[a-z0-9-]+$/u, key);
        break;
      case 'derived':
        for (const from of c.reference.from) assert.ok(from in EVERY_NAME, key);
        break;
    }
  }
  assert.deepEqual(new Set(CEILINGS.map((c) => c.name)), new Set(Object.keys(EVERY_NAME)));
  assert.ok(Object.isFrozen(CEILINGS));
});

test('every ceiling named in the milestone-1/2 types has its value here', () => {
  // Engine memory bounds (stylegan-js MemoryBoundName).
  const engine: { readonly [N in MemoryBoundName]: CeilingName } = {
    maxLiveEncoderSessions: 'ENGINE_LIVE_ENCODER_SESSIONS',
    maxWasmHeapBytes: 'ENGINE_WASM_HEAP_BYTES',
    maxRetainedFrames: 'ENGINE_RETAINED_FRAMES',
    maxRetainedFrameBytes: 'ENGINE_RETAINED_FRAME_BYTES',
    maxCodecQueueFrames: 'ENGINE_CODEC_QUEUE_FRAMES',
    maxGpuBufferBytes: 'ENGINE_GPU_BUFFER_BYTES',
  };
  for (const [bound, name] of Object.entries(engine) as [MemoryBoundName, CeilingName][]) {
    const scope: CeilingScope =
      bound === 'maxGpuBufferBytes'
        ? { kind: 'compute-route', route: 'webgpu' }
        : bound === 'maxWasmHeapBytes'
          ? { kind: 'compute-route', route: 'cpu' }
          : ALL;
    assert.equal(value(name, scope), MEMORY_BOUNDS[bound], bound);
  }
  // Manager acquisition budgets, aggregate across workers, per memory class. transferBytes is the grant.
  const acquisition: {
    readonly [F in Exclude<keyof AcquisitionBudget, 'transferBytes'>]: CeilingName;
  } = {
    readAheadBytes: 'ACQUISITION_READ_AHEAD_BYTES',
    hashBytes: 'ACQUISITION_HASH_BYTES',
    writeBufferBytes: 'ACQUISITION_WRITE_BUFFER_BYTES',
  };
  for (const memory of ['constrained-or-unknown', 'ample'] as const)
    for (const [field, name] of Object.entries(acquisition) as [
      keyof typeof acquisition,
      CeilingName,
    ][])
      assert.equal(
        value(name, { kind: 'memory-class', memory }),
        ACQUISITION_BUDGETS[memory][field],
        `${memory} ${field}`,
      );
  const residency: { readonly [F in keyof LiveResidencyLimit]: CeilingName } = {
    maxResidentBytes: 'LIVE_RESIDENT_BYTES',
    maxLiveSessions: 'LIVE_SESSIONS',
  };
  for (const [field, name] of Object.entries(residency) as [
    keyof LiveResidencyLimit,
    CeilingName,
  ][])
    assert.equal(value(name), LIVE_RESIDENCY_LIMIT[field], field);
  // The prepared-file cache bound, named by fm-s9n, now has its value.
  assert.ok(PREPARED_FILE_CACHE_MAX_BYTES_NAME in EVERY_NAME);
  preparedFileCacheMaxBytes(value('PREPARED_FILE_CACHE_MAX_BYTES'));
  // Device-check budgets.
  assert.equal(value('PREFLIGHT_SAMPLING_MS'), PREFLIGHT_BUDGETS.samplingMs);
  assert.equal(value('PREFLIGHT_UI_DEADLINE_MS'), PREFLIGHT_BUDGETS.uiDeadlineMs);
  assert.equal(value('PREFLIGHT_SCRATCH_BYTES'), PREFLIGHT_BUDGETS.scratchBytes);
  assert.equal(value('PREFLIGHT_CHECKER_CODE_BYTES'), PREFLIGHT_BUDGETS.checkerCodeBytesCompressed);
  // The scheduler's frame budget: the classic 4,096 until measured.
  assert.deepEqual(MORPH_FRAME_BUDGET, { maxFrames: 4096, source: 'classic-4096' });
  assert.equal(value('MORPH_FRAME_BUDGET'), MAX_MORPH_FRAMES);
  assert.equal(value('RETAINED_SOURCE_BYTES'), CROP_MAX_BYTES);
});

// ---- Decode bounds from the raw measurement rows.

interface Row {
  readonly route: string;
  readonly fixture: string;
  readonly representation: string;
  readonly peak_bytes: number;
  readonly ok: boolean;
}

test('decode bounds equal CROP_MAX_BYTES plus the largest measured non-compressed peak, per lane and route', () => {
  const files = readdirSync(measurements).filter((f) => f.endsWith('.json'));
  assert.deepEqual(
    files.map((f) => f.replace(/\.json$/u, '')).sort(),
    [...DECODE_LANES].sort(),
    'one lane per measurement file',
  );
  for (const lane of DECODE_LANES) {
    const m = read(new URL(`${lane}.json`, measurements)) as {
      rows: Row[];
      browser_version: string;
      lease_run_id: string;
    };
    const held = new Map<string, number>();
    for (const r of m.rows) {
      assert.ok(r.ok, `${lane} ${r.route} ${r.fixture}`);
      if (r.representation === 'compressed') assert.ok(r.peak_bytes <= CROP_MAX_BYTES);
      else
        held.set(
          `${r.route} ${r.fixture}`,
          (held.get(`${r.route} ${r.fixture}`) ?? 0) + r.peak_bytes,
        );
    }
    for (const route of DECODE_ROUTES) {
      const peaks = [...held].filter(([k]) => k.startsWith(`${route} `)).map(([, v]) => v);
      assert.ok(peaks.length > 0, `${lane} ${route} measured`);
      assert.equal(
        DECODE_TRANSIENT_BYTES[lane][route],
        CROP_MAX_BYTES + Math.max(...peaks),
        `${lane} ${route}`,
      );
      const c = lookupCeiling('DECODE_TRANSIENT_BYTES', { kind: 'decode-route', lane, route });
      assert.ok(c.admitted && c.ceiling.reference.kind === 'decode-measurement');
      assert.equal(c.ceiling.reference.leaseRunId, m.lease_run_id);
      assert.equal(c.ceiling.reference.browserVersion, m.browser_version);
    }
  }
  // The batch bound is the preview-decode bound, which every lane measured equal.
  for (const lane of DECODE_LANES)
    assert.equal(
      value('BATCH_RETAINED_INPUT_BYTES'),
      DECODE_TRANSIENT_BYTES[lane]['preview-decode'],
    );
});

test('unmeasured routes and lanes have no ceiling and are not admitted', () => {
  for (const [lane, route] of [
    ['eris-chromium', 'imagebitmap-full'],
    ['android-emulator', 'crop-decode'],
    ['ios-simulator', 'preview-decode'],
    ['eris-chromium', 'no-such-route'],
  ] as const) {
    const r = checkDecode(lane, route, 1);
    assert.deepEqual(r, {
      ok: false,
      reason: 'not-measured',
      ceiling: 'DECODE_TRANSIENT_BYTES',
      scope: `decode-route:${lane}:${route}`,
    });
  }
  // No all-routes fallback for a decode bound.
  assert.equal(lookupCeiling('DECODE_TRANSIENT_BYTES', ALL).admitted, false);
});

// ---- Boundary vectors.

test('ceilings.vectors.json validates against its type and lists exactly the ceilings', () => {
  const parsed = parseCeilingVectors(ceilingVectorsJson);
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.error));
  const v = parsed.value;
  assert.equal(v.classicCommit, CLASSIC_COMMIT);
  const fromVectors = v.ceilings
    .map((c) => `${c.name} ${scopeKey(c.scope)} ${c.unit} ${c.value} ${c.oneOver.action}`)
    .sort();
  const fromModule = CEILINGS.map(
    (c) => `${c.name} ${scopeKey(c.scope)} ${c.unit} ${c.value} ${c.over}`,
  ).sort();
  assert.deepEqual(fromVectors, fromModule);
});

test('every ceiling admits its boundary and refuses one over with its action; not-admitted vectors refuse', () => {
  const parsed = parseCeilingVectors(ceilingVectorsJson);
  assert.ok(parsed.ok);
  for (const c of parsed.value.ceilings) {
    const at = checkCeiling(c.name, c.scope, c.atBoundary.requested);
    assert.deepEqual(
      at,
      { ok: true, ceiling: c.name, limit: c.value, remaining: 0 },
      `${c.name} at`,
    );
    const over = checkCeiling(c.name, c.scope, c.oneOver.requested);
    assert.deepEqual(
      over,
      {
        ok: false,
        reason: 'over-ceiling',
        ceiling: c.name,
        limit: c.value,
        requested: c.value + 1,
        unit: c.unit,
        action: c.oneOver.action,
      },
      `${c.name} over`,
    );
  }
  assert.ok(parsed.value.notAdmitted.length > 0);
  for (const n of parsed.value.notAdmitted) {
    const [, lane, route] = n.scope.split(':');
    const r = checkDecode(lane!, route!, 0);
    assert.ok(!r.ok && r.reason === 'not-measured', n.scope);
  }
  assert.deepEqual(checkCeiling('MORPH_FRAME_BUDGET', ALL, -1), {
    ok: false,
    reason: 'invalid-amount',
    ceiling: 'MORPH_FRAME_BUDGET',
    requested: -1,
  });
  assert.equal(checkCeiling('MORPH_FRAME_BUDGET', ALL, 1.5).ok, false);
});

test('batch admission is by bytes, never by face count: 32 retained crops fit, the 33rd asks to reduce the selection', () => {
  const crop = value('CROP_BUFFER_BYTES');
  assert.equal(crop, 4 * MiB);
  assert.equal(checkCeiling('BATCH_RETAINED_INPUT_BYTES', ALL, 32 * crop).ok, true);
  const over = checkCeiling('BATCH_RETAINED_INPUT_BYTES', ALL, 33 * crop);
  assert.ok(!over.ok && over.reason === 'over-ceiling' && over.action === 'reduce-selection');
  // Two maximal retained sources fit; a third does not.
  assert.equal(
    checkCeiling('BATCH_RETAINED_INPUT_BYTES', ALL, 2 * value('RETAINED_SOURCE_BYTES')).ok,
    true,
  );
  assert.equal(
    checkCeiling('BATCH_RETAINED_INPUT_BYTES', ALL, 2 * value('RETAINED_SOURCE_BYTES') + 1).ok,
    false,
  );
});

test('the prepared-file cache keeps one largest video beside a still of each format, at its bound', () => {
  const max = preparedFileCacheMaxBytes(value('PREPARED_FILE_CACHE_MAX_BYTES'));
  const video = value('FILE_ENCODE_BYTES');
  const still = value('IMAGE_PREPARATION_BYTES');
  let state = EMPTY_PREPARED_FILE_CACHE;
  for (const [key, bytes] of [
    ['mp4', video],
    ['webp', still],
    ['png', still],
  ] as const) {
    const plan = planCacheInsert(state, { key, bytes }, max);
    assert.ok(plan.retained && plan.evicted.length === 0, key);
    state = plan.state;
  }
  const next = planCacheInsert(state, { key: 'png-2', bytes: 1 }, max);
  assert.deepEqual(next.evicted, ['mp4']);
});

test('export-identity.vectors.json validates against its type', () => {
  const parsed = parseExportIdentityVectors(exportVectorsJson);
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.error));
  assert.equal(
    parsed.value.shapes.length,
    (exportVectorsJson as { shapes: unknown[] }).shapes.length,
  );
  const bad = structuredClone(exportVectorsJson) as { shapes: { input: { kind: string } }[] };
  bad.shapes[0]!.input.kind = 'gif';
  assert.deepEqual(parseExportIdentityVectors(bad), {
    ok: false,
    error: {
      code: 'invalid-vector-file',
      path: '$.shapes[0].input.kind',
      expected: 'one of webp, png, mp4',
    },
  });
});

// ---- Untrusted project and session files.

test('untrusted files: the byte bound is checked before reading and before parsing; no face count', () => {
  const project = value('PROJECT_FILE_PARSE_BYTES');
  const session = value('SESSION_FILE_PARSE_BYTES');
  assert.deepEqual(admitUntrustedFileSize('project-file', project), { ok: true, value: project });
  assert.deepEqual(admitUntrustedFileSize('project-file', project + 1), {
    ok: false,
    error: { code: 'too-large', kind: 'project-file', bytes: project + 1, limit: project },
  });
  assert.deepEqual(admitUntrustedFileSize('session-record', session + 1), {
    ok: false,
    error: { code: 'too-large', kind: 'session-record', bytes: session + 1, limit: session },
  });
  assert.deepEqual(parseUntrustedJson('session-record', 'x'.repeat(session + 1)), {
    ok: false,
    error: { code: 'too-large', kind: 'session-record', bytes: session + 1, limit: session },
  });
  assert.deepEqual(admitUntrustedFileSize('session-record', -3), {
    ok: false,
    error: { code: 'invalid-size', kind: 'session-record' },
  });
  // 65 faces (over classic's 64) parse: only bytes bound a file.
  const faces = JSON.stringify({ faces: Array.from({ length: 65 }, (_, i) => ({ id: `f${i}` })) });
  assert.equal(parseUntrustedJson('session-record', faces).ok, true);
  // At the boundary and one byte over, measured in UTF-8 (é is two bytes).
  const pad = (n: number) => `{"a":"${'x'.repeat(n - 8)}"}`;
  assert.equal(utf8Length(pad(session)), session);
  assert.equal(parseUntrustedJson('session-record', pad(session)).ok, true);
  const over = parseUntrustedJson('session-record', `{"a":"é${'x'.repeat(session - 9)}"}`);
  assert.deepEqual(over, {
    ok: false,
    error: { code: 'too-large', kind: 'session-record', bytes: session + 1, limit: session },
  });
  assert.deepEqual(parseUntrustedJson('project-file', '[1]'), {
    ok: false,
    error: { code: 'not-an-object', kind: 'project-file' },
  });
  assert.deepEqual(parseUntrustedJson('project-file', '{'), {
    ok: false,
    error: { code: 'not-json', kind: 'project-file' },
  });
  assert.deepEqual(parseUntrustedJson('project-file', '['.repeat(1_000_000)), {
    ok: false,
    error: { code: 'not-json', kind: 'project-file' },
  });
  assert.equal(utf8Length('\u{1F600}\uD800'), 7);
});

// ---- Fuzzing.

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

const ODD: readonly unknown[] = [
  null,
  undefined,
  -1,
  0,
  1.5,
  Number.NaN,
  '',
  'x',
  [],
  {},
  true,
  '__proto__',
  2 ** 53,
  'decode-route:eris-chromium:imagebitmap-full',
];

/** Replaces, deletes or adds one value somewhere inside a JSON-like tree. */
function mutate(value: unknown, random: () => number, depth = 0): unknown {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  if (depth > 0 && random() < 0.25) return pick(ODD);
  if (Array.isArray(value)) {
    if (value.length === 0 || random() < 0.1) return [...value, pick(ODD)];
    const i = Math.floor(random() * value.length);
    const copy = [...value];
    if (random() < 0.1) copy.splice(i, 1);
    else copy[i] = mutate(copy[i], random, depth + 1);
    return copy;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if (keys.length === 0 || random() < 0.1)
      copy[pick(['extra', 'name', 'scope', 'kind'])] = pick(ODD);
    else {
      const k = pick(keys);
      if (random() < 0.15) delete copy[k];
      else copy[k] = mutate(copy[k], random, depth + 1);
    }
    return copy;
  }
  if (typeof value === 'number') return pick([value + 1, value - 1, -value, value * 2, ...ODD]);
  if (typeof value === 'string')
    return pick([`${value}x`, value.slice(1), value.toUpperCase(), ...ODD]);
  return pick(ODD);
}

const tally = (counts: Record<string, number>, key: string) =>
  (counts[key] = (counts[key] ?? 0) + 1);

test('vector-file fuzz (seed 2026, 3000 cases): every mutation is accepted or a typed rejection', () => {
  const random = mulberry32(2026);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) {
    const exportFile = i % 2 === 1;
    const input = mutate(exportFile ? exportVectorsJson : ceilingVectorsJson, random);
    const r = exportFile ? parseExportIdentityVectors(input) : parseCeilingVectors(input);
    if (r.ok) tally(counts, 'accepted');
    else {
      assert.equal(r.error.code, 'invalid-vector-file');
      assert.match(r.error.path, /^\$/u);
      assert.ok(r.error.expected.length > 0);
      tally(counts, 'rejected');
    }
  }
  assert.ok((counts.rejected ?? 0) > 1500, 'the fuzz reaches the field checks');
  console.log('vector-file fuzz: 3000 cases', counts);
});

test('untrusted session/project fuzz (seed 64, 3000 cases): every input parses or is a typed rejection', () => {
  const random = mulberry32(64);
  const base = JSON.stringify({
    kind: 'last-generated-session-v3',
    faces: [
      { id: 'a', seed: 42 },
      { id: 'b', words: 'emma' },
    ],
    order: ['a', 'b'],
  });
  const codes = new Set(['too-large', 'invalid-size', 'not-json', 'not-an-object']);
  const huge = [
    '{"a":"' + 'x'.repeat(32 * MiB) + '"}',
    '{"a":"' + 'x'.repeat(64 * MiB) + '"}',
    '['.repeat(1_000_000),
  ];
  const counts: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) {
    let text: string;
    const how = random();
    if (how < 0.4) {
      // Byte-level damage: insert, delete or replace characters, lone surrogates included.
      const chars = [...base];
      for (let k = 1 + Math.floor(random() * 4); k > 0; k--) {
        const at = Math.floor(random() * (chars.length + 1));
        const ch = String.fromCharCode(Math.floor(random() * 0x10000));
        if (random() < 0.33) chars.splice(at, 1);
        else if (random() < 0.5) chars.splice(at, 0, ch);
        else chars[at] = ch;
      }
      text = chars.join('');
    } else if (how < 0.9) text = JSON.stringify(mutate(JSON.parse(base), random)) ?? 'undefined';
    else if (how < 0.93) text = huge[Math.floor(random() * huge.length)]!;
    else text = '['.repeat(Math.floor(random() * 5000)) + ']'.repeat(Math.floor(random() * 5000));
    const kind = random() < 0.5 ? 'session-record' : 'project-file';
    const r = parseUntrustedJson(kind, text);
    if (r.ok) {
      assert.equal(typeof r.value, 'object');
      assert.ok(!Array.isArray(r.value));
      tally(counts, 'parsed');
    } else {
      assert.ok(codes.has(r.error.code), r.error.code);
      assert.equal(r.error.kind, kind);
      tally(counts, r.error.code);
    }
  }
  assert.ok(
    (counts.parsed ?? 0) > 0 && (counts['not-json'] ?? 0) > 0 && (counts['too-large'] ?? 0) > 0,
  );
  console.log('untrusted file fuzz: 3000 cases', counts);
});

test('restored-still fuzz (seed 7777, 2000 cases): damaged stills classify to a typed recovery, never throw', () => {
  const random = mulberry32(7777);
  const stills = new URL('../fixtures/verify/stills/', import.meta.url);
  const originals = ['recovery-v2.png', 'recovery-v2.webp', 'recovery-v1.png'].map(
    (f) => new Uint8Array(readFileSync(new URL(f, stills))),
  );
  const first = readRecovery(originals[0]!);
  assert.equal(first.kind, 'parsed');
  const loaded =
    first.kind === 'parsed'
      ? {
          modelSha256: first.recovered.provenance.modelSha256,
          noiseSha256: first.recovered.provenance.noiseSha256,
        }
      : { modelSha256: '', noiseSha256: '' };
  const classes = new Set([
    'matching',
    'missing',
    'damaged',
    'incompatible-schema',
    'incompatible-model',
    'unknown-model',
  ]);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2000; i++) {
    const bytes = originals[i % originals.length]!.slice();
    const how = random();
    let input = bytes;
    if (how < 0.6)
      for (let k = 1 + Math.floor(random() * 8); k > 0; k--)
        bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
    else if (how < 0.9) input = bytes.subarray(0, Math.floor(random() * bytes.length));
    else input = bytes.subarray(Math.floor(random() * 64));
    const r = classifyRecovery(readRecovery(input), { loaded, known: [loaded] });
    assert.ok(classes.has(r.classification), r.classification);
    assert.equal(r.actions.view, true);
    if (r.classification !== 'matching')
      assert.equal(r.actions.installLatent, false, 'only a matching still installs');
    tally(counts, r.classification);
  }
  assert.ok((counts.damaged ?? 0) > 0, 'the fuzz reaches the integrity checks');
  console.log('restored-still fuzz: 2000 cases', counts);
});

test('ceiling-check fuzz (seed 99, 3000 cases): any name, scope and amount gives a typed answer', () => {
  const random = mulberry32(99);
  const names = Object.keys(EVERY_NAME) as CeilingName[];
  const scopes: CeilingScope[] = [
    ALL,
    { kind: 'compute-route', route: 'cpu' },
    { kind: 'compute-route', route: 'webgpu' },
    { kind: 'memory-class', memory: 'ample' },
    { kind: 'memory-class', memory: 'constrained-or-unknown' },
    ...DECODE_LANES.flatMap((lane) =>
      DECODE_ROUTES.map((route) => ({ kind: 'decode-route' as const, lane, route })),
    ),
  ];
  const amounts = [
    0,
    1,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
    4096,
    4097,
    134_217_728,
    134_217_729,
  ];
  const counts: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) {
    const name = names[Math.floor(random() * names.length)]!;
    const scope = scopes[Math.floor(random() * scopes.length)]!;
    const amount =
      random() < 0.5
        ? amounts[Math.floor(random() * amounts.length)]!
        : Math.floor(random() * 2 ** 31);
    const r = checkCeiling(name, scope, amount);
    if (r.ok) {
      assert.ok(
        Number.isSafeInteger(amount) &&
          amount >= 0 &&
          r.remaining === r.limit - amount &&
          r.remaining >= 0,
      );
      tally(counts, 'ok');
    } else {
      if (r.reason === 'over-ceiling') assert.ok(r.requested > r.limit);
      tally(counts, r.reason);
    }
  }
  assert.ok(
    ['ok', 'over-ceiling', 'not-measured', 'invalid-amount'].every((k) => (counts[k] ?? 0) > 0),
    JSON.stringify(counts),
  );
  console.log('ceiling-check fuzz: 3000 cases', counts);
});
