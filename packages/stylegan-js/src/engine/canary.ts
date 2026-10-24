// Product canary qualification (fm-3h3w), ported from the candidate's browser/canary-qualification.mjs and
// the scheduling in ort-worker.mjs qualify()/startResumeDrain() (classic a42829b).
//
// A qualification is keyed by content: the runtime manifest digest, the provider, the bundle's asset
// digests and each canary's input, sample and reference digests (transport URLs and release labels do not
// change it; a tampered reference does, and then fails). It is recorded per device as checks land, so:
// - a cold device runs exactly one canary before its first face, and the rest behind foreground work;
// - a warm device with a compatible recorded receipt runs none;
// - `full` (CI, the device lab) runs every canary before any face, whatever is recorded.
// The comparison is the frozen product gate (numerics.ts PRODUCT_CANARY_TOLERANCE): max RGB difference
// 1 on 0-255 and max sampled raw-float error 0.002 against the independent reference. It never widens.

import { checkSynthesis } from '../contracts/numerics.ts';
import { sha256Hex } from '../contracts/sha256.ts';
import type { ComputeRoute } from '../contracts/capability.ts';
import { toRgba8 } from './identity.ts';
import { decodeReferencePng } from './reference-png.ts';
import { floats, readLocal, type EngineAsset, type LocalAssetReader } from './reader.ts';
import type { GpuEngine } from './routes.ts';

export const CANARY_RECORD_SCHEMA = 'checkface-canary-qualification-v1';

export type NoiseMode = 'original' | 'zero' | 'alternate';

export interface CanaryAsset {
  readonly name: string;
  readonly w: EngineAsset;
  readonly noise?: NoiseMode;
  readonly samples: EngineAsset;
  readonly reference: EngineAsset;
}

export interface CanaryManifest {
  readonly bundleVersion?: string;
  readonly sampleIndices: EngineAsset;
  readonly canaries: readonly CanaryAsset[];
}

/** The candidate's per-device record store (model-cache.mjs records): a failed read or write is never fatal. */
export interface CanaryRecords {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

export interface CanaryCheck {
  readonly name: string;
  readonly maxRgb: number;
  readonly maxFloat: number;
  readonly passed: boolean;
}

/** The record's provider name: the candidate worker's, so receipts already on devices stay valid. */
export const recordProvider = (route: ComputeRoute): 'wasm' | 'webgpu' =>
  route === 'cpu' ? 'wasm' : 'webgpu';

/** The bundle a route's canaries qualify: the synthesis graph, the direct engine's coefficients, or ORT's split. */
export function canaryBundle<B>(
  manifest: { readonly synthesis: B; readonly webgl?: B; readonly webgpu?: B },
  route: ComputeRoute,
  engine: GpuEngine,
): B | undefined {
  return route === 'cpu'
    ? manifest.synthesis
    : engine === 'direct'
      ? manifest.webgl
      : manifest.webgpu;
}

/** The asset digests a bundle carries, ignoring transport URLs and labels (canary-qualification.mjs). */
export function bundleDigest(bundle: unknown): string {
  const shas: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record['sha256'] === 'string') {
      shas.push(record['sha256']);
      return;
    }
    if (depth >= 4) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const key of Object.keys(record).sort()) walk(record[key], depth + 1);
  };
  walk(bundle, 0);
  return sha256Hex(new TextEncoder().encode(shas.join('\n')));
}

/** The record key (byte-identical to the candidate's, so a receipt it wrote is adopted). */
export function canaryKey(o: {
  manifest: CanaryManifest;
  manifestSha256: string;
  provider: string;
  bundle: unknown;
}): string {
  const identity = JSON.stringify({
    schema: CANARY_RECORD_SCHEMA,
    manifestSha256: o.manifestSha256,
    provider: o.provider,
    bundleVersion: o.manifest.bundleVersion ?? null,
    bundle: bundleDigest(o.bundle),
    sampleIndices: o.manifest.sampleIndices?.sha256 ?? null,
    canaries: o.manifest.canaries.map((c) => ({
      name: c.name,
      w: c.w?.sha256 ?? null,
      noise: c.noise ?? null,
      samples: c.samples?.sha256 ?? null,
      reference: c.reference?.sha256 ?? null,
    })),
  });
  return `canary-qualification:${sha256Hex(new TextEncoder().encode(identity))}`;
}

/**
 * One canary's comparison against the reference: the largest RGB difference over the converted output
 * (alpha excluded) and the largest error at the sampled raw-float indices, under the frozen gate.
 */
export function compareCanary(
  name: string,
  raw: Float32Array,
  indices: Uint32Array,
  samples: Float32Array,
  expectedRgba: Uint8ClampedArray,
): CanaryCheck {
  const actual = toRgba8(raw);
  if (expectedRgba.length !== actual.length) throw Error(`Canary reference size mismatch: ${name}`);
  if (indices.length !== samples.length) throw Error(`Canary sample count mismatch: ${name}`);
  let maxRgb = 0,
    maxFloat = 0;
  for (let i = 0; i < actual.length; i++)
    if (i % 4 !== 3)
      maxRgb = Math.max(maxRgb, Math.abs((actual[i] as number) - (expectedRgba[i] as number)));
  for (let i = 0; i < indices.length; i++) {
    const at = indices[i] as number;
    if (at >= raw.length) throw Error(`Canary sample index out of range: ${name}`);
    maxFloat = Math.max(maxFloat, Math.abs((raw[at] as number) - (samples[i] as number)));
  }
  return { name, maxRgb, maxFloat, passed: checkSynthesis(name, '', maxRgb, maxFloat).passed };
}

