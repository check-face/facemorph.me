// The non-face example (fm-tohj): AFHQ cat 512 through stylegan-js on the CPU. Shared by both variants:
// the manager-loaded one (manager-loaded.ts) and the caller-loaded one (caller-loaded.ts) differ only in how verified
// bytes reach the engine, which is the `prepare` step each hands to `createNonFaceExample`.
//
// What it does: read the converted model's manifest and the CPU runtime's, load the generator with the AFHQ
// descriptor, map three seeds, synthesize them, render a short morph through all three with renderMorph (frames
// collected in memory by a small writer, no video encoder), export the first face as PNG and as lossless WebP with
// recovery metadata, reopen both with readRecovery and decode them in the page, check that a latent of the same shape
// from another checkpoint is refused for combination, and report every check as JSON.
//
// A non-face model never loads a face detector or the e4e encoder: nothing here names one, and the descriptor
// (subject 'non-face') cannot carry a photo encoder. The descriptor's providers state AFHQ cat's qualification and
// status() reports it.
import {
  AFHQ_CAT_512_DESCRIPTOR,
  canonicalJson,
  checkCombinable,
  createLatentPath,
  encodeLosslessWebp,
  encodePng,
  FFHQ_1024_DESCRIPTOR,
  infillFrames,
  latentDigest,
  modelRecord,
  readRecovery,
  renderMorph,
  type LatentTensor,
  type MorphFrameSource,
  type MorphImage,
  type MorphPathSpec,
  type MorphWriter,
  type RecoveryMetadataV3,
  type RgbaPixels,
} from 'stylegan-js';
import {
  browserModuleHost,
  cpuRuntimeAssets,
  cpuThreads,
  inputLatent,
  loadCpuGenerator,
  loadOrtRuntime,
  type EngineAsset,
  type Generator,
  type GeneratorManifest,
  type LoadedRuntime,
  type LocalAssetReader,
  type NoiseAsset,
} from 'stylegan-js/engine';

export const DESCRIPTOR = AFHQ_CAT_512_DESCRIPTOR;

export type Variant = 'manager-loaded' | 'caller-loaded';

/** An asset with the URL the example fetches it from. */
export type LocatedAsset = EngineAsset & {
  readonly url: string;
  readonly chunks?: readonly {
    readonly sha256: string;
    readonly size: number;
    readonly url: string;
  }[];
};

/** The converted model's manifest (model-conv), every file located under the model base. */
export interface ModelManifest extends GeneratorManifest {
  readonly mapping: LocatedAsset;
  readonly synthesis: LocatedAsset;
  readonly average: LocatedAsset;
  readonly noise: readonly (NoiseAsset & LocatedAsset)[];
}

/** The CPU runtime (onnxruntime-web's WASM build) as the runtime manifest names it, located under the runtime base. */
export interface CpuRuntime {
  readonly moduleUrl: string;
  readonly assets: readonly LocatedAsset[];
}

export interface Manifests {
  readonly model: ModelManifest;
  readonly modelSha256: string;
  readonly runtime: CpuRuntime;
}

export interface ExampleOptions {
  /** Base URL of the converted model directory (manifest.json and the files it names). */
  readonly modelBase: string;
  /** Base URL of the runtime directory (manifest.json and its assets/ tree); only `runtime` is read from it. */
  readonly runtimeBase: string;
  /** The seeds, at least two (default 0, 1 and 2); the morph passes through every one in order. */
  readonly seeds?: readonly number[];
  /** Morph frames per segment (default 4: nine frames through three seeds, both ends included). */
  readonly framesPerSegment?: number;
  readonly onLog?: (line: Record<string, unknown>) => void;
}

/** How a variant gets verified bytes: given the manifests, a reader the engine reads through (and nothing else). */
export type Prepare = (
  manifests: Manifests,
  signal: AbortSignal | undefined,
) => Promise<LocalAssetReader>;

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async (b: Uint8Array | Uint8ClampedArray): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', copy(b)));
/** The bytes in a fresh, exactly sized ArrayBuffer (what Blob and digest accept). */
const copy = (b: Uint8Array | Uint8ClampedArray): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(b.length);
  out.set(b);
  return out;
};

