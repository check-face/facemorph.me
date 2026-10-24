#!/usr/bin/env node
// Snapshot every object the two public static Workers publish (bead fm-old) into an S3-compatible bucket,
// so the names catalogue can be rebuilt after api.facemorph.me is retired. R2 is only the production
// endpoint; tests run against a local S3-compatible server and a local origin.
//
// The published set is each Worker's own published inventory plus the inventory file itself:
//   facemorph-seed-gallery   manifest.json (8,966 entries: 200px name previews, historic 1024px images, seeds)
//   facemorph-name-catalogue ledger.json   (7,200 files: catalogue.json, 1024px previews, W+ latents)
// `plan` turns them into manifest.tsv (one row per object: source URL, name, bytes, sha256) and
// manifest-summary.json. `run` makes the bucket match the manifest: an object already in the bucket
// with the right digest is never fetched again; a missing or corrupted one is fetched from its source,
// checked against its manifest digest, written, and read back. The object key is the source URL without
// its scheme, so the manifest row alone names both.
//
// Logs one JSON line per step with counts and digests. Exit codes: 0 complete, 20 incomplete (objects
// missing at the source or failing their digest), 2 usage.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export const EXIT = { complete: 0, incomplete: 20, usage: 2 };

export const SOURCES = [
  {
    worker: 'facemorph-seed-gallery',
    origin: 'https://facemorph-seed-gallery.cdilga.workers.dev',
    inventory: 'manifest.json',
  },
  {
    worker: 'facemorph-name-catalogue',
    origin: 'https://facemorph-name-catalogue.cdilga.workers.dev',
    inventory: 'ledger.json',
  },
];

export const DEFAULTS = { bucket: 'facemorph-names-snapshot', concurrency: 8, attempts: 3 };

const here = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = resolve(here, 'manifest.tsv');
export const SUMMARY_PATH = resolve(here, 'manifest-summary.json');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Object key: the source URL without its scheme (host[:port]/path).
export const keyOf = (url) => {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
};

const TYPES = {
  jpg: 'image/jpeg',
  webp: 'image/webp',
  json: 'application/json',
  f32: 'application/octet-stream',
};
const contentType = (url) => TYPES[url.split('.').pop()] ?? 'application/octet-stream';

// Build the manifest rows from the two fetched inventories. Plain values in, plain values out:
//   seed     { origin, inventory, bytes, json }   the seed gallery's manifest.json
//   catalogue{ origin, inventory, bytes, json, catalogueJson }   the name catalogue's ledger.json and catalogue.json
// Every name identity is re-derived (id = sha256 of the exact lowercase value) and each name must have
// a 200px preview, a 1024px preview and a latent. Zero-byte objects are kept and listed as defects.
export function planManifest(seed, catalogue) {
  const names = new Map();
  for (const n of catalogue.catalogueJson.names) {
    if (
      n.value !== n.value.toLowerCase() ||
      sha256(Buffer.from(n.value)) !== n.id ||
      names.has(n.id)
    )
      throw new Error(`invalid name identity: ${n.id}`);
    if (/[\t\n\r]/.test(n.value))
      throw new Error(`name not representable in the manifest: ${n.id}`);
    names.set(n.id, n.value);
  }
  const rows = [];
  const coverage = { preview200: new Set(), full1024: new Set(), latent: new Set(), seeds: 0 };
  const nameOf = (id) => {
    if (!names.has(id)) throw new Error(`object for an unpublished name identity: ${id}`);
    return names.get(id);
  };

  rows.push({
    url: `${seed.origin}/${seed.inventory}`,
    name: '',
    bytes: seed.bytes.length,
    sha256: sha256(seed.bytes),
  });
  for (const e of seed.json.entries) {
    let name;
    if (e.identity.startsWith('hash-')) {
      name = nameOf(e.identity.slice(5));
      (e.dimension === 200 ? coverage.preview200 : coverage.full1024).add(name);
    } else if (/^s\d+$/.test(e.identity)) {
      name = `seed:${e.identity.slice(1)}`;
      coverage.seeds++;
    } else throw new Error(`unknown seed-gallery identity: ${e.identity}`);
    rows.push({
      url: `${seed.origin}/${e.sourceRelativePath}`,
      name,
      bytes: e.bytes,
      sha256: e.sha256,
    });
  }

  rows.push({
    url: `${catalogue.origin}/${catalogue.inventory}`,
    name: '',
    bytes: catalogue.bytes.length,
    sha256: sha256(catalogue.bytes),
  });
  for (const f of catalogue.json.files) {
    const m = /^(full|latent)\/([0-9a-f]{64})\.(jpg|f32)$/.exec(f.path);
    let name = '';
    if (m) {
      name = nameOf(m[2]);
      (m[1] === 'full' ? coverage.full1024 : coverage.latent).add(name);
    } else if (f.path !== 'catalogue.json')
      throw new Error(`unknown name-catalogue path: ${f.path}`);
    rows.push({ url: `${catalogue.origin}/${f.path}`, name, bytes: f.size, sha256: f.sha256 });
  }

  const catalogueRow = rows.find((r) => r.url === `${catalogue.origin}/catalogue.json`);
  if (!catalogueRow || catalogueRow.sha256 !== sha256(catalogue.catalogueBytes))
    throw new Error('catalogue.json does not match its ledger row');
  const keys = new Set(rows.map((r) => keyOf(r.url)));
  if (keys.size !== rows.length) throw new Error('duplicate object key');
  for (const r of rows)
    if (!/^[0-9a-f]{64}$/.test(r.sha256) || !Number.isInteger(r.bytes) || r.bytes < 0)
      throw new Error(`invalid row: ${r.url}`);

  const missing = [...names.values()].filter(
    (v) => !coverage.preview200.has(v) || !coverage.full1024.has(v) || !coverage.latent.has(v),
  );
  if (missing.length)
    throw new Error(`${missing.length} published name(s) lack a preview or latent`);
  return {
    rows,
    coverage: {
      names: names.size,
      preview200: coverage.preview200.size,
      full1024: coverage.full1024.size,
      latent: coverage.latent.size,
      seeds: coverage.seeds,
    },
    // Published as they are, and snapshotted as they are; reported so no consumer mistakes them for assets.
    defects: rows
      .filter((r) => r.bytes === 0)
      .map((r) => ({ url: r.url, name: r.name, defect: 'empty object (published with 0 bytes)' })),
  };
}

