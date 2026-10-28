#!/usr/bin/env node
// Restores the full31 engine fixtures (packages/stylegan-js/test/full31) into a directory, so the release engine job
// does not depend on one machine's hand-made copy. A directory whose files already equal manifest.json's digests is
// kept as it is; otherwise the pinned release asset (release.json) is downloaded, its sha256 checked, unpacked, and
// every file checked again. Fails closed: a wrong asset or a changed file never reaches the test.
//   node scripts/ci/fetch-full31.mjs --dest <dir>
// One JSON line: {dest, kept|fetched, files}; exit 1 on any mismatch.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO, line, options, readJson, sha256 } from '../inventory/lib.mjs';

const DIR = join(REPO, 'packages/stylegan-js/test/full31');

/** The pinned files that are missing or differ in `dir`. */
export function mismatches(dir, files = readJson(join(DIR, 'manifest.json')).files) {
  return Object.entries(files)
    .filter(([name, digest]) => {
      const path = join(dir, name);
      return !existsSync(path) || sha256(readFileSync(path)) !== digest;
    })
    .map(([name]) => name);
}

export async function fetchFull31({
  dest,
  release = readJson(join(DIR, 'release.json')),
  files = readJson(join(DIR, 'manifest.json')).files,
  get = fetch,
}) {
  const dir = resolve(dest);
  const count = Object.keys(files).length;
  if (existsSync(dir) && mismatches(dir, files).length === 0)
    return { dest: dir, kept: true, files: count };
  // The API asset URL (accept: octet-stream) serves anonymous requests; a CI token only raises the rate limit.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await get(release.api_url, {
    headers: {
      accept: 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  if (sha256(bytes) !== release.sha256)
    throw new Error(
      `${release.api_url}: HTTP ${res.status}, ${bytes.length} bytes, sha256 ${sha256(bytes)} is not the pinned ${release.sha256}`,
    );
  const scratch = mkdtempSync(join(tmpdir(), 'full31-'));
  try {
    writeFileSync(join(scratch, 'fixtures.tar.gz'), bytes);
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', join(scratch, 'fixtures.tar.gz'), '-C', dir]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const bad = mismatches(dir, files);
  if (bad.length)
    throw new Error(
      `after unpacking, ${bad.length} file(s) differ from manifest.json: ${bad.join(', ')}`,
    );
  return { dest: dir, fetched: release.tag, files: count };
}

if (import.meta.main) {
  const opts = options(process.argv.slice(2));
  if (!opts.dest) {
    console.error('usage: node scripts/ci/fetch-full31.mjs --dest <dir>');
    process.exit(2);
  }
  try {
    line(await fetchFull31({ dest: opts.dest }));
  } catch (error) {
    line({ ok: false, error: error.message });
    process.exit(1);
  }
}
