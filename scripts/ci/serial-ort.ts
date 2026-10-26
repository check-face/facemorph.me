// fm-qeh: a bounded serial companion for the encoder's retained 108-shard schedule.
// This binds build provenance and runtime bytes, never a replacement model or qualification claim.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const SERIAL_ORT_FILES = [
  'ort.wasm.min.mjs',
  'ort-wasm-simd.mjs',
  'ort-wasm-simd.wasm',
] as const;
export const SERIAL_MAX_PAGES = 4096;
const MAX_ASSET = 64 * 1024 * 1024;
const MAX_DESCRIPTOR = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EMSDK_COMMIT = 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => {
  throw new Error(`Serial ORT: ${message}`);
};

export interface SerialOrtBuild {
  readonly version: string;
  readonly source: {
    readonly repository: 'https://github.com/microsoft/onnxruntime.git';
    readonly tag: string;
    readonly commit: string;
  };
  readonly toolchain: {
    readonly emsdkVersion: '4.0.23';
    readonly emsdkCommit: string;
  };
  readonly commandSha256: string;
  readonly linkReceiptSha256: string;
}

export interface SerialWasmMemory {
  readonly unshared: true;
  readonly initialPages: number;
  readonly maximumPages: number;
}

export interface SerialOrtFile {
  readonly file: (typeof SERIAL_ORT_FILES)[number];
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface SerialOrtCompanion {
  readonly schema: 'facemorph.serial-ort/1';
  readonly controlDescriptorSha256: string;
  readonly build: SerialOrtBuild;
  readonly memory: SerialWasmMemory;
  readonly bundleSha256: string;
  readonly files: readonly SerialOrtFile[];
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function keys(input: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(input).sort().join(',') !== [...expected].sort().join(','))
    fail(`${label} has missing or unexpected fields`);
}

function hash(input: unknown, label: string): string {
  if (typeof input !== 'string' || !SHA256.test(input)) fail(`${label} must be SHA-256`);
  return input as string;
}

function buildMetadata(input: unknown): SerialOrtBuild {
  const build = object(input, 'build');
  keys(build, ['version', 'source', 'toolchain', 'commandSha256', 'linkReceiptSha256'], 'build');
  if (typeof build.version !== 'string' || !VERSION.test(build.version))
    fail('build version must be a stable release');
  const source = object(build.source, 'source');
  keys(source, ['repository', 'tag', 'commit'], 'source');
  if (source.repository !== 'https://github.com/microsoft/onnxruntime.git')
    fail('source must be the upstream ORT repository');
  if (source.tag !== `v${build.version}`) fail('source tag must match the build version');
  if (typeof source.commit !== 'string' || !COMMIT.test(source.commit))
    fail('source commit must be a full Git SHA');
  const toolchain = object(build.toolchain, 'toolchain');
  keys(toolchain, ['emsdkVersion', 'emsdkCommit'], 'toolchain');
  if (toolchain.emsdkVersion !== '4.0.23' || toolchain.emsdkCommit !== EMSDK_COMMIT)
    fail('toolchain must identify the pinned Emsdk 4.0.23 source');
  return {
    version: build.version as string,
    source: {
      repository: source.repository as SerialOrtBuild['source']['repository'],
      tag: source.tag as string,
      commit: source.commit as string,
    },
    toolchain: { emsdkVersion: '4.0.23', emsdkCommit: EMSDK_COMMIT },
    commandSha256: hash(build.commandSha256, 'command digest'),
    linkReceiptSha256: hash(build.linkReceiptSha256, 'link receipt digest'),
  };
}

function memoryMetadata(input: unknown): SerialWasmMemory {
  const memory = object(input, 'memory');
  keys(memory, ['unshared', 'initialPages', 'maximumPages'], 'memory');
  if (memory.unshared !== true) fail('memory must be unshared');
  if (
    !Number.isSafeInteger(memory.initialPages) ||
    !Number.isSafeInteger(memory.maximumPages) ||
    (memory.initialPages as number) < 0 ||
    (memory.maximumPages as number) < 1 ||
    (memory.initialPages as number) > (memory.maximumPages as number) ||
    (memory.maximumPages as number) > SERIAL_MAX_PAGES
  )
    fail('memory must have a finite maximum of at most 4096 pages');
  return {
    unshared: true,
    initialPages: memory.initialPages as number,
    maximumPages: memory.maximumPages as number,
  };
}

/** Inspect declarations only: no WASM compilation, instantiation, patching or execution. */
export function inspectSerialWasm(input: Uint8Array): SerialWasmMemory {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (
    bytes.length > MAX_ASSET ||
    !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  )
    fail('invalid or oversized WASM module');
  let at = 8;
  let end = bytes.length;
  const byte = (): number => {
    if (at >= end) fail('truncated WASM section');
    return bytes[at++]!;
  };
  const u32 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = byte();
      if (i === 4 && b > 15) fail('invalid WASM u32');
      value += (b & 127) * 2 ** (i * 7);
      if (!(b & 128)) return value;
    }
    return fail('invalid WASM u32');
  };
  const name = (): void => {
    const size = u32();
    if (size > end - at) fail('truncated WASM import name');
    at += size;
  };
  let memory: SerialWasmMemory | undefined;
  const seen = new Set<number>();
  while (at < bytes.length) {
    end = bytes.length;
    const section = byte();
    const size = u32();
    if (size > bytes.length - at) fail('truncated WASM section');
    end = at + size;
    if (section > 13 || (section !== 0 && seen.has(section))) fail('invalid WASM section');
    seen.add(section);
    if (section === 2) {
      const count = u32();
      for (let i = 0; i < count; i++) {
        name();
        name();
        switch (byte()) {
          case 0:
            u32();
            break; // Function type index.
          case 1: {
            // A table import; memory imports below are always refused.
            const type = byte();
            if (type !== 0x70 && type !== 0x6f) fail('unsupported WASM table import');
            const flags = u32();
            if (flags > 1) fail('unsupported WASM table limits');
            u32();
            if (flags) u32();
            break;
          }
          case 2:
            fail('imported WASM memory is not a serial companion');
          case 3:
            byte();
            byte();
            break; // Global value type and mutability.
          case 4:
            byte();
            u32();
            break; // Exception tag attribute and type index.
          default:
            fail('unsupported WASM import');
        }
      }
      if (at !== end) fail('invalid WASM import section');
    } else if (section === 5) {
      if (u32() !== 1) fail('exactly one internal WASM memory is required');
      // Flag 1 means a memory32 maximum exists. Shared, memory64 and unbounded memories fail closed.
      if (u32() !== 1) fail('WASM memory must be unshared memory32 with an explicit maximum');
      memory = memoryMetadata({ unshared: true, initialPages: u32(), maximumPages: u32() });
      if (at !== end) fail('invalid WASM memory section');
    }
    at = end;
  }
  return memory ?? fail('internal WASM memory is missing');
}

