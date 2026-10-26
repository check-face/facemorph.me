// Trusted runtime composition metadata for build admission and exact-tree verification.
// This projection is not a download inventory: acquire the frozen control first, then stage the overlay.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeManifest, validateOverlay, type OrtMirrorOverlay } from './ort-mirror.ts';
import { composeEncoderDescriptor, type ComposedEncoderDescriptor } from './serial-ort.ts';

const ORIGIN = 'https://next.facemorph.me';
const DERIVED = 'derived:import/runtime-mirror.json';
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const fail = (message: string): never => {
  throw new Error(`Candidate runtime: ${message}`);
};

export interface RuntimeAssetRow {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number | null;
  readonly location: string;
  readonly acquire?: readonly string[];
  readonly [key: string]: unknown;
}
export interface HostedRuntimeWorker {
  readonly path: string;
  readonly sha256: string;
  readonly [key: string]: unknown;
}
export interface RuntimeBuildInputs {
  readonly runtime: {
    readonly manifest: {
      readonly sha256: string;
      readonly bytes: number;
      readonly modelSourceSha256: string;
      readonly [key: string]: unknown;
    };
    readonly assets: readonly RuntimeAssetRow[];
    readonly [key: string]: unknown;
  };
  readonly worker_graphs: {
    readonly pinned: readonly HostedRuntimeWorker[];
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}
export interface CandidateRuntime {
  readonly controlBuildInputs: RuntimeBuildInputs;
  /** Verification metadata only; derived locations must never be sent to a downloader. */
  readonly buildInputs: RuntimeBuildInputs;
  readonly controlManifestBytes: Buffer;
  readonly manifest: Record<string, unknown>;
  readonly manifestBytes: Buffer;
  readonly manifestSha256: string;
  readonly modelSha256: string;
  readonly hosted: readonly { readonly path: string; readonly sha256: string }[];
  readonly overlay: OrtMirrorOverlay | null;
  readonly controlEncoderDescriptorBytes?: Buffer;
  readonly encoderDescriptor?: ComposedEncoderDescriptor;
}

function verifiedBytes(path: string, sha256: string, size: number, label: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  const bytes = readFileSync(path);
  if (bytes.length !== size || hash(bytes) !== sha256)
    fail(`${label} bytes differ from the trusted pin`);
  return bytes;
}
function runtimePath(value: unknown, encoder = false): string {
  if (typeof value !== 'string') return fail('runtime asset must name a canonical URL');
  const url = new URL(value);
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/runtime/') ||
    (encoder && !/^\/runtime\/encoder-stream\/[a-f0-9]{64}\/manifest\.json$/.test(url.pathname))
  )
    fail('frozen encoder/runtime reference must name its canonical descriptor or asset');
  return url.pathname.slice('/runtime/'.length);
}

