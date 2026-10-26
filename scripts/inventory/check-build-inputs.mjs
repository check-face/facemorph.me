#!/usr/bin/env node
// Checks import/build-inputs.json against classic's Git objects at the frozen commit:
//   - runtime.assets equals the files classic's mirror-runtime.py acquires: every pin in the overlay
//     manifest and in the nested manifests copied under import/runtime-manifests/ (each copy checked
//     against its pin), plus the files it takes from the repository (manifest, photo worker siblings,
//     notices); every row has a location, a sha256 and acquisition commands that exist;
//   - checks.node_test_files and checks.next_site_artifact_job cover exactly the frozen next-site.yml
//     artifact job's test list and steps;
//   - the candidate ledger has a row for each of PLAN.md's defects 1-23.
//   node scripts/inventory/check-build-inputs.mjs [--classic <dir>]            check
//   node scripts/inventory/check-build-inputs.mjs --write [--classic <dir>]    regenerate the generated sections
//   node scripts/inventory/check-build-inputs.mjs --acquired <runtime dir>     also prove an acquired tree is exactly the rows
//   node scripts/inventory/check-build-inputs.mjs --fetch                      also follow the nested manifests that
//                                                                               have no committed copy, from the origin
// One JSON line per finding, then a summary; exit 1 on any finding.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_INPUTS,
  REPO,
  blob,
  classicDir,
  git,
  line,
  options,
  pinnedRuntime,
  readJson,
  sha256,
} from './lib.mjs';

const OVERLAY = 'hosting/next-static/runtime-overlay';
const COPIES = join(REPO, 'import/runtime-manifests');
// mirror-runtime.py copies these from photo-runtime/ beside the pinned photo worker.
const PHOTO_SIBLINGS = [
  'align-photo.mjs',
  'photo-worker.mjs',
  'image-header.mjs',
  'sha256.mjs',
  'THIRD_PARTY_NOTICES.txt',
];
const RUNNABLE = /\.(mjs|js|wasm)$/;

// Derives the runtime rows. `fetched` maps a nested manifest path to bytes fetched from the origin.
export function deriveRuntime(dir, commit, origin, fetched = new Map()) {
  const findings = [];
  const manifestBytes = blob(dir, commit, `${OVERLAY}/manifest.json`);
  const pins = pinnedRuntime(JSON.parse(manifestBytes));
  const nested = [];
  for (
    let followed = new Set(), next;
    (next = Object.keys(pins).filter((p) => p.endsWith('manifest.json') && !followed.has(p)))
      .length;
  ) {
    for (const path of next) {
      followed.add(path);
      const copy = join(COPIES, path);
      const bytes = existsSync(copy) ? readFileSync(copy) : fetched.get(path);
      const row = {
        path,
        sha256: pins[path].sha256,
        committed_copy: existsSync(copy) ? `import/runtime-manifests/${path}` : null,
      };
      if (!bytes) {
        nested.push({
          ...row,
          followed: false,
          note: 'Not committed; followed only with --fetch.',
        });
        continue;
      }
      if (sha256(bytes) !== pins[path].sha256) {
        findings.push({ path, problem: 'nested manifest bytes differ from their pin' });
        continue;
      }
      const before = Object.keys(pins).length;
      pinnedRuntime(JSON.parse(bytes), path.slice(0, path.lastIndexOf('/')), pins);
      nested.push({ ...row, followed: true, adds_files: Object.keys(pins).length - before });
    }
  }
  const fromRepo = new Map([['manifest.json', `${OVERLAY}/manifest.json`]]);
  for (const path of Object.keys(pins))
    if (existsOverlay(dir, commit, path)) fromRepo.set(path, `${OVERLAY}/${path}`);
  const photo = Object.keys(pins).find(
    (p) => p.startsWith('photo/') && p.endsWith('/manifest.json'),
  );
  if (photo)
    for (const name of PHOTO_SIBLINGS)
      fromRepo.set(`${photo.slice(0, photo.lastIndexOf('/'))}/${name}`, `photo-runtime/${name}`);
  for (const source of git(dir, ['ls-tree', '--name-only', commit, 'hosting/next/notices/'])
    .split('\n')
    .filter(Boolean))
    fromRepo.set(`notices/${source.split('/').pop()}`, source);
  const assets = {};
  for (const [path, pin] of Object.entries(pins)) assets[path] = { path, ...pin };
  for (const [path, source] of fromRepo) {
    const bytes = blob(dir, commit, source);
    if (assets[path] && assets[path].sha256 !== sha256(bytes))
      findings.push({ path, source, problem: 'repository file differs from its runtime pin' });
    assets[path] = { path, sha256: sha256(bytes), bytes: bytes.length };
  }
  const rows = Object.values(assets)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((row) =>
      fromRepo.has(row.path)
        ? {
            ...row,
            location: `classic:${fromRepo.get(row.path)}`,
            acquire: ['mirror-runtime', 'classic-git'],
          }
        : {
            ...row,
            location: `${origin}/runtime/${row.path}`,
            acquire: ['mirror-runtime', 'single-file'],
          },
    );
  return {
    manifest: {
      source: `${OVERLAY}/manifest.json`,
      sha256: sha256(manifestBytes),
      bytes: manifestBytes.length,
      modelSourceSha256: JSON.parse(manifestBytes).modelSourceSha256,
    },
    nested,
    rows,
    findings,
  };
}

