// Not-worse workload, slice 1 (fm-0q4h): boundary detection for each measure with scripted waits excluded, both
// selector maps defining every boundary, reliability classification, ABBA order with the warmup discarded, and a run
// JSON validated against run.schema.json. The trace is a planted input (fixtures/trace-planted.json).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARIES,
  BUILD_SELECTORS,
  CONTROL_SELECTORS,
  MEASURES,
  MEASURE_SPAN,
  abbaSchedule,
  measures,
  reliability,
  scored,
  span,
  waitedWithin,
  type TraceEvent,
} from './workload.ts';

const here = (p: string) => new URL(p, import.meta.url);
const trace = JSON.parse(readFileSync(here('./fixtures/trace-planted.json'), 'utf8')) as {
  morphFrames: number;
  events: TraceEvent[];
};

test('every measure is bracketed by an action and a boundary; scripted waits are excluded', () => {
  const m = measures(trace.events, trace.morphFrames);
  assert.deepEqual(Object.keys(m.values).sort(), [...MEASURES].sort());
  assert.deepEqual(m.values, {
    usablePageMs: 850,
    coldFaceMs: 9000 - 900 - 600, // the 600 ms wait inside it is the script's, not the build's
    warmFaceMs: 1000,
    nextFaceMs: 1200,
    photoEncodeMs: 34000 - 27100 - 500,
    morphPlayableMs: 16000,
    morphPerFrameMs: 16000 / 32,
    firstSaveMs: 300,
    repeatSaveMs: 100,
  });
  // A wait that straddles a measure's edge only counts its overlap.
  assert.equal(waitedWithin([{ t: 0, kind: 'wait', end: 100 }], 50, 200), 50);
  // A boundary before its action never ends that measure; a missing one leaves the measure null.
  assert.equal(
    span(
      [
        { t: 5, kind: 'boundary', name: 'face-rendered' },
        { t: 10, kind: 'action', name: 'generate-cold' },
      ],
      'generate-cold',
      'face-rendered',
    ),
    null,
  );
  assert.equal(span([], 'navigate', 'usable-page'), null);
  assert.equal(
    m.lockups,
    2,
    'an input that waited 1.4 s and a 1.2 s paint gap; the 300 ms gap is not one',
  );
  assert.deepEqual(m.bytes, { first: 1090000000, return: 120000 });
  assert.equal(m.peakMemory, 1500000000);
  assert.equal(measures([], 0).peakMemory, 'unreported', 'never estimated');
});

test('both selector maps name every boundary, and every timed measure ends at a known boundary', () => {
  for (const map of [CONTROL_SELECTORS, BUILD_SELECTORS]) {
    assert.deepEqual(Object.keys(map).sort(), [...BOUNDARIES].sort());
    for (const b of BOUNDARIES) assert.ok(map[b].selector.length > 0 && map[b].condition, b);
  }
  for (const s of Object.values(MEASURE_SPAN))
    assert.ok((BOUNDARIES as readonly string[]).includes(s.boundary));
});

test('reliability: a crash, a reload, a fallback and an uncaught error are each classified', () => {
  const r = reliability(trace.events);
  assert.deepEqual(r, {
    faceProduced: true,
    photoFaceProduced: true,
    videoProduced: true,
    crash: false,
    reloads: 1,
    outOfMemory: false,
    fallback: true,
    uncaughtErrors: 1,
  });
  assert.equal(reliability([{ t: 1, kind: 'crash', detail: 'renderer gone' }]).crash, true);
  assert.equal(reliability([{ t: 1, kind: 'oom' }]).outOfMemory, true);
  assert.equal(
    reliability([{ t: 1, kind: 'route', requested: 'auto', actual: 'cpu' }]).fallback,
    false,
    'auto choosing CPU is not a fallback',
  );
});