function bundleDigest(
  controlDescriptorSha256: string,
  build: SerialOrtBuild,
  memory: SerialWasmMemory,
  files: readonly Pick<SerialOrtFile, 'file' | 'sha256' | 'size'>[],
): string {
  return digest(
    JSON.stringify({
      schema: 'facemorph.serial-ort/1',
      controlDescriptorSha256,
      build,
      memory,
      files: files.map(({ file, sha256, size }) => ({ file, sha256, size })),
    }),
  );
}

export function validateSerialCompanion(input: unknown): SerialOrtCompanion {
  const companion = object(input, 'companion');
  keys(
    companion,
    ['schema', 'controlDescriptorSha256', 'build', 'memory', 'bundleSha256', 'files'],
    'companion',
  );
  if (companion.schema !== 'facemorph.serial-ort/1') fail('unsupported companion schema');
  const controlDescriptorSha256 = hash(companion.controlDescriptorSha256, 'control descriptor pin');
  const build = buildMetadata(companion.build);
  const memory = memoryMetadata(companion.memory);
  const bundleSha256 = hash(companion.bundleSha256, 'bundle digest');
  if (!Array.isArray(companion.files) || companion.files.length !== SERIAL_ORT_FILES.length)
    fail('exactly three serial runtime files are required');
  const files = (companion.files as unknown[]).map((inputFile, index) => {
    const file = object(inputFile, 'file');
    keys(file, ['file', 'path', 'sha256', 'size'], 'file');
    if (file.file !== SERIAL_ORT_FILES[index])
      fail('unexpected or reordered serial runtime filename');
    if (file.path !== `assets/${bundleSha256}/${SERIAL_ORT_FILES[index]}`)
      fail('file path must be the immutable serial bundle destination');
    if (
      !Number.isSafeInteger(file.size) ||
      (file.size as number) <= 0 ||
      (file.size as number) > MAX_ASSET
    )
      fail('invalid serial runtime file size');
    return {
      file: file.file as SerialOrtFile['file'],
      path: file.path as string,
      sha256: hash(file.sha256, 'file digest'),
      size: file.size as number,
    };
  });
  if (bundleDigest(controlDescriptorSha256, build, memory, files) !== bundleSha256)
    fail('serial bundle digest differs from provenance, memory or files');
  return {
    schema: 'facemorph.serial-ort/1',
    controlDescriptorSha256,
    build,
    memory,
    bundleSha256,
    files,
  };
}

