// Grant-policy requests from the pinned runtime manifest (fm-qrfz): what a face or a photo needs, by digest and size,
// with the manager's inventory of each asset. The asset lists are the candidate's own (model-inventory.mjs
// routeAssets and photoAssets), so the person is asked about exactly what the device would fetch:
// - a face: the route's synthesis bundle, runtime, mapping, average and noise (synthesis prerequisites);
// - a photo: those, the landmark detector and photo canaries (detector prerequisites), and the encoder. A streamed
//   encoder whose descriptor has not been read yet is asked for by the manifest's advertised encoder size, as the
//   candidate estimated it; once the verified descriptor names its shards, they come `via` that descriptor.
import type { AssetInventory, GrantOwnerId } from 'browser-model-manager';
import type { ComputeRoute } from 'stylegan-js';
import { collectAssets } from '../Next/browser/acquisition-budget.mjs';
import { routeAssets } from '../Next/model-inventory.mjs';
import { sha256Of, type NeededAsset, type Request, type Sha256 } from './grant-policy.ts';

/** A manifest asset descriptor: the shape model-inventory.mjs and the manager read. */
export interface ManifestAsset {
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
}
export type InventoryOf = (sha256: Sha256) => AssetInventory;

interface Common {
  readonly owner: GrantOwnerId;
  /** The parsed, pinned runtime manifest. */
  readonly manifest: Record<string, unknown>;
  readonly manifestSha256: string;
  readonly route: ComputeRoute;
  /** WebGPU on desktop runs the direct engine, which reads manifest.webgl (model-inventory.mjs). */
  readonly engine?: 'ort' | 'direct';
  readonly inventory: InventoryOf;
}

const digest = (a: ManifestAsset): Sha256 => {
  const sha256 = sha256Of(a.sha256);
  if (!sha256 || !Number.isSafeInteger(a.size) || a.size < 0)
    throw Error(`The runtime manifest names an asset without a valid digest and size (${a.url}).`);
  return sha256;
};

/** First occurrence wins, so an asset shared with the synthesis bundle keeps the synthesis priority. */
function needed(
  groups: readonly (readonly [readonly ManifestAsset[], NeededAsset['priority']])[],
  inventory: InventoryOf,
  via?: Sha256,
): NeededAsset[] {
  const out = new Map<Sha256, NeededAsset>();
  for (const [assets, priority] of groups)
    for (const a of assets) {
      const sha256 = digest(a);
      if (!out.has(sha256))
        out.set(sha256, {
          sha256,
          bytes: a.size,
          priority,
          inventory: inventory(sha256),
          ...(via ? { via } : {}),
        });
    }
  return [...out.values()];
}

const synthesis = (input: Common): readonly ManifestAsset[] =>
  routeAssets(input.manifest, input.route, input.engine ?? 'ort') as ManifestAsset[];

export function faceRequest(input: Common): Request {
  return {
    owner: input.owner,
    purpose: 'generate',
    manifestSha256: input.manifestSha256,
    route: input.route,
    assets: needed([[synthesis(input), 'synthesis-prerequisite']], input.inventory),
  };
}

export function photoRequest(
  input: Common & {
    /** The shards the verified encoder-stream descriptor names; null while it has not been read. */
    readonly descriptorShards: readonly ManifestAsset[] | null;
  },
): Request {
  const m = input.manifest;
  const detector = collectAssets([
    m['landmarks'],
    m['photoCanary'],
    m['photoCanaries'],
  ]) as ManifestAsset[];
  const stream = m['encoderStream'] as ManifestAsset | undefined;
  const base = needed(
    [
      [synthesis(input), 'synthesis-prerequisite'],
      [detector, 'detector-prerequisite'],
      [stream ? [stream] : (collectAssets(m['encoder']) as ManifestAsset[]), 'foreground-required'],
    ],
    input.inventory,
  );
  const request = {
    owner: input.owner,
    purpose: 'generate-and-encode' as const,
    manifestSha256: input.manifestSha256,
    route: input.route,
  };
  if (!stream) return { ...request, assets: base };
  const via = digest(stream);
  if (input.descriptorShards === null) {
    const advertised = (m['encoder'] as ManifestAsset | undefined)?.size;
    if (!Number.isSafeInteger(advertised))
      throw Error('The runtime manifest advertises no encoder size for its streamed encoder.');
    return {
      ...request,
      assets: base,
      discovers: { via, bytes: advertised!, priority: 'foreground-required' },
    };
  }
  const shards = needed(
    [[input.descriptorShards, 'foreground-required']],
    input.inventory,
    via,
  ).filter((s) => !base.some((b) => b.sha256 === s.sha256));
  return { ...request, assets: [...base, ...shards] };
}
