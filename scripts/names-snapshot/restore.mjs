#!/usr/bin/env node
// Restore names-snapshot objects (bead fm-old) from the bucket into a directory, for the catalogue pipeline
// to read instead of api.facemorph.me. Reads only the bucket and manifest.tsv: never a source Worker, never
// the hosted API. Each object is written to <out>/<object key> (the source URL without its scheme, e.g.
// <out>/facemorph-name-catalogue.cdilga.workers.dev/latent/<id>.f32) only after its size and SHA-256 match
// the manifest.
//
// Exit codes: 0 every selected object restored, 21 some object absent or failing its digest, 2 usage.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  MANIFEST_PATH,
  clientFromArgs,
  keyOf,
  parseArgs,
  parseManifest,
  readObject,
  revokeR2Token,
  sha256,
} from './snapshot.mjs';

export const EXIT = { restored: 0, incomplete: 21, usage: 2 };

/** Validate a provisioned snapshot without credentials or network I/O (publication CI). */
export function checkLocal(rows, out) {
  const report = {
    selected: rows.length,
    restored: 0,
    bytes: 0,
    absent: [],
    mismatch: [],
    unknownNames: rows.unknown ?? [],
  };
  for (const row of rows) {
    let bytes;
    try {
      bytes = readFileSync(join(out, keyOf(row.url)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      report.absent.push(row.url);
      continue;
    }
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) report.mismatch.push(row.url);
    else {
      report.restored++;
      report.bytes += bytes.length;
    }
  }
  return { ...report, complete: report.restored === rows.length && !report.unknownNames.length };
}

// Rows for the requested public names (exact lowercase values), every name-th row for a sample, or all.
export function select(rows, { names, sample, all } = {}) {
  if (all) return rows;
  if (names) {
    const wanted = new Set(names);
    const out = rows.filter((r) => wanted.has(r.name));
    const found = new Set(out.map((r) => r.name));
    return Object.assign(out, { unknown: [...wanted].filter((n) => !found.has(n)) });
  }
  if (sample) {
    const step = Math.max(1, Math.floor(rows.length / sample));
    return rows.filter((_, i) => i % step === 0).slice(0, sample);
  }
  throw new Error('select names, a sample size, or all');
}

export async function restore({
  rows,
  client,
  bucket = DEFAULTS.bucket,
  out,
  concurrency = DEFAULTS.concurrency,
}) {
  const report = {
    selected: rows.length,
    restored: 0,
    bytes: 0,
    absent: [],
    mismatch: [],
    unknownNames: rows.unknown ?? [],
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        const key = keyOf(row.url);
        const bytes = await readObject(client, bucket, key);
        if (!bytes) report.absent.push(row.url);
        else if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256)
          report.mismatch.push(row.url);
        else {
          const path = join(out, key);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes);
          report.restored++;
          report.bytes += bytes.length;
        }
      }
    }),
  );
  report.absent.sort();
  report.mismatch.sort();
  report.complete = report.restored === rows.length && !report.unknownNames.length;
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.out || !(a.names || a.sample || a.all)) {
    console.error(
      'usage: restore.mjs --out=<dir> (--names=a,b | --sample=N | --all) [--bucket=] [--mint-r2=<account id>]',
    );
    process.exit(EXIT.usage);
  }
  const bucket = a.bucket ?? DEFAULTS.bucket;
  const text = readFileSync(a.manifest ? resolve(a.manifest) : MANIFEST_PATH, 'utf8');
  const rows = select(parseManifest(text), {
    names: typeof a.names === 'string' ? a.names.split(',') : undefined,
    sample: a.sample && Number(a.sample),
    all: a.all,
  });
  let report;
  if (a['check-local']) report = checkLocal(rows, resolve(a.out));
  else {
    const { client, token } = await clientFromArgs(a, bucket, false);
    try {
      report = await restore({ rows, client, bucket, out: resolve(a.out) });
    } finally {
      if (token)
        console.log(
          JSON.stringify({ event: 'token', revoked: revokeR2Token(token), expires: token.expires }),
        );
    }
  }
  console.log(
    JSON.stringify({
      event: 'restore',
      localOnly: !!a['check-local'],
      complete: report.complete,
      selected: report.selected,
      restored: report.restored,
      bytes: report.bytes,
      absent: report.absent.length,
      mismatch: report.mismatch.length,
      unknownNames: report.unknownNames,
    }),
  );
  for (const url of [...report.absent, ...report.mismatch].slice(0, 20))
    console.log(JSON.stringify({ event: 'problem', url }));
  process.exitCode = report.complete ? EXIT.restored : EXIT.incomplete;
}
