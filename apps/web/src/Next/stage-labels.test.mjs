import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_LABELS, SILENT_STAGES, SELF_TEXT_STAGES, STEP_STAGES, accountedStages, labelFor, loadedBytes } from './stage-labels.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

/**
 * The regression guard for C-10. It reads the shipped sources rather than a hand-kept list, so
 * a stage added next month is a failing test, not another "Working…" on someone's phone.
 * `src/Next` is the product; the two workers below are built elsewhere but their progress
 * messages are forwarded into the very same label lookup, so they are enumerated too.
 */
function sources() {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (entry.endsWith('.mjs') && !entry.endsWith('.test.mjs')) files.push({ path, phases: false });
    }
  };
  walk(join(repo, 'src', 'Next'));
  // `stage(name, fn)` in the alignment worker posts `name` and then `name-complete` straight to
  // the interface. The frozen WebGL engine has a helper of the same shape, but its names go to
  // `checkpoint()`, which ort-worker reports as the single `gpu-stage` — so only this one file
  // has its phase names read as stages.
  files.push({ path: join(repo, 'photo-runtime', 'photo-worker.mjs'), phases: true });
  files.push({ path: join(repo, 'photo-runtime', 'encoder-stream', 'execute.mjs'), phases: false });
  return files;
}

// `'diagnostics-'` is a prefix the bridge concatenates onto a reporting status. Those events
// are consumed by the interface before the label map is ever consulted.
const NOT_A_STAGE = new Set(['diagnostics-', 'working']);

