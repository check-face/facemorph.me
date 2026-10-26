#!/usr/bin/env node
// Pins the control artifact (fm-gpx): the classic CI artifact import/build-inputs.json names as the live
// next.facemorph.me build. It checks the artifact zip against GitHub's recorded digest and the artifact's
// own next-site-SHA256SUMS, fetches every deploy-next/ file from the live site and compares it byte for byte
// (a rebuilt artifact or a checkout is never the control), uploads the exact zip as a release asset of this
// repository, and writes import/control-artifact.json.
//   node scripts/import/pin-control.mjs [--zip <artifact.zip>] [--classic <dir>] [--upload]
// Without --zip it downloads the artifact by its recorded repository, run and artifact id (never an
// inherited repository context). Without --upload it only checks and writes the record. One JSON line per
// finding, then a summary; exit 1 on any live difference or digest mismatch.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILD_INPUTS,
  classicDir,
  git,
  line,
  options,
  readJson,
  sha256,
} from '../inventory/lib.mjs';
import { CONTROL, CONTROL_LABEL, digestTree, unzip } from './control.mjs';

const RELEASE_REPO = 'facemorph-me/facemorph.me';
const LIVE = 'https://next.facemorph.me';

function gh(args, opts = {}) {
  const r = spawnSync('gh', args, { encoding: opts.encoding ?? 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

async function liveDigest(path) {
  const url = path === 'index.html' ? `${LIVE}/` : `${LIVE}/${path}`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  return {
    url,
    status: res.status,
    sha256: res.ok ? sha256(Buffer.from(await res.arrayBuffer())) : null,
  };
}

const opts = options(process.argv.slice(2));
const record = readJson(BUILD_INPUTS).control_artifact;
const work = mkdtempSync(join(tmpdir(), 'control-pin-'));
const zip = opts.zip ?? join(work, `${record.artifact_name}.zip`);
if (!opts.zip)
  writeFileSync(
    zip,
    gh(['api', `repos/${record.repository}/actions/artifacts/${record.artifact_id}/zip`], {
      encoding: 'buffer',
    }),
  );
const zipSha = sha256(readFileSync(zip));
const findings = [];
if (`sha256:${zipSha}` !== record.artifact_zip_digest)
  findings.push({
    problem: 'artifact zip digest differs from the recorded one',
    expected: record.artifact_zip_digest,
    actual: zipSha,
  });

const tree = join(work, 'tree');
unzip(zip, tree);
const files = digestTree(tree);
const byPath = new Map(files.map((f) => [f.path, f]));
const sums = readFileSync(join(tree, 'next-site-SHA256SUMS'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split(/\s+\*?/));
for (const [digest, path] of sums)
  if (byPath.get(path)?.sha256 !== digest)
    findings.push({ path, problem: 'differs from next-site-SHA256SUMS' });
if (sha256(readFileSync(join(tree, 'next-site-SHA256SUMS'))) !== record.sha256sums_digest)
  findings.push({ problem: 'next-site-SHA256SUMS digest differs from the recorded one' });
const sourceCommit = readFileSync(join(tree, 'next-site-source.txt'), 'utf8').trim();
if (sourceCommit !== record.commit)
  findings.push({
    problem: 'next-site-source.txt names another commit',
    expected: record.commit,
    actual: sourceCommit,
  });

const checkedAt = new Date().toISOString();
const live = [];
for (const f of files.filter((f) => f.path.startsWith('deploy-next/'))) {
  const path = f.path.slice('deploy-next/'.length);
  const got = await liveDigest(path);
  live.push(path);
  if (got.sha256 !== f.sha256)
    findings.push({
      path,
      problem: 'live bytes differ from the artifact',
      url: got.url,
      status: got.status,
      expected: f.sha256,
      actual: got.sha256,
    });
}

const dir = classicDir(opts);
const frozen = readJson(BUILD_INPUTS).frozen_commit;
const between = git(dir, ['log', '--format=%H %s', `${record.commit}..${frozen}`])
  .trim()
  .split('\n')
  .filter(Boolean);
const changed = git(dir, ['diff', '--name-only', record.commit, frozen])
  .trim()
  .split('\n')
  .filter(Boolean);
const tag = `control-${record.commit.slice(0, 12)}`;
const asset = `${record.artifact_name}.zip`;
const out = {
  schema: 'facemorph.control-artifact/1',
  bead: 'fm-gpx',
  label: CONTROL_LABEL,
  why: record.why,
  source: {
    repository: record.repository,
    repository_id: record.repository_id,
    workflow: record.workflow,
    run_id: record.run_id,
    run_attempt: record.run_attempt,
    run_url: record.run_url,
    commit: record.commit,
    artifact_name: record.artifact_name,
    artifact_id: record.artifact_id,
    artifact_zip_sha256: zipSha,
    build_id: record.build_id,
    bundle_hash: record.bundle_hash,
    qualified_by: record.qualified_by,
  },
  exercised_with: {
    runtime_manifest_sha256: record.runtime_manifest_sha256,
    catalogue_sha256: record.catalogue_sha256,
  },
  frozen_commit: frozen,
  control_vs_frozen: {
    equal: between.length === 0,
    commits: between.map((l) => ({ commit: l.slice(0, 40), subject: l.slice(41) })),
    changed_paths: changed,
    closure_effect: !changed.length
      ? 'none: the commits between them leave no file changed'
      : changed.every((p) => p.startsWith('.github/'))
        ? 'none: only CI workflows change between them'
        : 'review: paths outside CI change',
  },
  release: {
    repository: RELEASE_REPO,
    tag,
    asset,
    sha256: zipSha,
    bytes: statSync(zip).size,
    url: `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${asset}`,
  },
  files,
  live_check: {
    origin: LIVE,
    checked_at: checkedAt,
    files_compared: live.length,
    differences: findings.filter((f) => f.problem === 'live bytes differ from the artifact').length,
  },
};

if (opts.upload && !findings.length) {
  const named = join(work, asset); // gh names an asset after its file (`#label` is only the display label)
  if (named !== zip) copyFileSync(zip, named);
  const exists = spawnSync(
    'gh',
    ['release', 'view', tag, '-R', RELEASE_REPO, '--json', 'assets', '-q', '.assets[].name'],
    { encoding: 'utf8' },
  );
  if (exists.status !== 0) {
    gh([
      'release',
      'create',
      tag,
      named,
      '-R',
      RELEASE_REPO,
      '--title',
      `Control artifact ${record.commit.slice(0, 12)} (classic candidate build)`,
      '--notes',
      `The live next.facemorph.me build on ${checkedAt.slice(0, 10)}, pinned as the port's control (fm-gpx). Classic's build, not this repository's: ${record.run_url} (commit ${record.commit}, artifact ${record.artifact_name}, sha256 ${zipSha}). Record: import/control-artifact.json.`,
    ]);
  } else if (!exists.stdout.split('\n').includes(asset)) {
    gh(['release', 'upload', tag, named, '-R', RELEASE_REPO]);
  }
  // The github.com download URL answers 404 to anonymous requests here; the API asset URL serves anyone.
  const id = gh([
    'api',
    `repos/${RELEASE_REPO}/releases/tags/${tag}`,
    '-q',
    `.assets[] | select(.name == "${asset}") | .id`,
  ]).trim();
  out.release.api_url = `https://api.github.com/repos/${RELEASE_REPO}/releases/assets/${id}`;
  line({ uploaded: out.release.url, api_url: out.release.api_url });
}

for (const f of findings) line(f);
if (!findings.length) writeFileSync(CONTROL, JSON.stringify(out, null, 1) + '\n');
line({
  summary: {
    files: files.length,
    live_compared: live.length,
    findings: findings.length,
    record: findings.length ? null : 'import/control-artifact.json',
  },
});
process.exit(findings.length ? 1 : 0);
