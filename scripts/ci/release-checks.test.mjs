import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMING_SEGMENTS, timingCommands } from './release-checks.mjs';

test('local timing runs three pairs then the stop rule and its verdict; CI runs one pair at its index', () => {
  const local = timingCommands({
    segment: 'photo',
    build: 'deploy-next',
    runtimeDir: '.cache/ci-runtime',
    out: 'o',
    local: true,
  });
  assert.match(local[1], /--segment photo --pairs 3 --max-pairs 7 /);
  assert.equal(
    local[2],
    'node scripts/verify/not-worse/median-check.mjs o/release-local-photo --expect photo',
  );
  const ci = timingCommands({
    segment: 'face',
    build: 'artifact/deploy-next',
    runtimeDir: 'r',
    out: 'o',
    pair: 2,
    digest: 'abc',
    source: 'run:1',
  });
  assert.match(
    ci[1],
    /--build-digest abc --build-source run:1 --segment face --pairs 1 --pair-index 2 /,
  );
  assert.equal(ci.length, 2);
  assert.deepEqual(TIMING_SEGMENTS, ['face', 'morph', 'photo']);
  assert.throws(() => timingCommands({ segment: 'all', build: 'b', runtimeDir: 'r', out: 'o' }));
});

test('a CI segment job without a pair index runs three pairs and the stop rule, and waits for the machine lock', () => {
  const ci = timingCommands({
    segment: 'morph',
    build: 'b',
    runtimeDir: 'r',
    out: 'o',
    pair: null,
    digest: 'd',
    label: 'L',
  });
  assert.match(ci[1], /--exclusive gpu-timing --wait 3600 /);
  assert.match(ci[1], /--segment morph --pairs 3 --max-pairs 3 /);
  assert.equal(ci[2], 'node scripts/verify/not-worse/median-check.mjs o/L --expect morph');
});

test("a core set pins the timing job and takes only that set's lock", () => {
  const ci = timingCommands({
    segment: 'photo',
    build: 'b',
    runtimeDir: 'r',
    out: 'o',
    pair: null,
    digest: 'd',
    cpus: '4-7',
  });
  assert.match(
    ci[1],
    /^taskset -c 4-7 python3 autoresearch\/run\.py --exclusive cpu-timing-4-7 --wait 3600 /,
  );
});