const base = (u: string) => (u.endsWith('/') ? u : `${u}/`);

/** The published runtime names its assets under https://…/runtime/; serve that tree at `runtimeBase`. */
export function locateRuntime(url: string, runtimeBase: string): string {
  const path = new URL(url).pathname;
  const at = path.indexOf('/runtime/');
  return new URL(at >= 0 ? path.slice(at + '/runtime/'.length) : path.slice(1), base(runtimeBase))
    .href;
}

async function fetchBytes(url: string, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

type Raw = { readonly file: string; readonly chunks?: readonly { readonly file: string }[] };

/** Both manifests, with every asset given the URL it is served at. The manifests are plain caller fetches. */
export async function fetchManifests(
  o: Pick<ExampleOptions, 'modelBase' | 'runtimeBase'>,
  signal?: AbortSignal,
): Promise<Manifests & { readonly manifestBytes: number }> {
  const modelUrl = new URL('manifest.json', base(o.modelBase)).href;
  const modelBytes = await fetchBytes(modelUrl, signal);
  const raw = JSON.parse(new TextDecoder().decode(modelBytes)) as Record<string, unknown> & {
    mapping: EngineAsset & Raw;
    synthesis: EngineAsset & Raw;
    average: EngineAsset & Raw;
    noise: (NoiseAsset & Raw)[];
    modelSourceSha256: string;
    noiseSha256: string;
  };
  const at = (file: string) => new URL(file, base(o.modelBase)).href;
  const locate = <T extends EngineAsset & Raw>(a: T): T & LocatedAsset => ({
    ...a,
    url: at(a.file),
    ...(a.chunks
      ? {
          chunks: (a.chunks as readonly (EngineAsset & Raw)[]).map((c) => ({
            sha256: c.sha256,
            size: c.size,
            url: at(c.file),
          })),
        }
      : {}),
  });
  const model: ModelManifest = {
    ...raw,
    mapping: locate(raw.mapping),
    synthesis: locate(raw.synthesis),
    average: locate(raw.average),
    noise: raw.noise.map(locate),
  };
  const { modelSha256, noiseSha256 } = DESCRIPTOR.identity;
  if (model.modelSourceSha256 !== modelSha256 || model.noiseSha256 !== noiseSha256)
    throw new Error('The model manifest is not the AFHQ cat 512 checkpoint the descriptor names.');

  const runtimeBytes = await fetchBytes(new URL('manifest.json', base(o.runtimeBase)).href, signal);
  const product = JSON.parse(new TextDecoder().decode(runtimeBytes)) as {
    runtime: { moduleUrl: string; assets: (EngineAsset & { url: string })[] };
  };
  // Only the CPU runtime is used; the product manifest's face assets are never read.
  const runtime: CpuRuntime = {
    moduleUrl: locateRuntime(product.runtime.moduleUrl, o.runtimeBase),
    assets: product.runtime.assets.map((a) => ({
      sha256: a.sha256,
      size: a.size,
      url: locateRuntime(a.url, o.runtimeBase),
    })),
  };
  return {
    model,
    modelSha256: await sha256(modelBytes),
    runtime,
    manifestBytes: modelBytes.length + runtimeBytes.length,
  };
}

/** Every asset the example reads: the CPU runtime and the converted model. */
export function assetsOf(m: Manifests): LocatedAsset[] {
  const all = [
    ...m.runtime.assets,
    m.model.mapping,
    m.model.synthesis,
    m.model.average,
    ...m.model.noise,
  ];
  return [...new Map(all.map((a) => [a.sha256, a])).values()];
}

export interface FaceReport {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly latentSha256: string;
  readonly mapMs: number;
  readonly synthesizeMs: number;
}

export interface FrameReport {
  readonly index: number;
  readonly visitId: string | null;
  readonly sha256: string;
}

export interface MorphReport {
  readonly status: string;
  readonly branch: string | null;
  readonly totalFrames: number;
  readonly written: number;
  readonly frames: readonly FrameReport[];
  /** Each seed's frame (the first frame of its segment, and the last frame) against that face: latent and pixels. */
  readonly endpoints: readonly {
    readonly index: number;
    readonly seed: number;
    readonly latentExact: boolean;
    readonly maxRgb: number;
  }[];
  readonly ms: number;
}

export interface ExportReport {
  readonly mime: 'image/png' | 'image/webp';
  readonly bytes: number;
  readonly kind: string;
  readonly schemaVersion: number | null;
  readonly seed: number | null;
  readonly latentExact: boolean;
  readonly modelExact: boolean;
  readonly provenanceExact: boolean;
  readonly pixelsExact: boolean;
  readonly maxRgb: number;
  readonly ms: number;
}

/** Combination checks: the run's own faces combine; an equal-shaped latent from another checkpoint does not. */
export interface CombineReport {
  readonly sameModel: { readonly ok: boolean; readonly inputs: number };
  readonly otherCheckpoint: {
    readonly ok: boolean;
    readonly code: string | null;
    readonly index: number | null;
  };
}

export interface RunReport {
  readonly ok: boolean;
  readonly variant: Variant;
  readonly provider: string;
  readonly threads: number;
  readonly faces: readonly FaceReport[];
  readonly morph: MorphReport;
  readonly exports: readonly ExportReport[];
  readonly combine: CombineReport;
  readonly reads: number;
  readonly ms: number;
}

export interface LoadReport {
  readonly ok: true;
  readonly variant: Variant;
  readonly modelSha256: string;
  readonly provider: string;
  readonly threads: number;
  readonly prepareMs: number;
  readonly loadMs: number;
  readonly assets: number;
}

export type Failure = {
  readonly ok: false;
  readonly error: { readonly name: string; readonly message: string };
};

const failure = (error: unknown): Failure => ({
  ok: false,
  error: {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  },
});

/** One collected morph frame: the writer keeps raw RGBA in memory. */
type FrameImage = MorphImage & { readonly rgba: Uint8ClampedArray };
const frameImage = (rgba: Uint8ClampedArray): FrameImage => ({
  size: rgba.byteLength,
  type: 'image/x-rgba',
  rgba,
});
const isFrameImage = (m: MorphImage): m is FrameImage =>
  (m as Partial<FrameImage>).rgba instanceof Uint8ClampedArray;

const maxRgbDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let m = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};
const sameFloats = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  return x.every((v, i) => v === y[i]);
};