/** Recorded checks are adopted only when every one is a passing check of the same canary, in order. */
function validChecks(checks: unknown, canaries: readonly CanaryAsset[]): checks is CanaryCheck[] {
  return (
    Array.isArray(checks) &&
    checks.length <= canaries.length &&
    checks.every(
      (c: Partial<CanaryCheck> | null, i) =>
        Boolean(c) &&
        c!.passed === true &&
        c!.name === canaries[i]?.name &&
        Number.isFinite(c!.maxRgb) &&
        Number.isFinite(c!.maxFloat),
    )
  );
}

/** Raised when a canary misses the gate; it fails the route (ort-worker.mjs correctnessFailure). */
export class CanaryFailed extends Error {
  readonly check: CanaryCheck;
  readonly correctnessFailure = true;
  constructor(check: CanaryCheck) {
    super(`Device correctness check failed: ${check.name}`);
    this.name = 'CanaryFailed';
    this.check = check;
  }
}

export type CanaryPhase = 'admission' | 'background';
export interface CanaryEvent {
  readonly name: string;
  readonly index: number;
  readonly total: number;
  readonly phase: CanaryPhase;
}

/** What an admission ran: `cached` when a recorded receipt covered it, `partial` when canaries remain. */
export interface AdmissionReceipt {
  readonly checks: readonly CanaryCheck[];
  readonly ran: number;
  readonly cached: boolean;
  readonly partial: boolean;
  readonly full: boolean;
}

export interface CanaryQualification {
  readonly key: string;
  checks(): CanaryCheck[];
  complete(): boolean;
  /** Reads the recorded receipt once (ignored when `full`). */
  adopt(): Promise<CanaryCheck[]>;
  /** Runs the next canary; null once all have passed. Throws CanaryFailed on a miss. */
  runNext(phase: CanaryPhase, onEvent?: (event: CanaryEvent) => void): Promise<CanaryCheck | null>;
  /** The admission gate: all canaries when `full`, none when recorded, else exactly one. */
  admit(onEvent?: (event: CanaryEvent) => void): Promise<AdmissionReceipt>;
}

export function createCanaryQualification(o: {
  manifest: CanaryManifest;
  manifestSha256: string;
  route: ComputeRoute;
  bundle: unknown;
  records: CanaryRecords;
  reader: LocalAssetReader;
  synthesizeRaw: (values: Float32Array, noise: NoiseMode) => Promise<Float32Array>;
  full?: boolean;
  /** next-e2e's named route rejection: the comparison fails without touching the gates. Never set in production. */
  forceFail?: boolean;
  now?: () => string;
}): CanaryQualification {
  const { manifest, manifestSha256, records, reader } = o;
  if (!manifest || !Array.isArray(manifest.canaries) || manifest.canaries.length < 1)
    throw Error('Canary qualification requires a manifest with canaries');
  if (!/^[0-9a-f]{64}$/.test(manifestSha256))
    throw Error('Canary qualification requires the runtime manifest digest');
  const canaries = manifest.canaries;
  const provider = recordProvider(o.route);
  const full = o.full === true;
  const key = canaryKey({ manifest, manifestSha256, provider, bundle: o.bundle });
  const now = o.now ?? (() => new Date().toISOString());
  let checks: CanaryCheck[] = [];
  let adopted = false;

  async function adopt(): Promise<CanaryCheck[]> {
    if (adopted) return checks;
    adopted = true;
    if (full) return checks;
    try {
      const record = (await records.get(key)) as Record<string, unknown> | undefined | null;
      if (
        record?.['schema'] === CANARY_RECORD_SCHEMA &&
        record['manifestSha256'] === manifestSha256 &&
        record['provider'] === provider &&
        validChecks(record['checks'], canaries)
      )
        checks = record['checks'] as CanaryCheck[];
    } catch {
      /* a recorded qualification is an optimisation; a failed read just re-runs */
    }
    return checks;
  }

  async function runNext(
    phase: CanaryPhase,
    onEvent?: (event: CanaryEvent) => void,
  ): Promise<CanaryCheck | null> {
    await adopt();
    const index = checks.length;
    const c = canaries[index];
    if (!c) return null;
    onEvent?.({ name: c.name, index, total: canaries.length, phase });
    const raw = await o.synthesizeRaw(floats(await readLocal(reader, c.w)), c.noise ?? 'original');
    const indexBytes = await readLocal(reader, manifest.sampleIndices);
    const indices = new Uint32Array(indexBytes.slice().buffer);
    const samples = floats(await readLocal(reader, c.samples));
    const expected = (await decodeReferencePng(await readLocal(reader, c.reference))).rgba;
    const measured = compareCanary(c.name, raw, indices, samples, expected);
    const check = o.forceFail === true ? { ...measured, passed: false } : measured;
    if (!check.passed) throw new CanaryFailed(check);
    checks = [...checks, check];
    // Progress persists as it lands, so a session that ends mid-qualification resumes. A failed write is never fatal.
    try {
      await records.put(key, {
        schema: CANARY_RECORD_SCHEMA,
        manifestSha256,
        provider,
        bundleVersion: manifest.bundleVersion ?? null,
        checks,
        validatedAt: now(),
      });
    } catch {
      /* never fatal */
    }
    return check;
  }

  const complete = () => checks.length >= canaries.length;

  return {
    key,
    checks: () => checks.slice(),
    complete,
    adopt,
    runNext,
    async admit(onEvent) {
      await adopt();
      const before = checks.length;
      if (full) while (!complete()) await runNext('admission', onEvent);
      else if (!complete()) await runNext('admission', onEvent);
      const ran = checks.length - before;
      return {
        checks: checks.slice(),
        ran,
        cached: ran === 0 && before > 0,
        partial: !complete(),
        full,
      };
    },
  };
}
