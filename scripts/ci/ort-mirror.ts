// fm-r4a/fm-qeh: a destination overlay for npm ORT's six WASM/GPU assets. The historical
// control stays immutable. This records lockfile provenance, not a tarball-integrity
// attestation: npm must verify the lock integrity when installing the supplied dist.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  composeEncoderDescriptor,
  validateSerialCompanion,
  type SerialOrtCompanion,
} from './serial-ort.ts';

const WASM_FILES = [
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
] as const;

export const ORT_BUILD_FILES = {
  jsep: [
    ...WASM_FILES,
    'ort.min.mjs',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ],
  webgpu: [
    ...WASM_FILES,
    'ort.webgpu.min.mjs',
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
  ],
  jspi: [
    ...WASM_FILES,
    'ort.jspi.min.mjs',
    'ort-wasm-simd-threaded.jspi.mjs',
    'ort-wasm-simd-threaded.jspi.wasm',
  ],
} as const;
export type OrtGpuBuild = keyof typeof ORT_BUILD_FILES;
/** New overlays stage the native WebGPU EP. Historical JSEP overlays retain their own file set. */
export const ORT_FILES = ORT_BUILD_FILES.webgpu;

export interface OrtMirrorFile {
  readonly file: (typeof ORT_BUILD_FILES)[OrtGpuBuild][number];
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

interface OrtMirrorBase {
  readonly version: string;
  readonly npm: {
    readonly package: 'onnxruntime-web';
    readonly url: string;
    readonly integrity: string;
  };
  readonly gpuBuild: OrtGpuBuild;
  readonly bundleSha256: string;
  readonly files: readonly OrtMirrorFile[];
}

export type OrtMirrorOverlay = OrtMirrorBase &
  (
    | { readonly schema: 'facemorph.ort-mirror/1'; readonly serial?: never }
    | { readonly schema: 'facemorph.ort-mirror/2'; readonly serial: SerialOrtCompanion }
  );

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
  gpuBuild: OrtGpuBuild,
  files: readonly Pick<OrtMirrorFile, 'file' | 'sha256' | 'size'>[],
): string {
  return digest(
    JSON.stringify({
      version,
      npm,
      gpuBuild,
      files: files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
}

function buildName(value: unknown): OrtGpuBuild {
  if (value !== 'jsep' && value !== 'webgpu' && value !== 'jspi') fail('unsupported GPU build');
  return value as OrtGpuBuild;
}

/** Reject arbitrary paths, extra assets, mismatched GPU builds, and altered bundle metadata. */
export function validateOverlay(input: unknown): OrtMirrorOverlay {
  const overlay = object(input, 'overlay');
  if (
    overlay['schema'] !== 'facemorph.ort-mirror/1' &&
    overlay['schema'] !== 'facemorph.ort-mirror/2'
  )
    fail('unsupported overlay schema');
  const serial = overlay['schema'] === 'facemorph.ort-mirror/2';
  keys(
    overlay,
    [
      'schema',
      'version',
      'npm',
      'gpuBuild',
      'bundleSha256',
      'files',
      ...(serial ? ['serial'] : []),
    ],
    'overlay',
  );
  const gpuBuild = buildName(overlay['gpuBuild']);
  const expectedFiles = ORT_BUILD_FILES[gpuBuild];
  const npm = object(overlay['npm'], 'npm');
  keys(npm, ['package', 'url', 'integrity'], 'npm');
  if (npm['package'] !== 'onnxruntime-web') fail('unexpected npm package');
  const source = provenance(overlay['version'], npm['url'], npm['integrity']);
  if (typeof overlay['bundleSha256'] !== 'string' || !SHA256.test(overlay['bundleSha256']))
    fail('invalid bundle digest');
  if (!Array.isArray(overlay['files']) || overlay['files'].length !== expectedFiles.length)
    fail('exactly six WASM/GPU files are required');
  const files = (overlay['files'] as unknown[]).map((inputFile, index) => {
    const file = object(inputFile, 'file');
    keys(file, ['file', 'path', 'sha256', 'size'], 'file');
    if (file['file'] !== expectedFiles[index]) fail('unexpected or reordered ORT filename');
    if (file['path'] !== `assets/${overlay['bundleSha256']}/${expectedFiles[index]}`)
      fail('file path must be the immutable bundle destination');
    if (typeof file['sha256'] !== 'string' || !SHA256.test(file['sha256']))
      fail('invalid file digest');
    if (!Number.isSafeInteger(file['size']) || (file['size'] as number) <= 0)
      fail('invalid file size');
    return file as unknown as OrtMirrorFile;
  });
  if (
    bundleDigest(overlay['version'] as string, source, gpuBuild, files) !== overlay['bundleSha256']
  )
    fail('bundle digest does not match its provenance and files');
  if (serial && validateSerialCompanion(overlay['serial']).build.version !== overlay['version'])
    fail('serial companion version differs from the npm runtime');
  return structuredClone(input) as OrtMirrorOverlay;
}

/** Upgrade the envelope without changing the six npm assets or their historical bundle digest. */
export function withSerialCompanion(
  input: unknown,
  serial: unknown,
): Extract<OrtMirrorOverlay, { schema: 'facemorph.ort-mirror/2' }> {
  return validateOverlay({
    ...validateOverlay(input),
    schema: 'facemorph.ort-mirror/2',
    serial,
  }) as Extract<OrtMirrorOverlay, { schema: 'facemorph.ort-mirror/2' }>;
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
export function generateOverlay(
  dist: string,
  lockInput: unknown,
  gpuBuild: OrtGpuBuild = 'webgpu',
): OrtMirrorOverlay {
  const lock = object(lockInput, 'lock entry');
  const npm = provenance(lock['version'], lock['resolved'], lock['integrity']);
  const version = lock['version'] as string;
  installed(dist, version);
  const rows = ORT_BUILD_FILES[buildName(gpuBuild)].map((file) => {
    const bytes = fileBytes(dist, file);
    return { file, sha256: digest(bytes), size: bytes.length };
  });
  const bundleSha256 = bundleDigest(version, npm, gpuBuild, rows);
  return validateOverlay({
    schema: 'facemorph.ort-mirror/1',
    version,
    npm,
    gpuBuild,
    bundleSha256,
    files: rows.map((row) => ({ ...row, path: `assets/${bundleSha256}/${row.file}` })),
  });
}

/** Check the six npm files; schema 2's separate serial files require verifySerialCompanion as well. */
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

export interface ComposeOptions {
  /** Exact bytes addressed by the trusted root control's encoderStream pin; mandatory for schema 2. */
  readonly controlEncoderDescriptorBytes?: Uint8Array;
}

/** Compose the declared runtime subtrees; all model/reference/admission fields retain their control values. */
export function composeManifest(
  controlInput: unknown,
  input: unknown,
  origin: string,
  options: ComposeOptions = {},
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
  let encoderStream: Record<string, unknown> | undefined;
  if (overlay.schema === 'facemorph.ort-mirror/2') {
    const reference = object(control['encoderStream'], 'control encoder reference');
    pinnedAsset(reference);
    if (reference.sha256 !== overlay.serial.controlDescriptorSha256)
      fail('serial companion does not name the trusted control encoder pin');
    const bytes =
      options.controlEncoderDescriptorBytes ??
      fail('trusted control encoder descriptor bytes are required for schema 2');
    if (reference.size !== bytes.length) fail('trusted control encoder descriptor size mismatch');
    const descriptor = composeEncoderDescriptor(bytes, overlay.serial, origin);
    encoderStream = { ...structuredClone(reference), ...descriptor.asset };
  }
  return {
    ...structuredClone(control),
    ...(encoderStream === undefined ? {} : { encoderStream }),
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