/** Decodes a PNG or WebP with the browser's own decoder, exactly (no colour conversion, no premultiplication). */
export async function decodeImage(
  bytes: Uint8Array,
  type: string,
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(new Blob([copy(bytes)], { type }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context for decoding.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
}

/** The example: construct (no I/O), status (no I/O), load, run, dispose. */
export function createNonFaceExample(variant: Variant, options: ExampleOptions, prepare: Prepare) {
  const seeds = options.seeds ?? [0, 1, 2];
  if (seeds.length < 2) throw new Error('A morph needs at least two seeds.');
  const log = (line: Record<string, unknown>) => options.onLog?.({ variant, ...line });
  const reads: string[] = [];
  let generator: Generator | null = null;
  let runtime: LoadedRuntime | null = null;
  let manifests: Manifests | null = null;
  let faces: { w: LatentTensor; raw: Float32Array; rgba: Uint8ClampedArray }[] = [];
  let revision = 0;
  const ids = (name: string) => ({
    requestId: `${name}-${++revision}`,
    inputRevision: revision,
    attemptId: 0,
  });
  const threads = () =>
    cpuThreads({
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      hardwareConcurrency: navigator.hardwareConcurrency,
    });

  /** Pure reads: no request, no storage, no worker. */
  function status() {
    return {
      variant,
      loaded: generator !== null,
      model: DESCRIPTOR.identity.name,
      subject: DESCRIPTOR.subject,
      photoEncoder: 'photoEncoder' in DESCRIPTOR,
      qualification: DESCRIPTOR.providers.map((p) => ({
        provider: p.provider,
        status: p.qualification.status,
      })),
      latent: DESCRIPTOR.latent,
      threads: threads(),
      reads: reads.length,
    };
  }

  async function load(o: { signal?: AbortSignal } = {}): Promise<LoadReport | Failure> {
    const started = performance.now();
    try {
      const m = await fetchManifests(options, o.signal);
      manifests = m;
      const verified = await prepare(m, o.signal);
      const prepareMs = performance.now() - started;
      const reader: LocalAssetReader = {
        allowRepair: false,
        read: (asset) => (reads.push(asset.sha256), verified.read(asset)),
      };
      const n = threads();
      const host = browserModuleHost();
      const loadStarted = performance.now();
      generator = await loadCpuGenerator({
        reader,
        manifest: m.model,
        manifestSha256: m.modelSha256,
        descriptor: DESCRIPTOR,
        ort: async () =>
          (runtime ??= await loadOrtRuntime(reader, cpuRuntimeAssets(m.runtime), host, n)).ort,
      });
      await generator.mappingReady();
      const report: LoadReport = {
        ok: true,
        variant,
        modelSha256: m.modelSha256,
        provider: generator.provider.actual,
        threads: n,
        prepareMs,
        loadMs: performance.now() - loadStarted,
        assets: assetsOf(m).length,
      };
      log({ event: 'load', ...report });
      return report;
    } catch (error) {
      await dispose();
      log({ event: 'load-failed', ...failure(error) });
      return failure(error);
    }
  }

  async function run(): Promise<RunReport | Failure> {
    const g = generator;
    if (!g || !manifests) return failure(new Error('Load first.'));
    const started = performance.now();
    try {
      // One face per seed: map with the descriptor's truncation, synthesize with raw float output.
      faces = [];
      const faceReports: FaceReport[] = [];
      for (const seed of seeds) {
        const t0 = performance.now();
        const mapped = await g.map({
          ids: ids('map'),
          z: inputLatent('seed', String(seed), g.latent).z,
          truncation: DESCRIPTOR.truncation,
        });
        const t1 = performance.now();
        const face = await g.synthesize({
          ids: ids('synthesize'),
          wPlus: mapped.wPlus,
          output: 'rgba-and-raw-float',
        });
        const t2 = performance.now();
        if (!face.rawFloat) throw new Error('No raw output.');
        faces.push({ w: mapped.wPlus, raw: face.rawFloat, rgba: face.rgba });
        faceReports.push({
          seed,
          width: face.width,
          height: face.height,
          sha256: await sha256(face.rgba),
          latentSha256: latentDigest(mapped.wPlus),
          mapMs: t1 - t0,
          synthesizeMs: t2 - t1,
        });
      }
      const a = faces[0]!;

      const morph = await renderShortMorph(
        g,
        faces.map((f) => f.w),
      );
      // Every frame that is a seed's own (visitId seed-<n>) must be that face exactly.
      const endpoints = morph.order
        .filter((f) => f.visitId !== null)
        .map((f) => {
          const at = seeds.findIndex((s) => f.visitId === `seed-${s}`);
          return { index: f.index, seed: seeds[at]!, face: faces[at]! };
        })
        .map(({ index, seed, face }) => {
          const frame = morph.images.get(index);
          return {
            index,
            seed,
            latentExact: sameFloats(morph.latents.get(index) ?? new Float32Array(0), face.w.values),
            maxRgb: frame ? maxRgbDiff(frame, face.rgba) : Number.POSITIVE_INFINITY,
          };
        });
      const frames: FrameReport[] = [];
      for (const f of morph.order)
        frames.push({
          index: f.index,
          visitId: f.visitId,
          sha256: await sha256(morph.images.get(f.index) ?? new Uint8Array(0)),
        });

      // Save face A as PNG and lossless WebP with schema-3 recovery metadata; reopen and decode both.
      const [, , height, width] = DESCRIPTOR.output.shape as [number, number, number, number];
      const pixels: RgbaPixels = { width, height, rgba: a.rgba };
      const recovery: RecoveryMetadataV3 = {
        descriptor: DESCRIPTOR,
        generationKind: 'seed',
        generationSha256: latentDigest(a.w),
        provenance: {
          modelSha256: DESCRIPTOR.identity.modelSha256,
          noiseSha256: DESCRIPTOR.identity.noiseSha256,
          manifestSha256: manifests.modelSha256,
          route: 'cpu',
          truncationPsi: DESCRIPTOR.truncation.psi,
          truncationCutoff: DESCRIPTOR.truncation.cutoff,
        },
        latent: a.w,
        seed: seeds[0]!,
      };
      const exports: ExportReport[] = [];
      for (const mime of ['image/png', 'image/webp'] as const) {
        const t0 = performance.now();
        const bytes =
          mime === 'image/png'
            ? await encodePng(pixels, recovery)
            : encodeLosslessWebp(pixels, recovery);
        exports.push(await reopen(mime, bytes, recovery, a.rgba, performance.now() - t0));
      }

      // The run's faces combine with each other; the same latent shape from another checkpoint is refused.
      const { modelSha256, noiseSha256 } = DESCRIPTOR.identity;
      const own = faces.map((f) => ({ modelSha256, noiseSha256, latent: f.w }));
      const same = checkCombinable(DESCRIPTOR, own);
      const foreign = checkCombinable(DESCRIPTOR, [
        own[0]!,
        {
          modelSha256: FFHQ_1024_DESCRIPTOR.identity.modelSha256,
          noiseSha256: FFHQ_1024_DESCRIPTOR.identity.noiseSha256,
          latent: faces[1]!.w,
        },
      ]);
      const combine: CombineReport = {
        sameModel: { ok: same.ok, inputs: own.length },
        otherCheckpoint: foreign.ok
          ? { ok: true, code: null, index: null }
          : {
              ok: false,
              code: foreign.error.code,
              index: foreign.error.index ?? null,
            },
      };

      const ok =
        endpoints.length === seeds.length &&
        endpoints.every((e) => e.latentExact && e.maxRgb === 0) &&
        combine.sameModel.ok &&
        !combine.otherCheckpoint.ok &&
        combine.otherCheckpoint.code === 'mixed-model' &&
        morph.status === 'complete' &&
        morph.written === morph.totalFrames &&
        exports.every(
          (e) =>
            e.kind === 'parsed' &&
            e.schemaVersion === 3 &&
            e.latentExact &&
            e.modelExact &&
            e.provenanceExact &&
            e.pixelsExact,
        );
      const report: RunReport = {
        ok,
        variant,
        provider: g.provider.actual,
        threads: threads(),
        faces: faceReports,
        morph: {
          status: morph.status,
          branch: morph.branch,
          totalFrames: morph.totalFrames,
          written: morph.written,
          frames,
          endpoints,
          ms: morph.ms,
        },
        exports,
        combine,
        reads: reads.length,
        ms: performance.now() - started,
      };
      log({ event: 'run', ...report });
      return report;
    } catch (error) {
      log({ event: 'run-failed', ...failure(error) });
      return failure(error);
    }
  }

  /** An open pairwise ellipse through every face, via renderMorph; frames land in memory in presentation order. */
  async function renderShortMorph(g: Generator, latents: readonly LatentTensor[]) {
    const { layers, width } = DESCRIPTOR.latent;
    const spec: MorphPathSpec = {
      algorithmVersion: 'latent-path-v1',
      kind: 'pairwise-ellipse',
      closed: false,
      pinchCenter: false,
      width: 0.7,
      framesPerSegment: options.framesPerSegment ?? 4,
      framesPerSecond: 8,
      controls: latents.map((latent, i) => ({ visitId: `seed-${seeds[i]}`, latent })),
    };
    const path = createLatentPath(spec, DESCRIPTOR);
    const order = [...path.frames()];
    const frameLatents = new Map(order.map((f) => [f.index, Float32Array.from(f.values)]));
    const images = new Map<number, Uint8ClampedArray>();
    const source: MorphFrameSource = {
      async synthesize(latent) {
        const r = await g.synthesize({
          ids: ids('frame'),
          wPlus: { space: 'w-plus', shape: [layers, width], values: latent.values },
          output: 'rgba',
        });
        return { blob: frameImage(r.rgba) };
      },
      async synthesizeFrames(list, o) {
        await g.synthesizeSequence(
          list.map((l) => l.values),
          async (at, rgba) => {
            await o.onFrame(at, { blob: frameImage(rgba.slice()) });
          },
          o.signal,
        );
      },
    };
    let written = 0;
    const writer: MorphWriter = {
      async add(image, index) {
        if (!isFrameImage(image)) throw new Error(`Frame ${index} is not raw RGBA.`);
        images.set(index, image.rgba);
        written++;
      },
      async finish() {
        return { size: written, type: 'application/x-frames' };
      },
      dispose() {},
    };
    const t0 = performance.now();
    const settled = await renderMorph({
      path,
      canonical: () => infillFrames(path, spec),
      descriptor: DESCRIPTOR,
      source,
      writer,
    });
    return {
      status: settled.status,
      branch: settled.branch,
      totalFrames: path.totalFrames,
      written,
      order,
      latents: frameLatents,
      images,
      ms: performance.now() - t0,
    };
  }

  async function reopen(
    mime: 'image/png' | 'image/webp',
    bytes: Uint8Array,
    recovery: RecoveryMetadataV3,
    rgba: Uint8ClampedArray,
    ms: number,
  ): Promise<ExportReport> {
    const read = readRecovery(bytes);
    const decoded = await decodeImage(bytes, mime);
    const maxRgb = maxRgbDiff(decoded.rgba, rgba);
    const pixelsExact =
      decoded.rgba.length === rgba.length && decoded.rgba.every((v, i) => v === rgba[i]);
    if (read.kind !== 'parsed')
      return {
        mime,
        bytes: bytes.length,
        kind: read.kind,
        schemaVersion: null,
        seed: null,
        latentExact: false,
        modelExact: false,
        provenanceExact: false,
        pixelsExact,
        maxRgb,
        ms,
      };
    const r = read.recovered;
    return {
      mime,
      bytes: bytes.length,
      kind: read.kind,
      schemaVersion: r.schemaVersion,
      seed: r.seed ?? null,
      latentExact:
        r.latent.space === 'w-plus' &&
        r.latent.shape[0] === recovery.latent.shape[0] &&
        r.latent.shape[1] === recovery.latent.shape[1] &&
        sameFloats(r.latent.values, Float32Array.from(recovery.latent.values)),
      modelExact:
        r.model !== undefined && canonicalJson(r.model) === canonicalJson(modelRecord(DESCRIPTOR)),
      provenanceExact:
        r.provenance.modelSha256 === recovery.provenance.modelSha256 &&
        r.provenance.noiseSha256 === recovery.provenance.noiseSha256 &&
        r.provenance['manifestSha256'] === recovery.provenance['manifestSha256'],
      pixelsExact,
      maxRgb,
      ms,
    };
  }

  /** Releases the generator's sessions and the runtime's module URLs. */
  async function dispose() {
    const g = generator;
    generator = null;
    await g?.dispose();
    runtime?.release();
    runtime = null;
    return g?.inspect() ?? null;
  }

  return {
    variant,
    status,
    load,
    run,
    dispose,
    /** Every asset digest the engine read (through the variant's reader). */
    reads: () => reads.slice(),
    /** Each face's W+ and raw float output, for numerical checks against a reference. */
    tensors: () => faces.map((f) => ({ w: f.w.values, raw: f.raw })),
    /** Each face's RGBA, for drawing. */
    images: () => faces.map((f) => ({ width: 512, height: 512, rgba: f.rgba })),
  };
}

export type NonFaceExample = ReturnType<typeof createNonFaceExample>;
