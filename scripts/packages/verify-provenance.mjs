#!/usr/bin/env node
// Checks the PROVENANCE.json inside packed tarballs (fm-oagi): it names the tarball's own package name and version,
// the expected source commit with a clean tree, and the digest of the dist/ actually in the tarball.
//   node scripts/packages/verify-provenance.mjs --commit <sha> [--report <out.json>] <tarball.tgz>...
// Prints one JSON line per tarball with its sha256 and npm integrity (sha512); exit 0 when every tarball matches,
// 1 on a mismatch, 2 on usage.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distDigest, SCHEMA } from './write-provenance.mjs';

export function verifyTarball(tgz, commit) {
  const bytes = readFileSync(tgz);
  const dir = mkdtempSync(join(tmpdir(), 'verify-provenance-'));
  const problems = [];
  let record = null;
  let pkg = null;
  try {
    const x = spawnSync('tar', ['-xzf', tgz, '-C', dir, '--no-same-owner'], { encoding: 'utf8' });
    if (x.status !== 0) throw new Error(`cannot extract ${tgz}: ${x.stderr.trim()}`);
    const root = join(dir, 'package');
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    try {
      record = JSON.parse(readFileSync(join(root, 'PROVENANCE.json'), 'utf8'));
    } catch {
      problems.push('PROVENANCE.json is missing or not JSON');
    }
    if (record) {
      const dist = distDigest(join(root, 'dist'));
      const expect = {
        schema: SCHEMA,
        name: pkg.name,
        version: pkg.version,
        sourceCommit: commit,
        sourceTreeClean: true,
        distSha256: dist.sha256,
        distFiles: dist.files,
      };
      for (const [k, v] of Object.entries(expect))
        if (record[k] !== v)
          problems.push(
            `${k}: PROVENANCE.json has ${JSON.stringify(record[k])}, expected ${JSON.stringify(v)}`,
          );
      if (!/^[0-9a-f]{64}$/.test(record.sourceIdentity ?? ''))
        problems.push('sourceIdentity is not a sha256');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return {
    tarball: tgz,
    name: pkg?.name ?? null,
    version: pkg?.version ?? null,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    provenance: record,
    problems,
    outcome: problems.length ? 'mismatch' : 'match',
  };
}

export function main(argv) {
  const at = argv.indexOf('--commit');
  const commit = at >= 0 ? argv[at + 1] : null;
  const rp = argv.indexOf('--report');
  const report = rp >= 0 ? argv[rp + 1] : null;
  const tarballs = argv.filter(
    (a, i) => !a.startsWith('--') && i !== at + 1 && (rp < 0 || i !== rp + 1),
  );
  if (!/^[0-9a-f]{40}$/.test(commit ?? '') || !tarballs.length) {
    process.stderr.write(
      'usage: verify-provenance.mjs --commit <40-hex sha> [--report <out.json>] <tarball.tgz>...\n',
    );
    return 2;
  }
  const results = tarballs.map((t) => verifyTarball(t, commit));
  for (const r of results)
    process.stdout.write(`${JSON.stringify({ ...r, provenance: undefined })}\n`);
  if (report) {
    mkdirSync(dirname(resolve(report)), { recursive: true });
    writeFileSync(report, `${JSON.stringify({ commit, packages: results }, null, 2)}\n`);
  }
  return results.every((r) => r.outcome === 'match') ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
