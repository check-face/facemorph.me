#!/usr/bin/env node
// The picked-name result index (fm-ejwq, from folded fm-fy2.18): for every published name, the SHA-256 of its
// canonical recovery-bearing WebP in the published names result set (scripts/names-publish, fm-e6yj), split into 16
// shards by the first hex digit of the name's id (SHA-256 of its exact lowercase text). A pick fetches one ~45 KB
// shard ({id: [sha256, bytes]}) and the one result it names, content-addressed at <origin>/results/<sha256>.webp; the bytes are checked
// against that digest before the bridge reads the recovery envelope. Nothing here is fetched while typing.
//   node apps/web/scripts/names-results.mjs [--manifest <catalogues/<sha>.json file>] [--check]
// Without --manifest the live pointer (catalogue-v2.json) and the manifest it names are fetched and verified.
// --check compares the committed shards with that manifest and exits 1 on any difference.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const NAME_ORIGIN = 'https://facemorph-name-catalogue.cdilga.workers.dev';
export const SCHEMA = 'facemorph.name-results/1';
const OUT = fileURLToPath(new URL('../src/public/names-results/', import.meta.url));
const HEX64 = /^[a-f0-9]{64}$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The 16 shard objects for a verified names manifest (its bytes and their digest). */
export function shards(manifestBytes) {
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== 'facemorph.names/1' || !HEX64.test(manifest.resultSet ?? ''))
    throw Error('not a facemorph.names/1 manifest');
  const head = {
    schema: SCHEMA,
    origin: NAME_ORIGIN,
    resultSet: manifest.resultSet,
    manifestSha256: sha256(manifestBytes),
    identity: manifest.identity,
  };
  const out = Object.fromEntries(
    [...'0123456789abcdef'].map((h) => [h, { ...head, results: {} }]),
  );
  for (const row of manifest.names) {
    const id = sha256(Buffer.from(row.value, 'utf8'));
    const file = row.result?.sha256;
    if (row.id !== id || !HEX64.test(file ?? '') || row.result.url !== `/results/${file}.webp`)
      throw Error(`manifest row ${row.value}: bad identity or result`);
    out[id[0]].results[id] = [file, row.result.bytes];
  }
  return out;
}

async function liveManifest() {
  const pointer = await (await fetch(`${NAME_ORIGIN}/catalogue-v2.json`)).json();
  const bytes = Buffer.from(await (await fetch(new URL(pointer.manifest.url, NAME_ORIGIN))).arrayBuffer());
  if (sha256(bytes) !== pointer.manifest.sha256) throw Error('manifest digest differs from the pointer');
  return bytes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, check: { type: 'boolean' } } });
  const bytes = values.manifest ? readFileSync(values.manifest) : await liveManifest();
  const want = shards(bytes);
  if (values.check) {
    const bad = Object.entries(want).filter(
      ([h, shard]) =>
        !existsSync(join(OUT, `${h}.json`)) ||
        readFileSync(join(OUT, `${h}.json`), 'utf8') !== JSON.stringify(shard) + '\n',
    );
    console.log(JSON.stringify({ ok: !bad.length, differs: bad.map(([h]) => h) }));
    process.exit(bad.length ? 1 : 0);
  }
  if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
  mkdirSync(OUT, { recursive: true });
  for (const [h, shard] of Object.entries(want))
    writeFileSync(join(OUT, `${h}.json`), JSON.stringify(shard) + '\n');
  console.log(JSON.stringify({ ok: true, manifestSha256: sha256(bytes), names: JSON.parse(bytes).names.length }));
}