export function emittedStages() {
  const found = new Map();
  const record = (stage, file) => {
    if (NOT_A_STAGE.has(stage)) return;
    if (!found.has(stage)) found.set(stage, new Set());
    found.get(stage).add(file.slice(repo.length + 1));
  };
  for (const { path: file, phases } of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const [, stage] of text.matchAll(/stage: *'([a-z0-9-]+)'/g)) record(stage, file);
    // `stage:cond?'a':'b'` ternaries: every stage string the expression can produce must be
    // accounted for, so capture them all rather than only the literal-shaped first branch.
    for (const [, expr] of text.matchAll(/stage: *([^\n}'"][^\n}]*)/g)) {
      if (!expr.includes("'")) continue;
      for (const [, stage] of expr.matchAll(/'([a-z0-9-]+)'/g)) record(stage, file);
    }
    for (const [, stage] of text.matchAll(/report\( *(?:id|currentId) *, *'([a-z0-9-]+)'/g)) record(stage, file);
    for (const [, stage] of text.matchAll(/progress\( *'([a-z0-9-]+)'/g)) record(stage, file);
    if (phases) for (const [, stage] of text.matchAll(/(?<![a-zA-Z])stage\( *'([a-z0-9-]+)' *,/g)) {
      record(stage, file); record(stage + '-complete', file);
    }
  }
  return found;
}

test('the scan finds the stages it is supposed to be guarding', () => {
  const found = emittedStages();
  // A silently-empty scan would make every other assertion here vacuous.
  assert.ok(found.size >= 30, `only ${found.size} stages found`);
  for (const expected of ['fallback-cpu', 'model-loaded', 'synthesis-complete', 'original-cache-invalid',
    'encoder-shard-acquisition', 'photo-decode', 'photo-decode-complete', 'asset-acquisition',
    // The conditional stage expression in runtime.mjs must keep being scanned, branch by branch.
    'transient-frame', 'original-cached', 'cache-unavailable'])
    assert.ok(found.has(expected), `scan missed ${expected}`);
});

test('every emitted stage is labelled or explicitly silent — none falls through to "Working…"', () => {
  const accounted = accountedStages();
  const orphans = [...emittedStages()].filter(([stage]) => !accounted.has(stage))
    .map(([stage, files]) => `${stage} (${[...files].join(', ')})`);
  assert.deepEqual(orphans, [], 'stages with no label and no recorded silence: ' + orphans.join('; '));
});

test('no label is a generic present participle standing in for a real message', () => {
  for (const [stage, label] of Object.entries(STAGE_LABELS)) {
    assert.notEqual(label, 'Working…', stage);
    assert.ok(label.trim().length > 3, stage);
  }
});

test('an unknown stage is reported as unknown rather than given a filler word', () => {
  assert.equal(labelFor('a-stage-nobody-wrote'), undefined);
  assert.equal(labelFor('gpu-stage'), null);
  assert.equal(labelFor('face', { text: 'Face 1 of 2' }), 'Face 1 of 2');
});

test('a completion event is past tense, never a present participle', () => {
  for (const [stage, label] of Object.entries(STAGE_LABELS))
    if (!STEP_STAGES.has(stage) && (stage.endsWith('-complete') || stage === 'model-loaded' || stage === 'encoder-loaded'))
      assert.ok(!label.endsWith('…'), `${stage} announces a finished phase as if it were still running`);
});

test('byte-carrying stages count bytes, whichever field name the emitter used', () => {
  assert.equal(loadedBytes({ completed: 5 }), 5);
  assert.equal(loadedBytes({ loaded: 7 }), 7);
  assert.equal(loadedBytes({}), undefined);
  assert.equal(labelFor('asset-acquisition', { loaded: 60 * 1048576, total: 120 * 1048576 }),
    'Downloading model files… 60 MB of 120 MB');
  // The landmark worker reports `completed`, which used to make the fraction NaN and the bar zero.
  assert.equal(labelFor('alignment-model-download', { completed: 40 * 1048576, total: 95 * 1048576 }),
    'Downloading the face detector… 40 MB of 95 MB');
  // A small asset says nothing about bytes rather than "0 MB of 0 MB".
  assert.equal(labelFor('asset-acquisition', { loaded: 1024, total: 2048 }), 'Downloading model files…');
  assert.equal(labelFor('encoder-shard-acquisition', { loaded: 42, total: 108 }), 'Encoding your photo… 42 of 108');
});

test('silence and self-text never overlap with a label', () => {
  for (const stage of SILENT_STAGES) assert.ok(!(stage in STAGE_LABELS), stage);
  for (const stage of SELF_TEXT_STAGES) assert.ok(!(stage in STAGE_LABELS), stage);
});

test('a cache hit is not announced as a download', () => {
  const MB = 1048576;
  // Every byte already on the device: the bar still crosses (reading and verifying 203 MB is not
  // free) but the words must not claim a download. This is the line the operator read as a
  // gigabyte re-downloading on every visit while the cache was in fact complete.
  assert.equal(labelFor('asset-acquisition', { loaded: 183 * MB, total: 203 * MB, fetched: 0, fetchedTotal: 0 }),
    'Loading model files from this device…');
  // Partly warm: the count is what is crossing the network, not what the bar covers. Saying
  // "20 MB of 20 MB" when 20 MB is being fetched is the whole point — the visitor is waiting on
  // the network, not on the cache.
  assert.equal(labelFor('asset-acquisition', { loaded: 190 * MB, total: 203 * MB, fetched: 7 * MB, fetchedTotal: 20 * MB }),
    'Downloading model files… 7 MB of 20 MB');
  // Cold: fetched and total agree, and the line reads exactly as it always did.
  assert.equal(labelFor('asset-acquisition', { loaded: 60 * MB, total: 120 * MB, fetched: 60 * MB, fetchedTotal: 120 * MB }),
    'Downloading model files… 60 MB of 120 MB');
  // An emitter that does not know the difference keeps the old line rather than a silent lie
  // in the other direction.
  assert.equal(labelFor('asset-acquisition', { loaded: 60 * MB, total: 120 * MB }),
    'Downloading model files… 60 MB of 120 MB');
});

test('the morph counter counts finished frames and never goes backwards, in any order', async () => {
  const { createFrameCounter } = await import('./stage-labels.mjs');
  const counter = createFrameCounter(5);
  assert.equal(counter.start().text, 'Generating 0 / 5 images');
  const seen = [4, 0, 2, 2, 1, 3].map(index => counter.complete(index).done);
  assert.deepEqual(seen, [1, 2, 3, 3, 4, 5]);
  assert.equal(counter.complete(3).text, 'Generating 5 / 5 images');
});