const HEADER = 'source_url\tname\tbytes\tsha256';
export const formatManifest = (rows) =>
  `${HEADER}\n${rows.map((r) => `${r.url}\t${r.name}\t${r.bytes}\t${r.sha256}`).join('\n')}\n`;

export function parseManifest(text) {
  const [head, ...lines] = text.split('\n').filter((l) => l);
  if (head !== HEADER) throw new Error('not a names-snapshot manifest');
  return lines.map((l) => {
    const [url, name, bytes, digest] = l.split('\t');
    return { url, name, bytes: Number(bytes), sha256: digest };
  });
}

export function summarize(rows) {
  const bySource = new Map();
  for (const r of rows) {
    const s = bySource.get(new URL(r.url).origin) ?? {
      origin: new URL(r.url).origin,
      objects: 0,
      bytes: 0,
    };
    s.objects++;
    s.bytes += r.bytes;
    bySource.set(s.origin, s);
  }
  return {
    objects: rows.length,
    bytes: rows.reduce((t, r) => t + r.bytes, 0),
    sources: [...bySource.values()],
  };
}

// Fetch one source object, retrying network errors and 5xx. A 404 is final: missing.
export async function fetchSource(url, { attempts = DEFAULTS.attempts, timeoutMs = 60_000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'FaceMorph-names-snapshot/1' },
      });
      if (res.status === 404) return { status: 'missing' };
      if (!res.ok) {
        last = `http ${res.status}`;
        await res.body?.cancel();
        continue;
      }
      return { status: 'ok', bytes: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      last = e.name === 'TimeoutError' ? 'timeout' : e.message;
    }
  }
  return { status: 'failed', error: last };
}

const isNotFound = (e) =>
  e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;

