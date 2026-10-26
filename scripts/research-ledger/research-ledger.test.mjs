// check-research-ledger tests: the rules as plain values, and the CLI against real temporary Git
// repositories (this repository and a classic fixture with its own branches).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { run } from '../check-research-ledger.mjs';
import { COLUMNS, checkClassicFork, checkLedger, checkLinks, checkLog } from './lib.mjs';

const header = COLUMNS.join('\t');
const row = (id, status = 'inconclusive', hypothesis = 'mechanism and next gate') =>
  [
    id,
    'browser-gpu',
    'eris RTX 2080 SUPER / Chromium WebGPU',
    'cold face',
    'not_measured',
    '10,11,12',
    '9,9,10',
    'full31 31/31',
    status,
    'autoresearch/rounds/x/report.json',
    hypothesis,
  ].join('\t');
const snapshotText = `${header}\n${row('legacy-1', 'proposed')}\n${row('legacy-2', 'baseline')}\n`;
const snapshotBytes = Buffer.from(snapshotText);
const snapshot = {
  size: snapshotBytes.length,
  sha256: createHash('sha256').update(snapshotBytes).digest('hex'),
};
const kinds = (problems) => problems.map((p) => p.kind);
const ledger = (text, base = snapshotText) =>
  checkLedger({
    head: Buffer.from(text),
    base: base === null ? null : Buffer.from(base),
    snapshot,
  });

test('a valid appended row passes; legacy labels inside the snapshot are left alone', () => {
  assert.deepEqual(ledger(`${snapshotText}${row('new-1')}\n`), []);
  assert.deepEqual(
    ledger(
      `${snapshotText}${row('new-1')}\n${row('new-2', 'keep', 'corrects new-1: rerun with warmup discarded')}\n`,
    ),
    [],
  );
});

test('each ledger violation fails with its kind', () => {
  const rewritten = snapshotText.replace('legacy-2', 'legacy-2b');
  assert.ok(kinds(ledger(`${rewritten}${row('new-1')}\n`)).includes('rewritten'));
  assert.ok(kinds(ledger(`${rewritten}${row('new-1')}\n`)).includes('snapshot-prefix'));
  assert.ok(kinds(ledger(snapshotText.replace('hypothesis', 'notes'), null)).includes('header'));
  assert.deepEqual(kinds(ledger(`${snapshotText}${row('legacy-1')}\n`)), ['duplicate-id']);
  assert.deepEqual(
    kinds(ledger(`${snapshotText}${row('new-1', 'keep', 'corrects missing-9: typo')}\n`)),
    ['correction'],
  );
  assert.deepEqual(kinds(ledger(`${snapshotText}${row('new-1', 'proposed')}\n`)), ['outcome']);
  assert.deepEqual(kinds(ledger(`${snapshotText}${row('new-1')}\textra\n`)), ['columns']);
  assert.deepEqual(kinds(ledger(`${snapshotText}${row('new-1')}`)), ['no-final-newline']);
  // A correction must cite an earlier row, not a later one.
  assert.deepEqual(
    kinds(ledger(`${snapshotText}${row('new-1', 'keep', 'corrects new-2: x')}\n${row('new-2')}\n`)),
    ['correction'],
  );
});

test('restoring the snapshot over a base that lost it is a repair; rewriting an intact base still fails', () => {
  const broken = snapshotText.replace('legacy-2', 'legacy-2b');
  assert.deepEqual(ledger(`${snapshotText}${row('new-1')}\n`, `${broken}${row('new-1')}\n`), []);
  assert.ok(kinds(ledger(`${broken}${row('new-1')}\n`, broken)).includes('snapshot-prefix'));
  assert.ok(
    kinds(ledger(`${snapshotText}${row('new-1b')}\n`, `${snapshotText}${row('new-1')}\n`)).includes(
      'rewritten',
    ),
  );
});