function existsOverlay(dir, commit, path) {
  return git(dir, ['ls-tree', '--name-only', commit, `${OVERLAY}/${path}`]).trim() !== '';
}

export function rowFindings(rows, commands) {
  const out = [];
  for (const row of rows) {
    if (!row.location) out.push({ path: row.path, problem: 'no location' });
    if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? ''))
      out.push({ path: row.path, problem: 'no sha256' });
    if (!row.acquire?.length || row.acquire.some((c) => !commands[c]))
      out.push({ path: row.path, problem: 'acquisition command missing or undefined' });
  }
  return out;
}

// The frozen next-site.yml artifact job: its step names and its `node --test` file list.
/**
 * node_test_files rows against the frozen next-site.yml test list. A test the monorepo adds beside classic's
 * carries `added: { bead, reason }` and is outside that list; one without both is a finding. Pure.
 */
export function testListFindings(rows, tests) {
  const findings = [];
  for (const t of rows.filter((t) => t.added && !(t.added.bead && t.added.reason)))
    findings.push({ test: t.file, problem: 'added without its bead and reason' });
  const listed = rows.filter((t) => !t.added).map((t) => t.file);
  for (const t of tests.filter((t) => !listed.includes(t)))
    findings.push({ test: t, problem: 'next-site.yml test without a node_test_files row' });
  for (const t of listed.filter((t) => !tests.includes(t)))
    findings.push({ test: t, problem: 'node_test_files row not in next-site.yml' });
  return findings;
}

export function artifactJob(workflow) {
  const job = workflow.slice(workflow.indexOf('\n  artifact:'), workflow.indexOf('\n  qualify:'));
  const steps = [...job.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1].trim());
  const tests = (job.match(/node --test (.+)$/m)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
  return { steps, tests };
}

export function ledgerFindings(ledger) {
  const out = [];
  const ids = new Set((ledger.defects ?? []).map((d) => d.id));
  for (let n = 1; n <= 23; n++)
    if (!ids.has(`defect:${n}`)) out.push({ problem: `candidate_ledger has no defect:${n}` });
  for (const d of ledger.defects ?? [])
    if (!d.evidence || !d.status || !('lead_bead' in d))
      out.push({ defect: d.id, problem: 'evidence, status and lead_bead are required' });
  if ((ledger.open_questions ?? []).length !== 4)
    out.push({ problem: 'candidate_ledger needs the four open audit questions' });
  if (!(ledger.declared_changes ?? []).length)
    out.push({ problem: 'candidate_ledger has no declared changes' });
  return out;
}

