// Bind shell admission and the hosted worker inventory to the same deterministic runtime composition.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeManifest, validateOverlay } from '../../../scripts/ci/ort-mirror.ts';
import { hostedWorkers, type HostedWorker } from './worker-inventory.ts';

const hash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
const ORIGIN = 'https://next.facemorph.me';
interface Inputs {
  runtime: { manifest: { sha256: string; bytes: number; modelSourceSha256: string } };
  worker_graphs: { pinned: HostedWorker[] };
}

/** No environment pin or fetched manifest can override the reviewed control and overlay. */
export function runtimeIdentity(repo: string): {
  runtimeSha256: string;
  modelSha256: string;
  hosted: HostedWorker[];
} {
  const inputs = JSON.parse(readFileSync(join(repo, 'import/build-inputs.json'), 'utf8')) as Inputs;
  const pin = inputs.runtime.manifest;
  const hosted = hostedWorkers(inputs);
  const overlayPath = join(repo, 'import/runtime-mirror.json');
  if (!existsSync(overlayPath))
    return { runtimeSha256: pin.sha256, modelSha256: pin.modelSourceSha256, hosted };
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('Invalid frozen runtime pin');
  const bytes = readFileSync(
    join(repo, 'import/runtime-manifests/control', pin.sha256, 'manifest.json'),
  );
  if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256)
    throw new Error('Frozen control runtime bytes differ from build-inputs pin');
  const control = JSON.parse(bytes.toString('utf8'));
  const overlay = validateOverlay(JSON.parse(readFileSync(overlayPath, 'utf8')));
  let encoderBytes: Buffer | undefined;
  if (overlay.schema === 'facemorph.ort-mirror/2') {
    const ref = control.encoderStream;
    const url = new URL(ref.url);
    if (
      url.origin !== ORIGIN ||
      url.search ||
      url.hash ||
      !/^\/runtime\/encoder-stream\/[a-f0-9]{64}\/manifest\.json$/.test(url.pathname)
    )
      throw new Error('Frozen encoder reference must name its canonical descriptor');
    encoderBytes = readFileSync(
      join(repo, 'import/runtime-manifests', url.pathname.slice('/runtime/'.length)),
    );
    if (encoderBytes.length !== ref.size || hash(encoderBytes) !== ref.sha256)
      throw new Error('Frozen encoder bytes differ from the trusted control pin');
  }
  const composed = composeManifest(
    control,
    overlay,
    ORIGIN,
    encoderBytes === undefined ? {} : { controlEncoderDescriptorBytes: encoderBytes },
  );
  // Remove replaced modules, retain all other hosted workers under their original pins.
  const replaced = new Set<string>();
  const remove = (asset: { url: string }): void => {
    replaced.add(new URL(asset.url).pathname.slice('/runtime/'.length));
  };
  control.runtime.assets.forEach(remove);
  for (const key of ['module', 'factory', 'wasm']) remove(control.webgpu.runtime[key]);
  if (encoderBytes) {
    const encoder = JSON.parse(encoderBytes.toString('utf8'));
    for (const key of ['module', 'factory', 'wasm']) remove(encoder.runtime[key]);
  }
  const files = [...overlay.files, ...(overlay.serial?.files ?? [])];
  return {
    runtimeSha256: hash(`${JSON.stringify(composed)}\n`),
    modelSha256: pin.modelSourceSha256,
    hosted: [
      ...hosted.filter((asset) => !replaced.has(asset.path)),
      ...files.map(({ path, sha256 }) => ({ path, sha256 })),
    ],
  };
}
