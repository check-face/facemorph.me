import assert from 'node:assert/strict';
import test from 'node:test';
import { check } from './median-check.mjs';

const run = (side, coldFaceMs, reliability = {}) => ({
  side,
  measures: { values: { coldFaceMs }, bytes: { first: 100, return: 10 } },
  reliability: { faceProduced: true, videoProduced: true, reloads: 0, ...reliability },
});
const control = [run('control', 10000), run('control', 11000), run('control', 9000)];

test('a build within the threshold passes; one beyond it fails on that measure', () => {
  assert.equal(
    check({ control, build: [run('build', 10500), run('build', 11200), run('build', 9900)] }, 0.15)
      .ok,
    true,
  );
  const slow = check(
    { control, build: [run('build', 13000), run('build', 12500), run('build', 14000)] },
    0.15,
  );
  assert.equal(slow.ok, false);
  assert.deepEqual(
    slow.rows.filter((r) => !r.ok).map((r) => r.measure),
    ['coldFaceMs'],
  );
});

test('a lost video or a reload fails the build whatever its timings', () => {
  const build = [run('build', 90), run('build', 90, { videoProduced: false }), run('build', 90)];
  assert.equal(check({ control, build }, 0.15).ok, false);
  assert.equal(check({ control, build: [run('build', 90, { reloads: 1 })] }, 0.15).ok, false);
});

test('a timed measure over the ratio but within 50 ms of the control passes; past both it fails', () => {
  const save = (side, firstSaveMs) => ({
    ...run(side, 100),
    measures: { values: { coldFaceMs: 100, firstSaveMs }, bytes: { first: 100, return: 10 } },
  });
  const control = [save('control', 74), save('control', 74), save('control', 74)];
  // Release run 40542780390: firstSaveMs 93 vs 74 ms, 1.26x and 19 ms.
  assert.equal(
    check({ control, build: [save('build', 93), save('build', 93), save('build', 93)] }, 0.15).ok,
    true,
  );
  assert.equal(
    check({ control, build: [save('build', 125), save('build', 125), save('build', 125)] }, 0.15)
      .ok,
    false,
  );
});

test('byte counts keep the ratio alone', () => {
  const bytes = (side, first) => ({
    ...run(side, 100),
    measures: { values: { coldFaceMs: 100 }, bytes: { first, return: 10 } },
  });
  assert.equal(
    check({ control: [bytes('control', 100)], build: [bytes('build', 130)] }, 0.15).ok,
    false,
  );
});

// ---- segments, merged dirs and the sequential stop --------------------------------------------------------------
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, evaluate, findDirs, loadDir, report, toPairs, within } from './median-check.mjs';

const ok = { faceProduced: true, photoFaceProduced: false, videoProduced: false, reloads: 0 };
const photoRun = (side, pair, photoEncodeMs, extra = {}) => ({
  side,
  pair,
  order: pair % 2 ? 'BA' : 'AB',
  index: 0,
  failure: null,
  measures: { values: { photoEncodeMs }, bytes: { first: null, return: null } },
  reliability: { ...ok, photoFaceProduced: true },
  ...extra,
});
const pairsOf = (rows) =>
  toPairs(rows.flatMap(([c, b], i) => [photoRun('control', i, c), photoRun('build', i, b)]));

test('within: ratio or, for a time, the 50 ms floor; bytes the ratio alone', () => {
  assert.equal(within('coldFaceMs', 1150, 1000, 0.15).ok, true);
  assert.equal(within('coldFaceMs', 1160, 1000, 0.15).ok, false);
  assert.equal(within('firstSaveMs', 120, 74, 0.15).ok, true);
  assert.equal(within('bytesFirst', 120, 74, 0.15).ok, false);
});

test('decide: under the minimum asks for more; a unanimous pass or fail stops at the minimum', () => {
  const two = decide(
    pairsOf([
      [10000, 10100],
      [10000, 9900],
    ]),
    { segment: 'photo' },
  );
  assert.equal(two.verdict, 'more');
  assert.deepEqual(two.nextPairs, [2]);
  const pass = decide(
    pairsOf([
      [10000, 10100],
      [10000, 9900],
      [9000, 9500],
    ]),
    { segment: 'photo' },
  );
  assert.equal(pass.verdict, 'pass');
  assert.equal(pass.rows[0].pairs.length, 3);
  const fail = decide(
    pairsOf([
      [10000, 12000],
      [10000, 12500],
      [9000, 11000],
    ]),
    {
      segment: 'photo',
    },
  );
  assert.equal(fail.verdict, 'fail');
  assert.match(fail.reason, /every pair: photoEncodeMs/);
});

test('decide: disagreeing pairs ask for the rest up to the maximum, where the medians decide', () => {
  const mixed = [
    [10000, 12000],
    [10000, 10000],
    [10000, 10100],
  ];
  const m = decide(pairsOf(mixed), { segment: 'photo', maxPairs: 7 });
  assert.equal(m.verdict, 'more');
  assert.deepEqual(m.nextPairs, [3, 4, 5, 6]);
  const atMax = decide(
    pairsOf([...mixed, [10000, 12000], [10000, 10000], [10000, 12000], [10000, 12000]]),
    {
      segment: 'photo',
      maxPairs: 7,
    },
  );
  assert.equal(atMax.verdict, 'fail', 'median build 12000 vs 10000 is over');
  const passAtMax = decide(
    pairsOf([...mixed, [10000, 10000], [10000, 10000], [10000, 12000], [10000, 10000]]),
    { segment: 'photo', maxPairs: 7 },
  );
  assert.equal(passAtMax.verdict, 'pass');
});