test('a frozen imported log restored to its imported digest is not a rewrite; any other change is', () => {
  const imported = Buffer.from('# Log\n\n## 2026-10-10 original heading\n');
  const digest = createHash('sha256').update(imported).digest('hex');
  const edited = Buffer.from('# Log\n\n## 2026-10-10 edited heading\n');
  const restore = { path: 'l', head: imported, base: edited, frozen: true, imported: digest };
  assert.deepEqual(checkLog(restore), []);
  assert.deepEqual(kinds(checkLog({ ...restore, head: Buffer.from('# Log\n') })), [
    'log-rewritten',
  ]);
  assert.deepEqual(kinds(checkLog({ ...restore, imported: null })), ['log-rewritten']);
});

test('round logs only grow at EOF, with timezone-aware timestamps and unique IDs', () => {
  const entry = (ts, id) => `### ${ts} — ${id}\n\n- Phase / status: observed / x\n`;
  const base = Buffer.from(`# Log\n\n${entry('2026-10-24T09:00:00+10:00', 'e1')}`);
  assert.deepEqual(
    checkLog({
      path: 'l',
      base,
      head: Buffer.concat([base, Buffer.from(entry('2026-10-24T10:00:00Z', 'e2'))]),
    }),
    [],
  );
  assert.deepEqual(
    kinds(
      checkLog({
        path: 'l',
        base,
        head: Buffer.from(
          `# Log\n\n${entry('2026-10-24T09:00:00+10:00', 'e0')}${entry('2026-10-24T09:00:00+10:00', 'e1')}`,
        ),
      }),
    ),
    ['log-rewritten'],
  );
  assert.deepEqual(
    kinds(
      checkLog({
        path: 'l',
        base,
        head: Buffer.concat([base, Buffer.from(entry('2026-10-24T10:00:00', 'e2'))]),
      }),
    ),
    ['log-timestamp'],
  );
  assert.deepEqual(
    kinds(
      checkLog({
        path: 'l',
        base,
        head: Buffer.concat([base, Buffer.from(entry('2026-10-24T10:00:00Z', 'e1'))]),
      }),
    ),
    ['log-duplicate-id'],
  );
  assert.deepEqual(
    kinds(checkLog({ path: 'l', base: null, head: Buffer.from('### untitled thoughts\n') })),
    ['log-heading'],
  );
  // Frozen historical logs are only checked for growth.
  assert.deepEqual(
    checkLog({ path: 'l', base: null, head: Buffer.from('### untitled thoughts\n'), frozen: true }),
    [],
  );
});

test('classic fork detection', () => {
  const appended = Buffer.concat([snapshotBytes, Buffer.from(`${row('classic-new')}\n`)]);
  assert.deepEqual(
    checkClassicFork({
      classic: [
        { ref: 'master', bytes: null },
        { ref: 'candidate', bytes: snapshotBytes },
      ],
      snapshotBytes,
    }),
    [],
  );
  assert.deepEqual(
    checkClassicFork({
      classic: [{ ref: 'old', bytes: snapshotBytes.subarray(0, snapshotText.indexOf('legacy-2')) }],
      snapshotBytes,
    }),
    [],
  );
  const fork = checkClassicFork({
    classic: [{ ref: 'candidate', bytes: appended }],
    snapshotBytes,
  });
  assert.deepEqual(kinds(fork), ['classic-new-round']);
  assert.match(fork[0].detail, /classic-new/);
  assert.deepEqual(
    kinds(
      checkClassicFork({
        classic: [{ ref: 'candidate', bytes: Buffer.from(`${header}\nx`) }],
        snapshotBytes,
      }),
    ),
    ['classic-diverged'],
  );
});

test('links: relative and repository GitHub links must resolve', () => {
  const present = new Set(['autoresearch/program.md', 'PLAN.md', 'autoresearch/rounds']);
  const exists = (p) => present.has(p);
  const doc = (text) => [{ path: 'autoresearch/README.md', text }];
  assert.deepEqual(
    checkLinks(
      doc(
        '[p](program.md) [plan](../PLAN.md#x) [r](rounds/) [web](https://example.com/x) [a](#top)',
      ),
      exists,
    ),
    [],
  );
  assert.deepEqual(kinds(checkLinks(doc('[gone](records.md)'), exists)), ['dead-link']);
  assert.deepEqual(kinds(checkLinks(doc('[out](../../elsewhere.md)'), exists)), ['dead-link']);
  const pointer = [
    {
      path: 'classic:autoresearch/MOVED.md',
      base: '',
      text: '[guide](https://github.com/facemorph-me/facemorph.me/blob/main/PLAN.md) [x](https://github.com/facemorph-me/facemorph.me/blob/main/autoresearch/nope.md)',
    },
  ];
  assert.deepEqual(
    checkLinks(pointer, exists).map((p) => p.target),
    ['https://github.com/facemorph-me/facemorph.me/blob/main/autoresearch/nope.md'],
  );
});

