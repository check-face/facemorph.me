// The browser matrix summary (fm-7ge) on fixture reports: only a run where every row passed every required stage
// renders as passing; a failed, missing, build-limited or unreadable cell, or no report at all, is INCOMPLETE and
// exits 1. Runs the real scripts/next-matrix-summary.py in a temporary directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/next-matrix-summary.py', import.meta.url));
const STAGES = [
  'nameSeed',
  'repeatOriginal',
  'photoE4e',
  'localCrop',
  'projectSaveReopen',
  'morphExport',
  'morphPlayback',
];
const passing = () => Object.fromEntries(STAGES.map((s) => [s, { passed: true }]));

function summarise(reports: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'next-matrix-summary-'));
  try {
    for (const [name, body] of Object.entries(reports))
      writeFileSync(
        join(dir, `next-matrix-${name}.json`),
        typeof body === 'string' ? body : JSON.stringify(body),
      );
    const r = spawnSync('python3', [SCRIPT, dir], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, text: readFileSync(join(dir, 'next-matrix-summary.md'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const rows = [
  'ubuntu-24.04-chromium',
  'ubuntu-24.04-firefox',
  'ubuntu-24.04-webkit',
  'macos-14-webkit',
  'macos-14-firefox',
];

test('five passing rows render as passing, each row named', () => {
  const r = summarise(Object.fromEntries(rows.map((n) => [n, { agent: n, stages: passing() }])));
  assert.equal(r.status, 0);
  assert.match(r.text, /Required stages across every row: pass/);
  for (const n of rows) assert.match(r.text, new RegExp(`\`${n}\``));
});

test('a failed, missing, build-limited or unreadable cell, or no report, is never rendered as passing', () => {
  const variants: Record<string, Record<string, unknown>> = {
    failed: { photoE4e: { passed: false } },
    missing: { morphExport: undefined },
    buildLimited: { morphPlayback: { passed: true, buildLimitation: 'no H.264 in this build' } },
  };
  for (const [label, change] of Object.entries(variants)) {
    const stages: Record<string, unknown> = { ...passing(), ...change };
    for (const k of Object.keys(stages)) if (stages[k] === undefined) delete stages[k];
    const reports: Record<string, unknown> = Object.fromEntries(
      rows.map((n) => [n, { stages: passing() }]),
    );
    reports['macos-14-webkit'] = { stages };
    const r = summarise(reports);
    assert.equal(r.status, 1, label);
    assert.match(r.text, /Required stages across every row: INCOMPLETE/, label);
    assert.doesNotMatch(r.text, /Required stages across every row: pass/, label);
  }
  const unreadable = summarise({
    ...Object.fromEntries(rows.map((n) => [n, { stages: passing() }])),
    'macos-14-firefox': '{',
  });
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.text, /unreadable/);
  const none = summarise({});
  assert.equal(none.status, 1);
  assert.match(none.text, /no reports were produced/);
});
