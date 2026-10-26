// Acquire only the three provenance-pinned source-built serial runtime files.
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateOverlay } from './ort-mirror.ts';
import {
  SERIAL_ORT_FILES,
  validateSerialCompanion,
  verifySerialCompanion,
  type SerialOrtCompanion,
} from './serial-ort.ts';

export interface SerialOrtSource {
  readonly schema: 'facemorph.serial-ort-source/1';
  readonly bundleSha256: string;
  readonly files: readonly { readonly file: string; readonly url: string }[];
}
export interface AcquireSerialOptions {
  readonly companion: unknown;
  readonly source: unknown;
  readonly out: string;
  readonly token?: string;
  /** Test transport only; source URLs are validated before this function is called. */
  readonly request?: typeof fetch;
}
export interface AcquiredSerialCompanion {
  readonly dist: string;
  readonly companion: SerialOrtCompanion;
  readonly cached: boolean;
}

const ASSET_URL =
  /^https:\/\/api\.github\.com\/repos\/facemorph-me\/facemorph\.me\/releases\/assets\/[1-9][0-9]*$/;
function fail(message: string): never {
  throw new Error(`Serial acquisition: ${message}`);
}
function fields(value: unknown, names: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== [...names].sort().join(','))
    fail(`${label} has missing or unexpected fields`);
  return row;
}

/** The companion is the byte authority; source metadata grants only immutable own-repo locations. */
export function validateSerialSource(input: unknown, companionInput: unknown): SerialOrtSource {
  const companion = validateSerialCompanion(companionInput);
  const source = fields(input, ['schema', 'bundleSha256', 'files'], 'source');
  if (source.schema !== 'facemorph.serial-ort-source/1') fail('unsupported source schema');
  if (source.bundleSha256 !== companion.bundleSha256) fail('source bundle differs from companion');
  if (!Array.isArray(source.files) || source.files.length !== SERIAL_ORT_FILES.length)
    fail('source requires exactly three files');
  const urls = new Set<string>();
  const files = source.files.map((entry: unknown, index: number) => {
    const file = fields(entry, ['file', 'url'], 'source file');
    if (file.file !== companion.files[index]!.file) fail('source files must match companion order');
    if (
      typeof file.url !== 'string' ||
      !ASSET_URL.test(file.url) ||
      new URL(file.url).href !== file.url
    )
      fail('source URL must be an immutable own-repository GitHub release asset');
    if (urls.has(file.url)) fail('source asset URLs must be distinct');
    urls.add(file.url);
    return { file: file.file as string, url: file.url };
  });
  return { schema: 'facemorph.serial-ort-source/1', bundleSha256: companion.bundleSha256, files };
}

function stat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function output(input: string): string {
  if (input.split(/[\\/]/).includes('..')) fail('output path must not contain traversal');
  const out = resolve(input);
  for (let path = dirname(out); ; path = dirname(path)) {
    if (!stat(path)?.isDirectory()) fail('output parents must be existing real directories');
    if (dirname(path) === path) break;
  }
  return out;
}
function verifyDirectory(dist: string, companion: SerialOrtCompanion): void {
  if (!stat(dist)?.isDirectory()) fail('bundle must be a real directory');
  const names = readdirSync(dist).sort();
  if (names.join(',') !== [...SERIAL_ORT_FILES].sort().join(','))
    fail('bundle must contain exactly the three serial files');
  for (const file of companion.files) {
    const info = stat(join(dist, file.file));
    if (!info?.isFile() || info.size !== file.size)
      fail('bundle files must be regular files of their pinned size');
  }
  verifySerialCompanion(dist, companion);
}

async function download(
  url: string,
  expected: SerialOrtCompanion['files'][number],
  request: typeof fetch,
  token: string | undefined,
): Promise<Buffer> {
  const signal = AbortSignal.timeout(120_000);
  // GitHub's immutable API asset may redirect to its signed release CDN. Never forward the token.
  let response: Response;
  try {
    response = await request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'manual',
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && new URL(location);
      if (
        !next ||
        next.protocol !== 'https:' ||
        next.hostname !== 'release-assets.githubusercontent.com' ||
        next.port ||
        next.username ||
        next.password ||
        next.hash
      )
        fail('release redirect must name the HTTPS GitHub release CDN');
      response = await request(next.href, {
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
        redirect: 'error',
        signal,
      });
    }
  } catch {
    return fail('release asset request failed');
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    fail(`release asset returned HTTP ${response.status}`);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) !== expected.size)) {
    await response.body.cancel();
    fail('release asset content length differs from pinned size');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > expected.size) fail('release asset exceeds pinned size');
      hash.update(chunk.value);
      chunks.push(Buffer.from(chunk.value));
    }
  } catch {
    return fail('release asset stream failed or exceeded pinned size');
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (length !== expected.size || hash.digest('hex') !== expected.sha256)
    fail('release asset digest or size mismatch');
  return Buffer.concat(chunks, length);
}

/** Refuse invalid caches rather than repairing or deleting caller-owned output. */
export async function acquireSerialCompanion(
  options: AcquireSerialOptions,
): Promise<AcquiredSerialCompanion> {
  const companion = validateSerialCompanion(options.companion);
  const source = validateSerialSource(options.source, companion);
  const dist = output(options.out);
  if (stat(dist)) {
    verifyDirectory(dist, companion);
    return { dist, companion, cached: true };
  }
  const staged = mkdtempSync(join(dirname(dist), '.serial-ort-'));
  try {
    for (const [index, file] of companion.files.entries()) {
      const bytes = await download(
        source.files[index]!.url,
        file,
        options.request ?? fetch,
        options.token,
      );
      writeFileSync(join(staged, file.file), bytes, { flag: 'wx' });
    }
    verifyDirectory(staged, companion);
    if (stat(dist)) fail('output appeared during acquisition');
    renameSync(staged, dist);
    return { dist, companion, cached: false };
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { overlay: { type: 'string' }, source: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.overlay || !values.source || !values.out)
    fail('usage: acquire-serial-ort.ts --overlay <JSON> --source <JSON> --out <bundle directory>');
  const overlay = validateOverlay(JSON.parse(readFileSync(values.overlay, 'utf8')));
  if (!overlay.serial) fail('overlay has no serial companion');
  const result = await acquireSerialCompanion({
    companion: overlay.serial,
    source: JSON.parse(readFileSync(values.source, 'utf8')),
    out: values.out,
    ...(process.env['GH_TOKEN'] ? { token: process.env['GH_TOKEN'] } : {}),
  });
  console.log(
    JSON.stringify({
      dist: result.dist,
      bundleSha256: result.companion.bundleSha256,
      cached: result.cached,
    }),
  );
}
