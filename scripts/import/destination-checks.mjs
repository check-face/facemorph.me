#!/usr/bin/env node
// Classic's next-site.yml job `artifact`, run in this repository against the imported closure (apps/web) and the
// build:next output (fm-5ey). The step list and the test-file owners come from import/build-inputs.json `checks`.
// Every check must show a non-zero count, or it fails as a silent skip; the two Fable checks are reported
// `not applicable until the port` with their successors, never as passed.
//   npm run build:next && node scripts/import/destination-checks.mjs
// One JSON line per check, then a summary; exit 1 when any applicable check fails.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INPUTS, REPO, line, readJson } from '../inventory/lib.mjs';
import { readIdentity } from './build-next.mjs';

const WEB = join(REPO, 'apps/web');
const NOT_APPLICABLE = 'not applicable until the port';

export function testFiles(dir, root = dir, found = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, root, found);
    else if (entry.endsWith('.test.mjs')) found.push(relative(root, full).split('\\').join('/'));
  }
  return found;
}

/** Classic's check-tests-listed rule on destination paths: every src/Next test is run here or owned elsewhere. */
export function listedFindings(present, rows) {
  const known = new Map(rows.map((r) => [r.file, r]));
  const out = [];
  for (const file of present) {
    const row = known.get(file);
    if (!row) out.push({ file, problem: 'not run and not owned' });
    else if (row.runs_on !== 'closure' && !row.owner)
      out.push({ file, problem: 'left in classic with no owner' });
  }
  return out;
}