// ---- The CLI over real temporary repositories.
const sh = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 'test@example.invalid');
  sh(dir, 'config', 'user.name', 'test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}
const put = (dir, path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const commit = (dir, msg) => {
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', msg);
  return sh(dir, 'rev-parse', 'HEAD');
};

function destination() {
  const dir = repo();
  put(
    dir,
    'docs/research-import/digest-list.json',
    JSON.stringify({ files: [{ destination: 'autoresearch/results.tsv', ...snapshot }] }),
  );
  put(dir, 'autoresearch/results.tsv', snapshotText);
  for (const p of ['README.md', 'program.md', 'records.md'])
    put(dir, `autoresearch/${p}`, `# ${p}\n\n[ledger](results.tsv) [plan](../PLAN.md)\n`);
  put(dir, 'ops/lease/README.md', '# lease\n');
  put(dir, 'PLAN.md', '# plan\n');
  put(
    dir,
    'autoresearch/rounds/2026-10-24-handover/log.md',
    '# Log\n\n### 2026-10-24T09:00:00+10:00 — handover-1\n',
  );
  put(dir, 'autoresearch/reviews/2026-10-10/log.md', '# Old\n\n### historic heading\n');
  return { dir, base: commit(dir, 'handover') };
}

function classicFixture(extraRow) {
  const dir = repo();
  put(dir, 'autoresearch/results.tsv', snapshotText);
  commit(dir, 'snapshot');
  sh(dir, 'branch', '-M', 'master');
  sh(dir, 'checkout', '-q', '-b', 'candidate/next-delivery-20260916');
  put(
    dir,
    'autoresearch/MOVED.md',
    '# Moved\n\n[guide](https://github.com/facemorph-me/facemorph.me/blob/main/autoresearch/README.md)\n',
  );
  if (extraRow) put(dir, 'autoresearch/results.tsv', `${snapshotText}${row('classic-round')}\n`);
  commit(dir, 'pointer');
  return dir;
}

test('CLI: an appended row and log entry pass; a rewrite and a classic round fail', () => {
  const { dir, base } = destination();
  put(dir, 'autoresearch/results.tsv', `${snapshotText}${row('new-1')}\n`);
  put(
    dir,
    'autoresearch/rounds/2026-10-24-handover/log.md',
    '# Log\n\n### 2026-10-24T09:00:00+10:00 — handover-1\n### 2026-10-24T10:00:00+10:00 — smoke-1\n',
  );
  assert.deepEqual(run({ root: dir, base, classic: classicFixture(false) }), []);
  assert.deepEqual(kinds(run({ root: dir, base, classic: classicFixture(true) })), [
    'classic-new-round',
  ]);
  put(
    dir,
    'autoresearch/results.tsv',
    `${snapshotText.replace('legacy-1', 'legacy-x')}${row('new-1')}\n`,
  );
  put(dir, 'autoresearch/program.md', '[gone](missing.md)\n');
  const problems = kinds(run({ root: dir, base, classic: null }));
  assert.ok(
    problems.includes('rewritten') &&
      problems.includes('snapshot-prefix') &&
      problems.includes('dead-link'),
    problems.join(),
  );
});

test('CLI: classic without the forward pointer fails', () => {
  const { dir, base } = destination();
  const classic = repo();
  put(classic, 'autoresearch/results.tsv', snapshotText);
  commit(classic, 'snapshot');
  sh(classic, 'branch', '-M', 'candidate/next-delivery-20260916');
  assert.deepEqual(kinds(run({ root: dir, base, classic })), ['classic-pointer-missing']);
});