export function acquiredFindings(rootDir, rows) {
  const out = [];
  const files = [];
  const walk = (d) =>
    readdirSync(d).forEach((e) =>
      statSync(join(d, e)).isDirectory()
        ? walk(join(d, e))
        : files.push(relative(rootDir, join(d, e)).split('\\').join('/')),
    );
  walk(rootDir);
  const byPath = new Map(rows.map((r) => [r.path, r]));
  for (const f of files) {
    const row = byPath.get(f);
    if (!row) out.push({ acquired: f, problem: 'acquired file has no asset row' });
    else if (sha256(readFileSync(join(rootDir, f))) !== row.sha256)
      out.push({ acquired: f, problem: 'acquired bytes differ from the row' });
  }
  for (const r of rows)
    if (!files.includes(r.path))
      out.push({ path: r.path, problem: 'asset row missing from the acquired tree' });
  return { out, files: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const dir = classicDir(opts);
  const inputs = readJson(BUILD_INPUTS);
  const commit = inputs.frozen_commit;
  const origin = inputs.runtime.origin;
  const fetched = new Map();
  if (opts.fetch) {
    const pins = pinnedRuntime(JSON.parse(blob(dir, commit, `${OVERLAY}/manifest.json`)));
    for (const path of Object.keys(pins).filter(
      (p) => p.endsWith('manifest.json') && !existsSync(join(COPIES, p)),
    )) {
      const response = await fetch(`${origin}/runtime/${path}`);
      if (response.ok) fetched.set(path, Buffer.from(await response.arrayBuffer()));
    }
  }
  const derived = deriveRuntime(dir, commit, origin, fetched);
  // Runtime modules the app loads by URL; a chunked one is listed once, as its asset, with its chunk count.
  const modules = new Map();
  for (const r of derived.rows) {
    const path = r.of ?? r.path;
    if (!RUNNABLE.test(path)) continue;
    const entry = modules.get(path) ?? {
      path,
      sha256: r.of_sha256 ?? r.sha256,
      location: r.of ? `${origin}/runtime/${path} (served as chunks)` : r.location,
    };
    if (r.of) entry.chunks = (entry.chunks ?? 0) + 1;
    modules.set(path, entry);
  }
  const pinned = [...modules.values()];
  const findings = [...derived.findings];
  if (opts.write) {
    inputs.runtime = {
      ...inputs.runtime,
      manifest: derived.manifest,
      nested_manifests: derived.nested.map(({ followed: _followed, ...n }) => n),
      assets: derived.rows,
    };
    inputs.worker_graphs = { ...inputs.worker_graphs, pinned };
    writeFileSync(BUILD_INPUTS, JSON.stringify(inputs, null, 2) + '\n');
  } else {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(inputs.runtime.assets, derived.rows))
      findings.push({
        problem:
          'runtime.assets differs from the rows derived from the frozen manifests (run --write and review)',
      });
    if (!same(inputs.worker_graphs.pinned, pinned))
      findings.push({ problem: 'worker_graphs.pinned differs from the derived runtime modules' });
    if (!same(inputs.runtime.manifest, derived.manifest))
      findings.push({ problem: 'runtime.manifest differs from the frozen overlay manifest' });
    for (const n of derived.nested)
      if (n.followed && n.adds_files === undefined)
        findings.push({ path: n.path, problem: 'nested manifest not followed' });
    if (opts.fetch)
      for (const n of derived.nested.filter((x) => !x.committed_copy))
        if (!n.followed || n.adds_files)
          findings.push({
            path: n.path,
            problem: n.followed
              ? `adds ${n.adds_files} files: commit a copy under import/runtime-manifests/`
              : 'could not be fetched',
          });
  }
  findings.push(...rowFindings(inputs.runtime.assets, inputs.runtime.acquisition_commands));
  const job = artifactJob(blob(dir, commit, '.github/workflows/next-site.yml').toString('utf8'));
  findings.push(...testListFindings(inputs.checks.node_test_files, job.tests));
  const steps = inputs.checks.next_site_artifact_job.map((s) => s.step);
  for (const s of job.steps.filter((s) => !steps.includes(s)))
    findings.push({ step: s, problem: 'next-site.yml artifact step without a row' });
  for (const row of [...inputs.checks.node_test_files, ...inputs.checks.next_site_artifact_job])
    if (!row.runs_on) findings.push({ row: row.file ?? row.step, problem: 'runs_on is required' });
  findings.push(...ledgerFindings(inputs.candidate_ledger));
  let acquired = null;
  if (opts.acquired) {
    const result = acquiredFindings(opts.acquired, inputs.runtime.assets);
    findings.push(...result.out);
    acquired = result.files;
  }
  for (const f of findings) line(f);
  line({
    summary: {
      commit,
      assets: derived.rows.length,
      chunks: derived.rows.filter((r) => r.of).length,
      nested_manifests: derived.nested.length,
      pinned_modules: pinned.length,
      tests: job.tests.length,
      steps: job.steps.length,
      acquired_files: acquired,
      findings: findings.length,
      mode: opts.write ? 'write' : 'check',
    },
  });
  process.exit(findings.length ? 1 : 0);
}