test('ABBA: one discarded warmup, then pairs alternating which side runs first', () => {
  const s = abbaSchedule(5);
  assert.equal(s.length, 11);
  assert.deepEqual(s[0], { index: 0, side: 'control', pair: null, order: 'warmup' });
  assert.deepEqual(
    s.slice(1, 5).map((r) => `${r.pair}:${r.order}:${r.side}`),
    ['0:AB:control', '0:AB:build', '1:BA:build', '1:BA:control'],
  );
  assert.deepEqual(
    s.map((r) => r.index),
    s.map((_, i) => i),
  );
  const runs = s.map((run) => ({ run }));
  assert.equal(scored(runs).length, 10, 'the warmup is dropped');
  assert.throws(() => abbaSchedule(0), RangeError);
});

test('a run JSON built from the measures validates against run.schema.json; a malformed one does not', () => {
  const require = createRequire(import.meta.url);
  const Ajv2020 = require('ajv/dist/2020').default as new (o: object) => {
    compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
  };
  const validate = new Ajv2020({ strict: false }).compile(
    JSON.parse(readFileSync(here('./run.schema.json'), 'utf8')),
  );
  const m = measures(trace.events, trace.morphFrames);
  const r = reliability(trace.events);
  const doc = {
    schema: 'facemorph.not-worse-run/1',
    cell: {
      device: 'eris (RTX 2080 SUPER)',
      os: 'Linux',
      browser: 'chromium',
      browserVersion: '156.0.8078.4',
      provider: 'webgpu',
      cacheState: 'cold',
    },
    digests: { control: 'e'.repeat(64), build: 'e'.repeat(64) },
    runs: abbaSchedule(1).map((run) => ({ ...run, measures: m, reliability: r })),
  };
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({ ...doc, cell: { ...doc.cell, provider: 'webgl' } }),
    false,
    'a removed route is not a cell',
  );
  assert.equal(
    validate({ ...doc, runs: [{ ...doc.runs[0], measures: { ...m, peakMemory: 'about 1 GB' } }] }),
    false,
  );
});

test('the workload module typechecks under strict TypeScript', () => {
  const tsc = createRequire(import.meta.url)
    .resolve('typescript/package.json')
    .replace(/package\.json$/, 'bin/tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', fileURLToPath(here('./tsconfig.json'))], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('segments: one pair per job keeps ABBA order by global pair index; each segment records only its measures', async () => {
  const { pairSchedule, restrictToSegment, SEGMENTS } = await import('./workload.ts');
  assert.deepEqual(pairSchedule({ pairs: 5 }), abbaSchedule(5));
  assert.deepEqual(
    pairSchedule({ pairs: 1, firstPair: 3 }).map(
      (r) => `${r.index}:${r.pair}:${r.order}:${r.side}`,
    ),
    ['0:null:warmup:control', '1:3:BA:build', '2:3:BA:control'],
  );
  assert.deepEqual(
    pairSchedule({ pairs: 1, firstPair: 2, warmup: false }).map(
      (r) => `${r.index}:${r.order}:${r.side}`,
    ),
    ['0:AB:control', '1:AB:build'],
  );
  // Every measure belongs to exactly one of face, morph and photo; all is their union.
  const parts = [SEGMENTS.face, SEGMENTS.morph, SEGMENTS.photo].flatMap((s) => s.measures);
  assert.equal(new Set(parts).size, parts.length);
  assert.deepEqual([...parts].sort(), [...SEGMENTS.all.measures].sort());
  const m = measures(trace.events, trace.morphFrames);
  const photo = restrictToSegment(m, 'photo');
  assert.equal(photo.values.photoEncodeMs, m.values.photoEncodeMs);
  assert.equal(photo.values.coldFaceMs, null);
  assert.deepEqual(photo.bytes, { first: null, return: null });
  assert.deepEqual(restrictToSegment(m, 'face').bytes, m.bytes);
  assert.deepEqual(restrictToSegment(m, 'all'), m);
});
