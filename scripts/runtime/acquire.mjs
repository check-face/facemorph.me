#!/usr/bin/env node
// Acquires the candidate's runtime (the overlay manifest, every file it pins, nested manifests and the photo
// worker siblings, with their notices) into an ignored cache directory, each file checked against the digest
// import/build-inputs.json records (fm-gpx). Files come from https://next.facemorph.me/runtime/ or from
// classic's Git objects at the frozen commit; models.facemorph.me (a serving surface) and any other host are
// refused before a request is made. A file already present with the right digest is kept; a wrong one is
// replaced; downloads land in a .part file and are renamed only once verified, so an interrupted run leaves
// no bad file and the next run picks up where it stopped.
//
// Acquiring these bytes downloads model weights under the terms in import/licences.json, so it needs explicit
// acceptance: ACCEPT_MODEL_TERMS=yes or --accept-model-terms.
//   node scripts/runtime/acquire.mjs [--cache <dir>] [--classic <dir>] [--only <glob>] [--accept-model-terms]
// --origin <url> serves the https://next.facemorph.me rows from another origin (a local server in tests).
// One JSON line per file and per request, then a summary with requests by host; exit 1 on any failure,
// exit 2 without acceptance.
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  BUILD_INPUTS,
  REPO,
  blob,
  classicDir,
  line,
  matches,
  options,
  readJson,
  sha256,
} from '../inventory/lib.mjs';

export const ORIGIN = 'https://next.facemorph.me';
export const DEFAULT_CACHE = join(REPO, '.cache/runtime');
export const TERMS =
  'Acquiring the runtime downloads model weights and derived assets under the terms listed in import/licences.json ' +
  '(StyleGAN2-ADA FFHQ under the NVIDIA Source Code License-NC, e4e, the dlib 68-point landmark model, FFHQ-derived images). ' +
  'Read them, then run again with ACCEPT_MODEL_TERMS=yes or --accept-model-terms.';

const fileDigest = (path) => (existsSync(path) ? sha256(readFileSync(path)) : null);

// Where a row's bytes come from: {kind: 'https', url} or {kind: 'classic', path}; throws for any other host.
export function sourceOf(row, origin = ORIGIN) {
  if (row.location.startsWith('classic:'))
    return { kind: 'classic', path: row.location.slice('classic:'.length) };
  const url = new URL(row.location);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/runtime/'))
    throw new Error(
      `${row.path}: ${url.origin} is not an acquisition source (only ${ORIGIN}/runtime/)`,
    );
  return { kind: 'https', url: origin + url.pathname };
}

async function download(url, part, log) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  const host = new URL(url).host;
  if (!res.ok || !res.body) {
    log({ request: url, host, status: res.status, bytes: 0 });
    throw new Error(`${url} answered HTTP ${res.status}`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(part),
    );
  } finally {
    log({ request: url, host, status: res.status, bytes });
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function acquire({
  rows,
  cache = DEFAULT_CACHE,
  classic,
  commit,
  origin = ORIGIN,
  only = [],
  concurrency = 4,
  log = () => {},
}) {
  const selected = only.length ? rows.filter((r) => matches(r.path, only)) : rows;
  const requests = {};
  const logRequest = (r) => {
    requests[r.host] = (requests[r.host] ?? 0) + 1;
    log(r);
  };
  const sources = selected.map((row) => [row, sourceOf(row, origin)]); // every host is checked before any request
  const result = { files: selected.length, kept: 0, fetched: 0, replaced: 0, failed: [], bytes: 0 };
  let next = 0;
  const lane = async () => {
    while (next < sources.length) {
      const [row, source] = sources[next++];
      const path = join(cache, row.path);
      const had = fileDigest(path);
      if (had === row.sha256) {
        result.kept++;
        log({ path: row.path, status: 'kept' });
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      const part = `${path}.part`;
      try {
        let got;
        if (source.kind === 'classic') {
          const bytes = blob(classic, commit, source.path);
          writeFileSync(part, bytes);
          got = { sha256: sha256(bytes), bytes: bytes.length };
        } else got = await download(source.url, part, logRequest);
        if (got.sha256 !== row.sha256 || (row.bytes != null && got.bytes !== row.bytes))
          throw new Error(
            `digest mismatch: expected ${row.sha256} (${row.bytes} bytes), got ${got.sha256} (${got.bytes} bytes)`,
          );
        renameSync(part, path);
        result.bytes += got.bytes;
        if (had) result.replaced++;
        else result.fetched++;
        log({
          path: row.path,
          status: had ? 'replaced' : 'fetched',
          from: source.kind,
          sha256: row.sha256,
          bytes: got.bytes,
        });
      } catch (error) {
        rmSync(part, { force: true });
        result.failed.push({ path: row.path, error: error.message });
        log({ path: row.path, status: 'failed', error: error.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, lane));
  return { ...result, requests };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opts = options(argv);
  if (process.env.ACCEPT_MODEL_TERMS !== 'yes' && !opts['accept-model-terms']) {
    process.stderr.write(TERMS + '\n');
    line({ summary: { ok: false, refused: 'model terms not accepted' } });
    process.exit(2);
  }
  const inputs = readJson(opts.inputs ?? BUILD_INPUTS);
  const only = argv.flatMap((a, i) => (a === '--only' ? [argv[i + 1]] : []));
  const rows = inputs.runtime.assets;
  const needsClassic = rows.some(
    (r) => r.location.startsWith('classic:') && (!only.length || matches(r.path, only)),
  );
  let result;
  try {
    result = await acquire({
      rows,
      only,
      cache: opts.cache ?? DEFAULT_CACHE,
      origin: opts.origin ?? ORIGIN,
      commit: inputs.frozen_commit,
      classic: needsClassic ? classicDir(opts) : undefined,
      log: line,
    });
  } catch (error) {
    line({ summary: { ok: false, refused: error.message, requests: {} } });
    process.exit(1);
  }
  line({
    summary: {
      ok: !result.failed.length,
      cache: opts.cache ?? DEFAULT_CACHE,
      ...result,
      failed: result.failed.length,
    },
  });
  process.exit(result.failed.length ? 1 : 0);
}