/** Counts from node --test's summary lines: spec reporter `ℹ tests N` (Node 23+) or TAP `# tests N` (Node 22). */
export function nodeTestCounts(output) {
  const count = (name) =>
    Number(output.match(new RegExp(`^(?:ℹ|#) ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
  return { tests: count('tests'), pass: count('pass'), fail: count('fail') };
}

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const lastJson = (text) => {
  const l = text
    .trim()
    .split('\n')
    .filter((s) => s.startsWith('{'))
    .at(-1);
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
};

export function checks({ rows }) {
  const out = [];
  const add = (check) => {
    out.push(check);
    line(check);
  };
  const closure = rows.filter((r) => r.runs_on === 'closure').map((r) => r.file);
  const elsewhere = rows.filter((r) => r.runs_on !== 'closure');

  const present = testFiles(join(WEB, 'src/Next')).map((f) => `src/Next/${f}`);
  const missingListed = listedFindings(present, rows);
  add({
    step: 'Every test file is actually run',
    command: 'listedFindings (classic check-tests-listed.mjs on destination paths)',
    count: present.length,
    ok: present.length > 0 && missingListed.length === 0,
    findings: missingListed,
  });

  const present_closure = closure.filter((f) => existsSync(join(WEB, f)));
  const t = run(process.execPath, ['--test', ...present_closure], WEB);
  const counts = nodeTestCounts(t.stdout + t.stderr);
  add({
    step: 'Shipping runtime, media, privacy and input regressions',
    command: `node --test <${present_closure.length} files>`,
    files: present_closure.length,
    ...counts,
    ok:
      t.status === 0 &&
      counts.tests > 0 &&
      counts.fail === 0 &&
      present_closure.length === closure.length,
    missing: closure.filter((f) => !present_closure.includes(f)),
    leftInClassic: elsewhere.map((r) => ({ file: r.file, owner: r.owner })),
  });

  add({
    step: 'Compiled UI imports resolve against the hand-written bridges',
    command: 'node scripts/check-bridge-imports.mjs',
    status: NOT_APPLICABLE,
    successor:
      'migration.facade (fm-pia9) strict TS; scripts/inventory/unresolved-imports.mjs runs in its place',
    ok: true,
  });
  const u = run(
    process.execPath,
    [
      join(REPO, 'scripts/inventory/unresolved-imports.mjs'),
      '--root',
      'apps/web',
      '--lock',
      // The app's own lockfile until the workspace scaffold (fm-fy2.4) moved it to the root one.
      existsSync(join(REPO, 'apps/web/package-lock.json')) ? 'apps/web/package-lock.json' : 'package-lock.json',
    ],
    REPO,
  );
  const us = lastJson(u.stdout)?.summary ?? {};
  const only = u.stdout
    .split('\n')
    .filter((l) => l.includes('"importer"'))
    .map((l) => JSON.parse(l));
  add({
    step: 'Unresolved imports in the closure (in place of check-bridge-imports)',
    command: 'node scripts/inventory/unresolved-imports.mjs --root apps/web',
    count: us.files,
    specifiers: us.specifiers,
    unresolved: only.map((f) => `${f.importer} -> ${f.specifier}`),
    ok:
      u.status === 0 &&
      us.files > 0 &&
      only.length === 1 &&
      only[0].specifier === './ProjectJson.fs.js',
  });

  const p = run(process.execPath, ['scripts/check-progress-copy.mjs'], WEB);
  const ps = lastJson(p.stdout) ?? {};
  add({
    step: 'Morph progress line is a counter, not a flicker',
    command: 'node scripts/check-progress-copy.mjs',
    count: Object.keys(ps).length,
    result: ps,
    ok: p.status === 0 && ps.monotonic === true && ps.otherStagesSilent === true,
  });

  const g = run(process.execPath, ['src/Next/geometry/verify.mjs'], WEB);
  const gs = lastJson(g.stdout) ?? {};
  add({
    step: 'Independent reviewed morph geometry',
    command: 'node src/Next/geometry/verify.mjs',
    count: (gs.referenceCases ?? 0) + (gs.invariantCases ?? 0),
    result: gs.status,
    ok: g.status === 0 && gs.status === 'passed' && gs.referenceCases > 0,
  });

  const { identity, findings } = readIdentity(REPO);
  add({
    step: 'Build the actual new-site artifact',
    command: 'npm run build:next',
    count: identity?.files?.length ?? 0,
    label: identity?.label ?? null,
    deploySource: identity?.deploySource ?? null,
    ok: findings.length === 0,
    findings,
  });

  const preview = 'src/public/preview/hello-1024.webp';
  const same =
    existsSync(join(WEB, preview)) &&
    existsSync(join(REPO, 'deploy-next/preview/hello-1024.webp')) &&
    readFileSync(join(WEB, preview)).equals(
      readFileSync(join(REPO, 'deploy-next/preview/hello-1024.webp')),
    );
  add({
    step: 'Historic hello preview is included byte for byte',
    command: `cmp apps/web/${preview} deploy-next/preview/hello-1024.webp`,
    count: existsSync(join(WEB, preview)) ? statSync(join(WEB, preview)).size : 0,
    ok: same,
  });

  add({
    step: 'Exercise compiled project import and export',
    command: 'node src/Next/verify-fable.mjs src/Next/ProjectJson.fs.js',
    status: NOT_APPLICABLE,
    successor: 'migration.facade (fm-pia9) ProjectJson goldens',
    ok: true,
  });

  const n = run(
    process.execPath,
    [join(WEB, 'scripts/check-no-third-party.mjs'), 'deploy-next'],
    REPO,
  );
  const ns = lastJson(n.stdout) ?? {};
  const scanned = existsSync(join(REPO, 'deploy-next'))
    ? allFiles(join(REPO, 'deploy-next')).length
    : 0;
  add({
    step: 'No third-party runtime dependencies',
    command: 'node apps/web/scripts/check-no-third-party.mjs deploy-next',
    count: scanned,
    thirdParty: ns.thirdPartyRuntimeDependencies,
    ok: n.status === 0 && ns.thirdPartyRuntimeDependencies === 0 && scanned > 0,
  });

  const sums = existsSync(join(REPO, 'next-site-SHA256SUMS'))
    ? readFileSync(join(REPO, 'next-site-SHA256SUMS'), 'utf8').trim().split('\n').length
    : 0;
  add({
    step: 'Record exact bytes for promotion',
    command: 'next-site-SHA256SUMS (from the control)',
    count: sums,
    ok: sums > 0 && sums === scanned,
  });
  return out;
}

function allFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allFiles(full, found);
    else found.push(full);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = readJson(BUILD_INPUTS).checks.node_test_files;
  const result = checks({ rows });
  const failed = result.filter((c) => !c.ok);
  line({
    summary: {
      ok: failed.length === 0,
      checks: result.length,
      notApplicable: result.filter((c) => c.status === NOT_APPLICABLE).length,
      failed: failed.map((c) => c.step),
    },
  });
  process.exit(failed.length ? 1 : 0);
}
