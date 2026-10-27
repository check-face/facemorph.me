import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { markdown, record } from './failures.mjs';

test('a failure needs its check and its local repro command', () => {
  assert.throws(() => record({ check: 'timing' }), /--repro/);
});

test('the summary lists every failure with its numbers, bundle link and repro command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'failures-'));
  writeFileSync(join(dir, 'numbers.txt'), 'FAIL warmFaceMs: build 7691 / control 4334 = 1.775\n');
  const failures = [
    record({
      check: 'timing (face)',
      repro: 'npm run release:local -- --only timing:face',
      bundle: 'bundle-timing-face',
      numbers: join(dir, 'numbers.txt'),
      detail: 'warmFaceMs 1.78x',
    }),
    record({
      check: 'journeys (firefox, operated)',
      repro: 'npm run release:local -- --only journeys:firefox:operated',
    }),
  ];
  const md = markdown(failures, {
    'bundle-timing-face': 'https://github.com/o/r/actions/runs/1/artifacts/2',
  });
  assert.match(md, /^## 2 failing checks/);
  assert.match(
    md,
    /\| timing \(face\) \| warmFaceMs 1\.78x \| \[bundle-timing-face\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/2\) \| `npm run release:local -- --only timing:face` \|/,
  );
  assert.match(md, /\| journeys \(firefox, operated\) \| – \| – \|/);
  assert.match(md, /### timing \(face\)\n\n```\nFAIL warmFaceMs: build 7691/);
  assert.equal(markdown([]), '## Release checks\n\nNo check failed.\n');
});