/** Read only the reviewed repository paths; no environment pin, candidate manifest, fetch or mutation. */
export function loadCandidateRuntime(repo: string): CandidateRuntime {
  const controlBuildInputs = JSON.parse(
    readFileSync(join(repo, 'import/build-inputs.json'), 'utf8'),
  ) as RuntimeBuildInputs;
  const pin = controlBuildInputs.runtime.manifest;
  if (!/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1)
    fail('invalid frozen control pin');
  const controlManifestBytes = verifiedBytes(
    join(repo, 'import/runtime-manifests/control', pin.sha256, 'manifest.json'),
    pin.sha256,
    pin.bytes,
    'frozen control',
  );
  const control = JSON.parse(controlManifestBytes.toString('utf8'));
  if (control.modelSourceSha256 !== pin.modelSourceSha256)
    fail('frozen model source differs from build-inputs');
  const rows = controlBuildInputs.runtime.assets;
  const paths = new Set(rows.map((row) => row.path));
  if (paths.size !== rows.length) fail('frozen asset inventory contains duplicate paths');
  const rootRow = rows.find((row) => row.path === 'manifest.json');
  if (!rootRow || rootRow.sha256 !== pin.sha256 || rootRow.bytes !== pin.bytes)
    fail('frozen root asset row differs from its manifest pin');
  const overlayPath = join(repo, 'import/runtime-mirror.json');
  const overlay = existsSync(overlayPath)
    ? validateOverlay(JSON.parse(readFileSync(overlayPath, 'utf8')))
    : null;
  let controlEncoderDescriptorBytes: Buffer | undefined;
  let encoderDescriptor: ComposedEncoderDescriptor | undefined;
  if (overlay?.schema === 'facemorph.ort-mirror/2') {
    const reference = control.encoderStream;
    const path = runtimePath(reference?.url, true);
    controlEncoderDescriptorBytes = verifiedBytes(
      join(repo, 'import/runtime-manifests', path),
      reference.sha256,
      reference.size,
      'frozen encoder',
    );
    encoderDescriptor = composeEncoderDescriptor(
      controlEncoderDescriptorBytes,
      overlay.serial,
      ORIGIN,
    );
  }
  const manifest =
    overlay === null
      ? control
      : composeManifest(
          control,
          overlay,
          ORIGIN,
          controlEncoderDescriptorBytes === undefined ? {} : { controlEncoderDescriptorBytes },
        );
  const manifestBytes =
    overlay === null
      ? Buffer.from(controlManifestBytes)
      : Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestSha256 = hash(manifestBytes);
  let buildInputs = structuredClone(controlBuildInputs);
  if (overlay) {
    const added: RuntimeAssetRow[] = [...overlay.files, ...(overlay.serial?.files ?? [])].map(
      ({ path, sha256, size }) => ({
        path,
        sha256,
        bytes: size,
        location: `${ORIGIN}/runtime/${path}`,
        acquire: ['ort-mirror'],
      }),
    );
    if (encoderDescriptor)
      added.push({
        path: encoderDescriptor.path,
        sha256: encoderDescriptor.asset.sha256,
        bytes: encoderDescriptor.asset.size,
        location: DERIVED,
        acquire: ['ort-mirror'],
      });
    for (const row of added) {
      if (paths.has(row.path)) fail(`candidate asset collides with frozen inventory: ${row.path}`);
      paths.add(row.path);
    }
    const replaced = new Set<string>();
    const remove = (asset: { url: unknown }) => {
      replaced.add(runtimePath(asset.url));
    };
    control.runtime.assets.forEach(remove);
    for (const field of ['module', 'factory', 'wasm']) remove(control.webgpu.runtime[field]);
    if (controlEncoderDescriptorBytes) {
      const encoder = JSON.parse(controlEncoderDescriptorBytes.toString('utf8'));
      for (const field of ['module', 'factory', 'wasm']) remove(encoder.runtime[field]);
    }
    buildInputs = {
      ...buildInputs,
      runtime: {
        ...buildInputs.runtime,
        manifest: {
          ...buildInputs.runtime.manifest,
          sha256: manifestSha256,
          bytes: manifestBytes.length,
          source: DERIVED,
        },
        assets: [
          ...buildInputs.runtime.assets.map((row) =>
            row.path === 'manifest.json'
              ? {
                  ...row,
                  sha256: manifestSha256,
                  bytes: manifestBytes.length,
                  location: DERIVED,
                  acquire: ['ort-mirror'],
                }
              : row,
          ),
          ...added,
        ],
      },
      worker_graphs: {
        ...buildInputs.worker_graphs,
        pinned: [
          ...buildInputs.worker_graphs.pinned.filter((row) => !replaced.has(row.path)),
          ...[...overlay.files, ...(overlay.serial?.files ?? [])].map(({ path, sha256 }) => ({
            path,
            sha256,
            location: `${ORIGIN}/runtime/${path}`,
          })),
        ],
      },
    };
  }
  return {
    controlBuildInputs,
    buildInputs,
    controlManifestBytes,
    manifest,
    manifestBytes,
    manifestSha256,
    modelSha256: pin.modelSourceSha256,
    hosted: buildInputs.worker_graphs.pinned.map(({ path, sha256 }) => ({ path, sha256 })),
    overlay,
    ...(controlEncoderDescriptorBytes === undefined ? {} : { controlEncoderDescriptorBytes }),
    ...(encoderDescriptor === undefined ? {} : { encoderDescriptor }),
  };
}