export async function readObject(client, bucket, key) {
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

// One row: verify in the bucket, else fetch, check, write, read back. Returns the row's outcome.
async function syncRow(row, { client, bucket, verifyOnly, attempts }) {
  const key = keyOf(row.url);
  const stored = await readObject(client, bucket, key);
  if (stored && stored.length === row.bytes && sha256(stored) === row.sha256)
    return { outcome: 'verified' };
  const prior = stored ? 'corrupt' : 'absent';
  if (verifyOnly) return { outcome: prior };
  for (let i = 0; i < attempts; i++) {
    const got = await fetchSource(row.url, { attempts });
    if (got.status === 'missing') return { outcome: 'missing', prior };
    if (got.status === 'failed') return { outcome: 'source-failed', prior, error: got.error };
    // Wrong size or digest: retried, since truncation in transit looks the same; persistent means the
    // source no longer serves the published bytes.
    if (got.bytes.length !== row.bytes || sha256(got.bytes) !== row.sha256) continue;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: got.bytes,
        ContentType: contentType(row.url),
        Metadata: { sha256: row.sha256 },
      }),
    );
    const back = await readObject(client, bucket, key);
    if (!back || sha256(back) !== row.sha256) return { outcome: 'store-mismatch', prior };
    return { outcome: 'fetched', prior };
  }
  return { outcome: 'source-mismatch', prior };
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

// Make the bucket match the manifest rows. verifyOnly reads the bucket and fetches nothing.
export async function run({
  rows,
  client,
  bucket = DEFAULTS.bucket,
  concurrency = DEFAULTS.concurrency,
  attempts = DEFAULTS.attempts,
  verifyOnly = false,
  log = () => {},
}) {
  const counts = { verified: 0, fetched: 0, refetchedCorrupt: 0 };
  const problems = {
    absent: [],
    corrupt: [],
    missing: [],
    'source-failed': [],
    'source-mismatch': [],
    'store-mismatch': [],
    'store-error': [],
  };
  let done = 0;
  await pool(rows, concurrency, async (row) => {
    // A store error (after the SDK's own retries) is reported for its row; a re-run picks it up.
    const r = await syncRow(row, { client, bucket, verifyOnly, attempts }).catch(() => ({
      outcome: 'store-error',
    }));
    if (r.outcome === 'verified') counts.verified++;
    else if (r.outcome === 'fetched') {
      counts.fetched++;
      if (r.prior === 'corrupt') counts.refetchedCorrupt++;
    } else problems[r.outcome].push(row.url);
    if (++done % 1000 === 0) log({ event: 'progress', done, total: rows.length, ...counts });
  });
  for (const list of Object.values(problems)) list.sort();
  const complete = counts.verified + counts.fetched === rows.length;
  const report = {
    complete,
    total: rows.length,
    bytes: rows.reduce((t, r) => t + r.bytes, 0),
    ...counts,
    problems,
  };
  log({
    event: 'run',
    complete,
    total: rows.length,
    ...counts,
    ...Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, v.length])),
  });
  return report;
}

export function s3Client({ endpoint, accessKeyId, secretAccessKey }) {
  // Without timeouts one stalled request blocks its pool worker for ever (seen on R2 at 12,000 objects).
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000 },
  });
}

