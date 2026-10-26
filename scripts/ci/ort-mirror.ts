// fm-r4a: a destination overlay for npm ORT's six WASM/JSEP assets. The historical
// control stays immutable. This records lockfile provenance, not a tarball-integrity
// attestation: npm must verify the lock integrity when installing the supplied dist.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ORT_FILES = [
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort.min.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
] as const;

export interface OrtMirrorFile {
  readonly file: (typeof ORT_FILES)[number];
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface OrtMirrorOverlay {
  readonly schema: 'facemorph.ort-mirror/1';
  readonly version: string;
  readonly npm: {
    readonly package: 'onnxruntime-web';
    readonly url: string;
    readonly integrity: string;
  };
  readonly gpuBuild: 'jsep';
  readonly bundleSha256: string;
  readonly files: readonly OrtMirrorFile[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => {
  throw new Error(`ORT mirror: ${message}`);
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(','))
    fail(`${label} has missing or unexpected fields`);
}

function provenance(version: unknown, url: unknown, integrity: unknown): OrtMirrorOverlay['npm'] {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version))
    fail('version must be a stable numeric release');
  if (url !== `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${version}.tgz`)
    fail('npm URL must name the same release on the npm registry');
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity))
    fail('npm integrity must be canonical sha512 SRI');
  const sri = integrity as string;
  if (Buffer.from(sri.slice(7), 'base64').toString('base64') !== sri.slice(7))
    fail('npm integrity must be canonical sha512 SRI');
  return { package: 'onnxruntime-web', url: url as string, integrity: sri };
}