test('decide: a pass never stops early against the median rule (an even count where pairs pass and the median fails)', () => {
  // f(100) = 150, f(1000) = 1150; build medians (150 + 1150) / 2 = 650 > f(550) = 632.5.
  const d = decide(
    pairsOf([
      [100, 150],
      [1000, 1150],
      [100, 150],
      [1000, 1150],
    ]),
    {
      segment: 'photo',
      minPairs: 4,
      maxPairs: 7,
    },
  );
  assert.equal(d.rows[0].ok, false);
  assert.notEqual(d.verdict, 'pass');
});

test('decide: an unreliable or unfinished build run fails; a failed control run leaves its pair incomplete', () => {
  const lost = pairsOf([
    [10000, 10000],
    [10000, 10000],
    [10000, 10000],
  ]);
  lost[1].build = { ...lost[1].build, reliability: { ...ok, photoFaceProduced: false } };
  assert.equal(decide(lost, { segment: 'photo' }).verdict, 'fail');
  const unfinished = pairsOf([
    [10000, 10000],
    [10000, 10000],
    [10000, 10000],
  ]);
  unfinished[0].build = { ...unfinished[0].build, failure: 'timeout' };
  assert.match(decide(unfinished, { segment: 'photo' }).reason, /did not finish: timeout/);
  const flaky = pairsOf([
    [10000, 10000],
    [10000, 10000],
    [10000, 10000],
  ]);
  flaky[2].control = { ...flaky[2].control, failure: 'timeout' };
  const d = decide(flaky, { segment: 'photo' });
  assert.equal(d.verdict, 'more');
  assert.equal(d.complete, 2);
  assert.deepEqual(d.nextPairs, [3]);
  assert.equal(decide(flaky, { segment: 'photo', maxPairs: 3 }).verdict, 'fail');
});

test('a face segment does not need a video or photo face; the full journey does', () => {
  const faceRun = (side, pair) => ({
    ...photoRun(side, pair, null),
    measures: {
      values: Object.fromEntries(
        [
          'usablePageMs',
          'coldFaceMs',
          'nextFaceMs',
          'firstSaveMs',
          'repeatSaveMs',
          'warmFaceMs',
        ].map((k) => [k, 1000]),
      ),
      bytes: { first: 100, return: 10 },
    },
    reliability: ok,
  });
  const pairs = toPairs([0, 1, 2].flatMap((i) => [faceRun('control', i), faceRun('build', i)]));
  assert.equal(decide(pairs, { segment: 'face' }).verdict, 'pass');
  assert.equal(decide(pairs, { segment: 'all' }).verdict, 'fail');
});

test('dirs of one segment from separate jobs merge by pair index; reporting, JSON and the local rerun', () => {
  const root = mkdtempSync(join(tmpdir(), 'median-check-'));
  const digests = { control: 'c'.repeat(64), build: 'b'.repeat(64) };
  const cell = { provider: 'cpu', browser: 'chromium' };
  const job = (segment, pair, c, b) => {
    const dir = join(root, `job-${segment}-${pair}`, `release-1-${segment}-${pair}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'segment.json'),
      JSON.stringify({
        schema: 'facemorph.not-worse-segment/1',
        segment,
        invocation: {
          provider: 'cpu',
          browser: 'chromium',
          buildDigest: digests.build,
          buildSource: 'run:1',
        },
      }),
    );
    const sides =
      pair % 2
        ? [
            ['build', b],
            ['control', c],
          ]
        : [
            ['control', c],
            ['build', b],
          ];
    sides.forEach(([side, v], i) => {
      const name = `${String(i + 1).padStart(2, '0')}-${side}-${pair % 2 ? 'BA' : 'AB'}-p${pair}`;
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify({
          schema: 'facemorph.not-worse-run/1',
          cell,
          digests,
          runs: [{ ...photoRun(side, pair, v), index: i + 1 }],
        }),
      );
      writeFileSync(join(dir, `${name}.trace.json`), JSON.stringify({ failure: null }));
    });
  };
  job('photo', 0, 10000, 10100);
  job('photo', 1, 10000, 9900);
  job('photo', 2, 9000, 9500);
  const dirs = findDirs([root]);
  assert.equal(dirs.length, 3);
  const result = evaluate(dirs.map(loadDir), { expect: ['photo'] });
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(
    result.segments.photo.rows[0].pairs.map((p) => p.pair),
    [0, 1, 2],
  );
  assert.match(report(result), /p1 BA: 9900 \/ 10000 = 0\.990/);
  assert.equal(JSON.parse(JSON.stringify(result)).schema, 'facemorph.not-worse-timing/1');

  const missing = evaluate(dirs.map(loadDir), { expect: ['photo', 'morph'] });
  assert.equal(missing.verdict, 'fail');
  const text = report(missing);
  assert.match(text, /segment morph has no dir/);

  job('photo', 3, 9000, 13000);
  job('photo', 4, 9000, 13000);
  const more = evaluate(findDirs([root]).map(loadDir), {});
  assert.equal(more.verdict, 'more');
  const t = report(more);
  assert.match(t, /--segment photo/);
  assert.match(t, /--build deploy-next/);
  assert.match(t, /treeDigest\('deploy-next'\)/);
  assert.match(t, /needs more pairs: photo \[5, 6\]/);
});