// R2 S3 credentials derived from a short-lived Cloudflare API token scoped to one bucket:
// access key = token id, secret = SHA-256 of the token value.
export function mintR2Token(accountId, bucket, write, minutes = 120) {
  const group = write ? '2efd5506f9c8494dacb1fa10a3e7d5b6' : '6a018a9f2fc74eb6b293b0c548f38b39';
  const expires = new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const policies = JSON.stringify([
    {
      effect: 'allow',
      resources: { [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`]: '*' },
      permission_groups: [{ id: group }],
    },
  ]);
  const name = `fm-old names snapshot ${write ? 'object read-write' : 'object read'} ${new Date().toISOString()}`;
  const t = JSON.parse(
    execFileSync(
      'cf',
      ['user', 'tokens', 'create', '--name', name, '--policies', policies, '--expires-on', expires],
      { encoding: 'utf8' },
    ),
  );
  return {
    id: t.id,
    expires,
    accessKeyId: t.id,
    secretAccessKey: createHash('sha256').update(t.value).digest('hex'),
  };
}

export function revokeR2Token(token) {
  try {
    execFileSync('cf', ['user', 'tokens', 'delete', token.id, '--force'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Store client from --mint-r2=<account id> (short-lived token, revoked by the caller) or from
// S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
export async function clientFromArgs(a, bucket, write) {
  if (a['mint-r2']) {
    const token = mintR2Token(a['mint-r2'], bucket, write);
    await new Promise((r) => setTimeout(r, 5000)); // new tokens take a moment to reach the edge
    return {
      client: s3Client({ endpoint: `https://${a['mint-r2']}.r2.cloudflarestorage.com`, ...token }),
      token,
      endpointClass: 'r2',
    };
  }
  if (!process.env.S3_ENDPOINT)
    throw new Error(
      'set --mint-r2=<account id> or S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
    );
  return {
    client: s3Client({
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    }),
    token: null,
    endpointClass: 's3',
  };
}

export const parseArgs = (argv) =>
  Object.fromEntries(
    argv
      .map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2))
      .map(([k, v]) => [k, v ?? true]),
  );

async function plan(a) {
  const [seedSrc, catSrc] = SOURCES;
  const get = async (url) => {
    const r = await fetchSource(url);
    if (r.status !== 'ok') throw new Error(`could not fetch ${url}: ${r.status}`);
    return r.bytes;
  };
  const seedBytes = await get(`${seedSrc.origin}/${seedSrc.inventory}`);
  const catBytes = await get(`${catSrc.origin}/${catSrc.inventory}`);
  const catalogueBytes = await get(`${catSrc.origin}/catalogue.json`);
  const { rows, coverage, defects } = planManifest(
    {
      origin: seedSrc.origin,
      inventory: seedSrc.inventory,
      bytes: seedBytes,
      json: JSON.parse(seedBytes),
    },
    {
      origin: catSrc.origin,
      inventory: catSrc.inventory,
      bytes: catBytes,
      json: JSON.parse(catBytes),
      catalogueBytes,
      catalogueJson: JSON.parse(catalogueBytes),
    },
  );
  const text = formatManifest(rows);
  const manifestPath = a.manifest ? resolve(a.manifest) : MANIFEST_PATH;
  writeFileSync(manifestPath, text);
  const summary = {
    bead: 'fm-old',
    plannedAt: new Date().toISOString(),
    manifest: { file: 'manifest.tsv', sha256: sha256(text), columns: HEADER.split('\t') },
    inventories: [
      {
        worker: seedSrc.worker,
        url: `${seedSrc.origin}/${seedSrc.inventory}`,
        sha256: sha256(seedBytes),
      },
      {
        worker: catSrc.worker,
        url: `${catSrc.origin}/${catSrc.inventory}`,
        sha256: sha256(catBytes),
      },
    ],
    ...summarize(rows),
    coverage,
    defects,
    store: null,
    restoreCheck: null,
  };
  writeFileSync(
    a.summary ? resolve(a.summary) : SUMMARY_PATH,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return { summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  const log = (o) => console.log(JSON.stringify(o));
  if (cmd === 'plan') {
    const { summary } = await plan(a);
    log({
      event: 'plan',
      objects: summary.objects,
      bytes: summary.bytes,
      manifestSha256: summary.manifest.sha256,
      coverage: summary.coverage,
    });
  } else if (cmd === 'run' || cmd === 'verify') {
    const bucket = a.bucket ?? DEFAULTS.bucket;
    const text = readFileSync(a.manifest ? resolve(a.manifest) : MANIFEST_PATH, 'utf8');
    const rows = parseManifest(text);
    const { client, token, endpointClass } = await clientFromArgs(a, bucket, cmd === 'run');
    let report;
    try {
      report = await run({
        rows,
        client,
        bucket,
        verifyOnly: cmd === 'verify',
        concurrency: Number(a.concurrency ?? DEFAULTS.concurrency),
        log,
      });
    } finally {
      if (token) log({ event: 'token', revoked: revokeR2Token(token), expires: token.expires });
    }
    if (a['record-summary'] && report.complete) {
      const summaryPath = a.summary ? resolve(a.summary) : SUMMARY_PATH;
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      if (summary.manifest.sha256 !== sha256(text))
        throw new Error('summary describes a different manifest');
      summary.store = {
        bucket,
        endpointClass,
        keyScheme: 'source URL without scheme',
        verifiedAt: new Date().toISOString(),
        mode: cmd,
        verifiedObjects: report.total,
        verifiedBytes: report.bytes,
        fetchedThisRun: report.fetched,
      };
      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    }
    for (const [k, v] of Object.entries(report.problems))
      for (const url of v.slice(0, 20)) log({ event: 'problem', kind: k, url });
    process.exitCode = report.complete ? EXIT.complete : EXIT.incomplete;
  } else {
    console.error(
      'usage: snapshot.mjs plan | run|verify [--bucket=] [--mint-r2=<account id>] [--record-summary] [--concurrency=]',
    );
    process.exitCode = EXIT.usage;
  }
}