function bundleDigest(
  version: string,
  npm: OrtMirrorOverlay['npm'],
  files: readonly Pick<OrtMirrorFile, 'file' | 'sha256' | 'size'>[],
): string {
  return digest(
    JSON.stringify({
      version,
      npm,
      gpuBuild: 'jsep',
      files: files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
}

/** Reject arbitrary paths, extra assets, native asyncify, and altered bundle metadata. */
export function validateOverlay(input: unknown): OrtMirrorOverlay {
  const overlay = object(input, 'overlay');
  keys(overlay, ['schema', 'version', 'npm', 'gpuBuild', 'bundleSha256', 'files'], 'overlay');
  if (overlay['schema'] !== 'facemorph.ort-mirror/1' || overlay['gpuBuild'] !== 'jsep')
    fail('unsupported overlay schema or GPU build');
  const npm = object(overlay['npm'], 'npm');
  keys(npm, ['package', 'url', 'integrity'], 'npm');
  if (npm['package'] !== 'onnxruntime-web') fail('unexpected npm package');
  const source = provenance(overlay['version'], npm['url'], npm['integrity']);
  if (typeof overlay['bundleSha256'] !== 'string' || !SHA256.test(overlay['bundleSha256']))
    fail('invalid bundle digest');
  if (!Array.isArray(overlay['files']) || overlay['files'].length !== ORT_FILES.length)
    fail('exactly six WASM/JSEP files are required');
  const files = (overlay['files'] as unknown[]).map((inputFile, index) => {
    const file = object(inputFile, 'file');
    keys(file, ['file', 'path', 'sha256', 'size'], 'file');
    if (file['file'] !== ORT_FILES[index]) fail('unexpected or reordered ORT filename');
    if (file['path'] !== `assets/${overlay['bundleSha256']}/${ORT_FILES[index]}`)
      fail('file path must be the immutable bundle destination');
    if (typeof file['sha256'] !== 'string' || !SHA256.test(file['sha256']))
      fail('invalid file digest');
    if (!Number.isSafeInteger(file['size']) || (file['size'] as number) <= 0)
      fail('invalid file size');
    return file as unknown as OrtMirrorFile;
  });
  if (bundleDigest(overlay['version'] as string, source, files) !== overlay['bundleSha256'])
    fail('bundle digest does not match its provenance and files');
  return structuredClone(input) as OrtMirrorOverlay;
}

function installed(dist: string, version: string): void {
  const pkg = object(
    JSON.parse(readFileSync(join(dirname(dist), 'package.json'), 'utf8')),
    'installed package',
  );
  if (pkg['name'] !== 'onnxruntime-web' || pkg['version'] !== version)
    fail('installed package identity differs from the lock');
}

function fileBytes(dist: string, file: string): Buffer {
  const path = join(dist, file);
  if (!lstatSync(path).isFile()) fail(`${file} must be a regular file`);
  const bytes = readFileSync(path);
  if (!bytes.length) fail(`${file} is empty`);
  return bytes;
}

/** dist is the installed package's dist directory; lock is its package-lock entry. */
export function generateOverlay(dist: string, lockInput: unknown): OrtMirrorOverlay {
  const lock = object(lockInput, 'lock entry');
  const npm = provenance(lock['version'], lock['resolved'], lock['integrity']);
  const version = lock['version'] as string;
  installed(dist, version);
  const rows = ORT_FILES.map((file) => {
    const bytes = fileBytes(dist, file);
    return { file, sha256: digest(bytes), size: bytes.length };
  });
  const bundleSha256 = bundleDigest(version, npm, rows);
  return validateOverlay({
    schema: 'facemorph.ort-mirror/1',
    version,
    npm,
    gpuBuild: 'jsep',
    bundleSha256,
    files: rows.map((row) => ({ ...row, path: `assets/${bundleSha256}/${row.file}` })),
  });
}

/** Check supplied bytes before acquiring/staging an already recorded overlay. */
export function verifyOverlay(dist: string, input: unknown): OrtMirrorOverlay {
  const overlay = validateOverlay(input);
  installed(dist, overlay.version);
  for (const file of overlay.files) {
    const bytes = fileBytes(dist, file.file);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      fail(`${file.file} digest or size mismatch`);
  }
  return overlay;
}

function httpsUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string') fail(`${label} must be an HTTPS URL`);
  let url: URL;
  try {
    url = new URL(value as string);
  } catch {
    return fail(`${label} must be an HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    fail(`${label} must be an HTTPS URL without credentials, query or fragment`);
  return url;
}

function pinnedAsset(value: unknown): void {
  const asset = object(value, 'control runtime asset');
  httpsUrl(asset['url'], 'control asset URL');
  if (typeof asset['sha256'] !== 'string' || !SHA256.test(asset['sha256']))
    fail('invalid control asset digest');
  if (!Number.isSafeInteger(asset['size']) || (asset['size'] as number) <= 0)
    fail('invalid control asset size');
}

/** Compose only the two ORT subtrees; model/reference fields remain byte-for-byte values. */
export function composeManifest(
  controlInput: unknown,
  input: unknown,
  origin: string,
): Record<string, unknown> {
  const overlay = validateOverlay(input);
  const base = httpsUrl(origin, 'destination origin');
  if (base.pathname !== '/') fail('destination must be an origin without a path');
  const control = object(controlInput, 'control manifest');
  if (control['schemaVersion'] !== 1) fail('unsupported control manifest schema');
  const runtime = object(control['runtime'], 'control runtime');
  const webgpu = object(control['webgpu'], 'control WebGPU');
  const gpuRuntime = object(webgpu['runtime'], 'control WebGPU runtime');
  for (const value of [runtime['version'], gpuRuntime['version']])
    if (typeof value !== 'string' || !STABLE_VERSION.test(value))
      fail('invalid control runtime version');
  httpsUrl(runtime['moduleUrl'], 'control module URL');
  httpsUrl(runtime['wasmPaths'], 'control WASM paths');
  if (!Array.isArray(runtime['assets']) || runtime['assets'].length !== 3)
    fail('control WASM runtime must pin three assets');
  (runtime['assets'] as unknown[]).forEach(pinnedAsset);
  for (const field of ['module', 'factory', 'wasm']) pinnedAsset(gpuRuntime[field]);
  const asset = (index: number) => {
    const file = overlay.files[index]!;
    return { url: `${base.origin}/runtime/${file.path}`, sha256: file.sha256, size: file.size };
  };
  const wasm = [asset(0), asset(1), asset(2)];
  return {
    ...structuredClone(control),
    runtime: {
      ...structuredClone(runtime),
      version: overlay.version,
      moduleUrl: wasm[0]!.url,
      wasmPaths: `${base.origin}/runtime/assets/${overlay.bundleSha256}/`,
      assets: wasm,
    },
    webgpu: {
      ...structuredClone(webgpu),
      runtime: {
        ...structuredClone(gpuRuntime),
        version: overlay.version,
        module: asset(3),
        factory: asset(4),
        wasm: asset(5),
      },
    },
  };
}