function fileBytes(dist: string, file: string): Buffer {
  const path = join(dist, file);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ASSET)
    fail(`${file} must be a nonempty regular file within the size bound`);
  return readFileSync(path);
}

function controlDescriptor(bytes: Uint8Array): Record<string, unknown> {
  if (!bytes.length || bytes.length > MAX_DESCRIPTOR) fail('invalid control descriptor size');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return fail('invalid control descriptor JSON');
  }
  const control = object(parsed, 'control descriptor');
  if (
    control.schemaVersion !== 1 ||
    control.kind !== 'e4e-onnx-sequential-shards-v1' ||
    !Array.isArray(control.steps) ||
    control.steps.length !== 108
  )
    fail('control descriptor must retain the 108-shard encoder schema');
  const runtime = object(control.runtime, 'control encoder runtime');
  if (runtime.unshared !== true || runtime.maxWasmBytes !== SERIAL_MAX_PAGES * 65536)
    fail('control encoder must retain the unshared 256 MiB contract');
  return control;
}

/** Read genuine build outputs; callers provide provenance, never a replacement descriptor. */
export function generateSerialCompanion(
  dist: string,
  buildInput: unknown,
  controlBytes: Uint8Array,
): SerialOrtCompanion {
  controlDescriptor(controlBytes);
  const build = buildMetadata(buildInput);
  const bytes = SERIAL_ORT_FILES.map((file) => fileBytes(dist, file));
  const memory = inspectSerialWasm(bytes[2]!);
  const files = SERIAL_ORT_FILES.map((file, index) => ({
    file,
    sha256: digest(bytes[index]!),
    size: bytes[index]!.length,
  }));
  const controlDescriptorSha256 = digest(controlBytes);
  const bundleSha256 = bundleDigest(controlDescriptorSha256, build, memory, files);
  return validateSerialCompanion({
    schema: 'facemorph.serial-ort/1',
    controlDescriptorSha256,
    build,
    memory,
    bundleSha256,
    files: files.map((file) => ({ ...file, path: `assets/${bundleSha256}/${file.file}` })),
  });
}

/** Recompute file identities and memory declarations independently of recorded companion metadata. */
export function verifySerialCompanion(dist: string, input: unknown): SerialOrtCompanion {
  const companion = validateSerialCompanion(input);
  for (const file of companion.files) {
    const bytes = fileBytes(dist, file.file);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      fail(`${file.file} digest or size mismatch`);
    if (
      file.file === SERIAL_ORT_FILES[2] &&
      !isDeepStrictEqual(inspectSerialWasm(bytes), companion.memory)
    )
      fail('WASM memory declarations differ from the recorded receipt');
  }
  return companion;
}

export interface ComposedEncoderDescriptor {
  readonly manifest: Record<string, unknown>;
  readonly bytes: Buffer;
  readonly path: string;
  readonly asset: { readonly url: string; readonly sha256: string; readonly size: number };
}

/** Changes only runtime version, three assets and memory receipt; it grants no new admission or qualification. */
export function composeEncoderDescriptor(
  controlBytes: Uint8Array,
  input: unknown,
  origin: string,
): ComposedEncoderDescriptor {
  const companion = validateSerialCompanion(input);
  if (digest(controlBytes) !== companion.controlDescriptorSha256)
    fail('trusted control descriptor digest mismatch');
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return fail('destination must be an HTTPS origin');
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    fail('destination must be an HTTPS origin');
  const control = controlDescriptor(controlBytes);
  const manifest = structuredClone(control);
  const asset = (index: number) => {
    const file = companion.files[index]!;
    return { url: `${base.origin}/runtime/${file.path}`, sha256: file.sha256, size: file.size };
  };
  manifest.runtime = {
    ...object(manifest.runtime, 'control encoder runtime'),
    version: companion.build.version,
    module: asset(0),
    factory: asset(1),
    wasm: asset(2),
    memoryReceipt: {
      schema: 'facemorph.serial-ort-memory/1',
      build: structuredClone(companion.build),
      ...companion.memory,
      wasmSha256: companion.files[2]!.sha256,
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const sha256 = digest(bytes);
  const path = `encoder-stream/${sha256}/manifest.json`;
  return {
    manifest,
    bytes,
    path,
    asset: { url: `${base.origin}/runtime/${path}`, sha256, size: bytes.length },
  };
}
