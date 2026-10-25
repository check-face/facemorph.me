// fm-e6yj: immutable assets first, then one atomic Workers asset deployment changes the pointer.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogueRows,
  parseManifest,
  resultSet,
  rowValid,
  MAX_RGB_DIFF,
  LATENT_TOLERANCE,
  sampleRows,
  sha256,
} from '../../tools/names-generator/lib.mjs';
import { recoverEnvelope } from '../../apps/web/src/Next/image-envelope.mjs';
import { limitFindings } from '../../packages/cloudflare-model-host/src/limits.ts';
import { fetchSource } from '../names-snapshot/fetch-source.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const POINTER = 'catalogue-v2.json';
export const INVENTORY = 'publication.json';
const json = (value) => Buffer.from(JSON.stringify(value) + '\n');
const safePath = (path) =>
  typeof path === 'string' &&
  !path.startsWith('/') &&
  !path.split('/').some((x) => !x || x === '.' || x === '..') &&
  !/[\\?#%]/.test(path) &&
  !Array.from(path).some((c) => c.charCodeAt(0) <= 32);
function put(root, path, bytes) {
  if (!safePath(path)) throw Error(`Unsafe asset path: ${path}`);
  const file = join(root, path);
  if (existsSync(file) && !readFileSync(file).equals(bytes))
    throw Error(`Immutable collision: ${path}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
export function list(root) {
  const files = [];
  function walk(at) {
    for (const name of readdirSync(at).sort()) {
      const file = join(at, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw Error(`Symlink asset: ${file}`);
      if (stat.isDirectory()) walk(file);
      else {
        const bytes = readFileSync(file);
        files.push({
          path: relative(root, file).split('\\').join('/'),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  }
  walk(root);
  return files;
}
export async function validateResult(bytes, row, identity) {
  if (bytes.length !== row.bytes || sha256(bytes) !== row.fileSha256)
    throw Error(`Result file integrity: ${row.id}`);
  const envelope = await recoverEnvelope(new Blob([bytes], { type: 'image/webp' }));
  if (
    !envelope ||
    envelope.legacy ||
    envelope.latentSha256 !== row.latentSha256 ||
    envelope.imageSha256 !== row.imageSha256 ||
    envelope.generationSha256 !== identity.generationSha256 ||
    envelope.provenance?.modelSha256 !== identity.modelSha256 ||
    envelope.provenance?.manifestSha256 !== identity.manifestSha256
  )
    throw Error(`Result recovery identity: ${row.id}`);
  return envelope;
}

/** Reads and validates the entire producer output before making a public mutation. */
export async function prepare({
  generated,
  legacy,
  previous,
  out = mkdtempSync(join(tmpdir(), 'facemorph-names-publish-')),
}) {
  const original = readFileSync(join(legacy, 'catalogue.json'));
  const catalogue = JSON.parse(original);
  const expected = catalogueRows(catalogue);
  const text = readFileSync(join(generated, 'manifest.jsonl'), 'utf8');
  for (const line of text.split('\n').filter(Boolean)) JSON.parse(line); // Publication refuses a partial final line.
  const producer = parseManifest(text);
  if (!producer.header) throw Error('No generator manifest header');
  const set = resultSet(producer.header.identity);
  if (
    set.digest !== producer.header.resultSet ||
    set.set !== producer.header.set ||
    producer.rows.size !== expected.length
  )
    throw Error('Generator result set or coverage mismatch');
  const names = [];
  mkdirSync(out, { recursive: true });
  for (const name of expected) {
    const row = producer.rows.get(name.id);
    if (!row || row.name !== name.name || row.value !== name.value || !safePath(row.file))
      throw Error(`Missing or invalid result: ${name.id}`);
    const bytes = readFileSync(join(generated, row.file));
    if (!rowValid(row, set, { [row.file]: sha256(bytes) }, { requireSynthesis: true }))
      throw Error(`Unqualified result: ${name.id}`);
    if (
      name.modelSha256 !== set.identity.modelSha256 ||
      name.generationSha256 !== set.identity.generationSha256
    )
      throw Error(`Catalogue model/generation mismatch: ${name.id}`);
    if (
      !(row.synthesisCheck.maxRgbDiff >= 0 && row.synthesisCheck.maxRgbDiff <= MAX_RGB_DIFF) ||
      !(row.referenceLatent.maxAbsDiff >= 0 && row.referenceLatent.maxAbsDiff <= LATENT_TOLERANCE)
    )
      throw Error(`Result tolerance: ${name.id}`);
    await validateResult(bytes, row, set.identity);
    const path = `results/${row.fileSha256}.webp`;
    put(out, path, bytes);
    names.push({
      name: name.name,
      value: name.value,
      id: name.id,
      result: {
        url: `/${path}`,
        bytes: row.bytes,
        sha256: row.fileSha256,
        imageSha256: row.imageSha256,
        latentSha256: row.latentSha256,
      },
    });
  }
  // Preserve every prior advertised immutable, plus the entire verified classic catalogue tree.
  mkdirSync(out, { recursive: true });
  for (const source of [previous, legacy].filter(Boolean))
    for (const file of source === previous
      ? JSON.parse(readFileSync(join(source, INVENTORY))).files
      : list(source)) {
      if ([POINTER, INVENTORY, '_headers'].includes(file.path)) continue;
      const bytes = readFileSync(join(source, file.path));
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        throw Error(`Retained file changed: ${file.path}`);
      put(out, file.path, bytes);
    }
  const manifest = json({
    schema: 'facemorph.names/1',
    resultSet: set.digest,
    identity: set.identity,
    names,
  });
  const manifestDigest = sha256(manifest),
    path = `catalogues/${manifestDigest}.json`;
  put(out, path, manifest);
  const pointer = json({
    schema: 'facemorph.names-pointer/1',
    resultSet: set.digest,
    manifest: { url: `/${path}`, sha256: manifestDigest, bytes: manifest.length },
  });
  // Phase 1 leaves any previous pointer exactly as it was. Phase 2 changes only these pointer bytes.
  if (previous && existsSync(join(previous, POINTER)))
    put(out, POINTER, readFileSync(join(previous, POINTER)));
  const files = list(out).filter((f) => f.path !== POINTER);
  put(out, INVENTORY, json({ schema: 'facemorph.names-publication/1', files }));
  writeFileSync(
    join(out, '_headers'),
    '/*\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n  X-Content-Type-Options: nosniff\n/results/*\n  Cache-Control: public, max-age=31536000, immutable\n/catalogues/*\n  Cache-Control: public, max-age=31536000, immutable\n/catalogue-v2.json\n  Cache-Control: no-cache\n/publication.json\n  Cache-Control: no-cache\n',
  );
  // Check the final tree, including the prospective pointer (also on first publication).
  const inventory = list(out).filter((f) => f.path !== POINTER);
  inventory.push({ path: POINTER, bytes: pointer.length, sha256: sha256(pointer) });
  const findings = limitFindings(inventory, 'workers-free');
  if (findings.length) throw Error(`Workers Free limits: ${JSON.stringify(findings)}`);
  const summary = {
    assetCount: inventory.length,
    bytes: inventory.reduce((n, f) => n + f.bytes, 0),
    tier: 'workers-free',
    pointerSha256: sha256(pointer),
    manifestSha256: manifestDigest,
    resultSet: set.digest,
    identity: set.identity,
    names: names.length,
    legacyCatalogueSha256: sha256(original),
  };
  return { out, pointer, manifest: JSON.parse(manifest), summary };
}

export async function getPublished(url, { optional = false } = {}) {
  // These reads are idempotent. Reuse the snapshot's bounded transport retries
  // for an idle connection reset, while keeping 404 and integrity failures final.
  const result = await fetchSource(url, { attempts: 3, timeoutMs: 120_000, cache: 'no-store' });
  if (result.status === 'missing' && optional) return null;
  if (result.status !== 'ok')
    throw Error(
      `Publication read ${url}: ${result.status === 'missing' ? 'HTTP 404' : result.error}`,
    );
  return result.bytes;
}
/** Recover prior immutable inventory from the live origin; no older open tab loses its manifest/results. */
export async function retainPrevious(origin, out) {
  const inventoryBytes = await getPublished(new URL(INVENTORY, origin), { optional: true });
  if (!inventoryBytes) return null;
  const inventory = JSON.parse(inventoryBytes);
  if (inventory.schema !== 'facemorph.names-publication/1' || !Array.isArray(inventory.files))
    throw Error('Invalid previous publication inventory');
  if (
    new Set(inventory.files.map((f) => f.path)).size !== inventory.files.length ||
    inventory.files.some((f) => [POINTER, INVENTORY, '_headers'].includes(f.path))
  )
    throw Error('Invalid retained inventory paths');
  mkdirSync(out, { recursive: true });
  for (let at = 0; at < inventory.files.length; at += 16)
    await Promise.all(
      inventory.files.slice(at, at + 16).map(async (file) => {
        if (
          !safePath(file.path) ||
          !/^[a-f0-9]{64}$/.test(file.sha256) ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0
        )
          throw Error('Invalid retained file');
        let bytes = existsSync(join(out, file.path)) ? readFileSync(join(out, file.path)) : null;
        if (!bytes || bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
          bytes = await getPublished(new URL(file.path, origin));
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
          throw Error(`Retained file integrity: ${file.path}`);
        mkdirSync(dirname(join(out, file.path)), { recursive: true });
        writeFileSync(join(out, file.path), bytes);
      }),
    );
  const pointer = await getPublished(new URL(POINTER, origin));
  writeFileSync(join(out, POINTER), pointer);
  writeFileSync(join(out, INVENTORY), inventoryBytes);
  return out;
}

export async function verifyPublished(origin, prepared, { pointer = true, samples = 25 } = {}) {
  const manifestPath = JSON.parse(prepared.pointer).manifest.url;
  const manifest = await getPublished(new URL(manifestPath, origin));
  if (sha256(manifest) !== prepared.summary.manifestSha256)
    throw Error('Published manifest differs');
  if (pointer && !(await getPublished(new URL(POINTER, origin))).equals(prepared.pointer))
    throw Error('Published pointer differs');
  if (
    sha256(await getPublished(new URL('catalogue.json', origin))) !==
    prepared.summary.legacyCatalogueSha256
  )
    throw Error('Classic catalogue changed');
  for (const name of sampleRows(prepared.manifest.names, samples, 'fm-e6yj')) {
    const bytes = await getPublished(new URL(name.result.url, origin));
    await validateResult(
      bytes,
      {
        ...name,
        bytes: name.result.bytes,
        fileSha256: name.result.sha256,
        imageSha256: name.result.imageSha256,
        latentSha256: name.result.latentSha256,
      },
      prepared.manifest.identity,
    );
  }
  return {
    manifestSha256: sha256(manifest),
    sampled: Math.min(samples, prepared.manifest.names.length),
    pointerChecked: pointer,
  };
}
function cfDeploy(root, publish) {
  const child = spawnSync(
    join(REPO, 'node_modules/.bin/cf'),
    ['deploy', ...(publish ? [] : ['--dry-run'])],
    {
      cwd: join(REPO, 'hosting/gallery'),
      env: { ...process.env, CATALOGUE_PUBLIC: root },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    },
  );
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  if (child.error || child.status !== 0)
    throw child.error ?? Error(`cf deploy failed: ${child.status}`);
}
export async function main(argv) {
  const args = Object.fromEntries(
    argv
      .map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2))
      .map(([k, v]) => [k, v ?? true]),
  );
  if (!args.generated || !args.legacy || !args.origin)
    throw Error(
      'Required: --generated=<dir> --legacy=<verified snapshot host dir> --origin=<url> [--publish]',
    );
  const origin = new URL(args.origin);
  if (origin.protocol !== 'https:') throw Error('Publication origin must use HTTPS');
  const previous = await retainPrevious(origin, resolve(args.previous ?? '.cache/names-previous'));
  const before = await getPublished(new URL('catalogue.json', origin));
  if (!before.equals(readFileSync(join(args.legacy, 'catalogue.json'))))
    throw Error('Snapshot catalogue differs from live legacy catalogue');
  const prepared = await prepare({
    generated: resolve(args.generated),
    legacy: resolve(args.legacy),
    previous,
  });
  console.log(JSON.stringify({ event: 'validated', ...prepared.summary }));
  if (args.check) return prepared;
  if (args.publish) {
    const current = await getPublished(new URL(POINTER, origin), { optional: true });
    if (current?.equals(prepared.pointer)) {
      console.log(
        JSON.stringify({ event: 'unchanged', ...(await verifyPublished(origin, prepared)) }),
      );
      return prepared;
    }
  }
  cfDeploy(prepared.out, !!args.publish);
  if (args.publish)
    console.log(
      JSON.stringify({
        event: 'immutable-assets-verified',
        ...(await verifyPublished(origin, prepared, { pointer: false })),
      }),
    );
  writeFileSync(join(prepared.out, POINTER), prepared.pointer);
  cfDeploy(prepared.out, !!args.publish);
  if (args.publish)
    console.log(
      JSON.stringify({
        event: 'published',
        ...prepared.summary,
        ...(await verifyPublished(origin, prepared)),
      }),
    );
  return prepared;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
