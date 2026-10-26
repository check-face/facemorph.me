// The direct WebGPU engine (fm-3h3w): the network as WGSL compute passes, no ONNX Runtime, ported from the
// candidate's browser/webgpu-direct.mjs createDirectWebGpuSession() (classic a42829b). It runs the pure-WebGL
// block stream's schedule on its exact FP32 coefficients (manifest.webgl, the bytes the retired WebGL route
// qualified) over NHWC buffers. On eris (RTX 2080 SUPER) 36 ms of GPU per face against about 62 ms on the ORT
// engine, all seven product canaries at RGB max 1.
//
// Desktop only: routes.ts gpuEngine() never offers it to a mobile device, and it re-checks the adapter
// against DIRECT_LIMITS before requesting a device. Its output contract is the ORT engine's (NCHW float
// [3, height, width]); it also converts to RGBA8 on the GPU, so a face crosses the bus as 4 MB instead of 12 MB.

import type { RequestedRoute } from '../../contracts/capability.ts';
import type { ModelDescriptor } from '../../contracts/descriptor.ts';
import { floats, readLocal, type EngineAsset, type LocalAssetReader } from '../reader.ts';
import { BufferUsage, MapMode } from './gpu-constants.ts';
import { DIRECT_LIMITS, directSupported } from '../routes.ts';
import {
  AFFINE,
  DEMOD,
  FIR,
  outShader,
  RGB,
  rgba8Shader,
  TAPS3,
  TILES,
  gemmShader,
  parityTaps,
  repack,
} from './direct-shaders.ts';
import {
  assembleGenerator,
  describedGeometry,
  type Generator,
  type GeneratorManifest,
  type NoiseSet,
  type SynthesisBackend,
} from './generator.ts';
import type { OrtModule } from './ort.ts';
import { GpuUnsupported } from './ort-webgpu.ts';

/** manifest.webgl: the block-stream coefficients, addressed by file name. */
export interface DirectBundle {
  readonly assets: readonly (EngineAsset & { readonly url: string })[];
}

interface BlockPlan {
  readonly wIndex: number;
  readonly styleMultiplier: number;
  readonly demodulation: { readonly epsilon: number; readonly numerator: number };
}
interface Block {
  readonly size: number;
  readonly inSize: number;
  readonly inChannels: number;
  readonly outChannels: number;
  readonly hasConv0: boolean;
  readonly hasSkip: boolean;
  readonly constants: Record<string, number>;
  readonly coefficients: {
    readonly file: string;
    readonly arrays: Record<string, { offset: number; bytes: number }>;
  };
  readonly stylePlans: {
    readonly conv0: BlockPlan;
    readonly conv1: BlockPlan;
    readonly torgb: BlockPlan;
  };
  readonly noise: {
    readonly conv0: { readonly name: string };
    readonly conv1: { readonly name: string };
  };
}
interface StreamManifest {
  readonly sourceSha256?: string;
  readonly learnedInput: { readonly file: string };
  readonly blocks: readonly Block[];
}

export async function loadDirectWebGpuGenerator(o: {
  readonly reader: LocalAssetReader;
  readonly manifest: GeneratorManifest & { readonly webgl: DirectBundle };
  readonly manifestSha256: string;
  readonly gpu: GPU;
  readonly cpuOrt: () => Promise<OrtModule>;
  readonly requested?: RequestedRoute;
  /** The model the manifest holds (default FFHQ config-F, the only one the block stream exists for). */
  readonly descriptor?: ModelDescriptor;
  readonly now?: () => number;
  readonly release?: () => void;
  readonly progress?: (stage: 'gpu-direct-ready') => void;
}): Promise<Generator> {
  const { reader, manifest } = o;
  // A descriptor this engine cannot run is rejected before the adapter is even probed.
  const described = describedGeometry('direct-webgpu', manifest, o.descriptor);
  const PIXELS = described.geometry.width * described.geometry.height;
  const adapter = await o.gpu.requestAdapter();
  if (!adapter) throw new GpuUnsupported('WebGPU is unavailable.');
  const limits = adapter.limits as unknown as Record<string, number>;
  if (!directSupported(limits))
    throw new GpuUnsupported('This GPU does not meet the direct engine limits.');
  return assembleGenerator({
    ...described,
    reader,
    manifest,
    manifestSha256: o.manifestSha256,
    requested: o.requested ?? 'webgpu',
    mapping: { ort: o.cpuOrt },
    warmMapping: true,
    extraAssets: manifest.webgl.assets,
    unsupported: [],
    ...(o.now ? { now: o.now } : {}),
    ...(o.release ? { release: o.release } : {}),
    backend: async (_noise, _trace, reader): Promise<SynthesisBackend> => {
      const device = await adapter.requestDevice({
        requiredLimits: Object.fromEntries(
          Object.keys(DIRECT_LIMITS).map((k) => [k, limits[k] as number]),
        ),
      });
      let failure: Error | null = null;
      let closing = false;
      const lost: ((message: string) => void)[] = [];
      void device.lost.then((info) => {
        if (closing || failure) return;
        failure = Error('GPU device lost: ' + info.reason);
        for (const l of lost) l(failure.message);
      });
      device.addEventListener('uncapturederror', (e) => {
        failure ??= Error('GPU validation: ' + (e as GPUUncapturedErrorEvent).error.message);
      });
      const all: GPUBuffer[] = [];
      const pools: Record<'raw' | 'rgba', GPUBuffer[]> = { raw: [], rgba: [] };
      const dispose = async () => {
        if (closing) return;
        closing = true;
        for (const b of all) b.destroy();
        for (const b of [...pools.raw, ...pools.rgba]) b.destroy();
        all.length = 0;
        device.destroy();
      };
      try {
        const byName = new Map(
          manifest.webgl.assets.map((a) => [a.url.slice(a.url.lastIndexOf('/') + 1), a]),
        );
        const asset = (file: string) => {
          const a = byName.get(file);
          if (!a) throw Error('Direct engine asset missing: ' + file);
          return a;
        };
        const stream = JSON.parse(
          new TextDecoder().decode(await readLocal(reader, asset('manifest.json'))),
        ) as StreamManifest;
        const S = BufferUsage.STORAGE,
          CD = BufferUsage.COPY_DST,
          CS = BufferUsage.COPY_SRC,
          U = BufferUsage.UNIFORM;
        const buffer = (size: number, usage = S | CD) => {
          const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage });
          all.push(b);
          return b;
        };
        const upload = (data: ArrayBufferView, usage = S | CD) => {
          const b = buffer(data.byteLength, usage);
          device.queue.writeBuffer(b, 0, data as ArrayBufferView<ArrayBuffer>);
          return b;
        };
        const uniform = (u32s: readonly number[], f32s: readonly number[] = []) => {
          const a = new ArrayBuffer(Math.ceil(((u32s.length + f32s.length) * 4) / 16) * 16);
          const v = new DataView(a);
          let off = 0;
          for (const x of u32s) {
            v.setUint32(off, x, true);
            off += 4;
          }
          for (const x of f32s) {
            v.setFloat32(off, x, true);
            off += 4;
          }
          return upload(new Uint8Array(a), U | CD);
        };
        const pipes = new Map<string, GPUComputePipeline>();
        const pipeline = (code: string) => {
          let p = pipes.get(code);
          if (!p) {
            p = device.createComputePipeline({
              layout: 'auto',
              compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
            });
            pipes.set(code, p);
          }
          return p;
        };
        const steps: {
          pipe: GPUComputePipeline;
          wg: [number, number, number?];
          group: GPUBindGroup;
        }[] = [];
        const step = (code: string, list: readonly GPUBuffer[], wg: [number, number, number?]) => {
          const pipe = pipeline(code);
          steps.push({
            pipe,
            wg,
            group: device.createBindGroup({
              layout: pipe.getBindGroupLayout(0),
              entries: list.map((b, i) => ({ binding: i, resource: { buffer: b } })),
            }),
          });
        };
        const grid = (n: number): [number, number] => {
          const g = Math.ceil(n / 64);
          return [Math.min(g, 65535), Math.ceil(g / 65535)];
        };
        const latent = buffer(
            described.geometry.latent.layers * described.geometry.latent.width * 4,
          ),
          noiseBuf: Record<string, GPUBuffer> = {},
          dummy = buffer(16);
        for (const n of manifest.noise)
          noiseBuf[n.name] = buffer(n.shape.reduce((a, b) => a * b, 1) * 4);
        const lf = floats(await readLocal(reader, asset(stream.learnedInput.file)));
        const nhwc = new Float32Array(16 * 512);
        for (let c = 0; c < 512; c++)
          for (let i = 0; i < 16; i++) nhwc[i * 512 + c] = lf[c * 16 + i] as number;
        let features = upload(nhwc),
          skip: GPUBuffer | null = null;
        for (const block of stream.blocks) {
          const raw = await readLocal(reader, asset(block.coefficients.file));
          const arr = Object.fromEntries(
            Object.entries(block.coefficients.arrays).map(([k, r]) => [
              k,
              floats(raw.subarray(r.offset, r.offset + r.bytes)),
            ]),
          ) as Record<string, Float32Array>;
          const get = (k: string) => {
            const a = arr[k];
            if (!a) throw Error(`Direct engine coefficient missing: ${k}`);
            return a;
          };
          const k = block.constants,
            size = block.size,
            inC = block.inChannels,
            outC = block.outChannels;
          const styleOf = (suffix: string, C: number, plan: BlockPlan) => {
            const s = buffer(C * 4);
            step(
              AFFINE,
              [
                latent,
                upload(get('affineWeight' + suffix)),
                upload(get('affineBias' + suffix)),
                s,
                uniform([C, plan.wIndex], [plan.styleMultiplier]),
              ],
              [Math.ceil(C / 64), 1],
            );
            return s;
          };
          const demodOf = (
            suffix: string,
            s: GPUBuffer,
            Ci: number,
            Co: number,
            plan: BlockPlan,
          ) => {
            const d = buffer(Co * 4);
            step(
              DEMOD,
              [
                s,
                upload(get('energy' + suffix)),
                d,
                uniform([Ci, Co], [plan.demodulation.epsilon, plan.demodulation.numerator]),
              ],
              [Math.ceil(Co / 64), 1],
            );
            return d;
          };
          let act = features;
          if (block.hasConv0) {
            const plan = block.stylePlans.conv0,
              s0 = styleOf('0', inC, plan),
              d0 = demodOf('0', s0, inC, outC, plan),
              n = block.inSize,
              P = size + 1,
              phase = buffer(P * P * outC * 4);
            for (const [py, px] of [
              [0, 0],
              [0, 1],
              [1, 0],
              [1, 1],
            ] as const) {
              const taps = parityTaps(py, px),
                Ho = py ? n : n + 1,
                Wo = px ? n : n + 1,
                t = TILES(outC);
              step(
                gemmShader(t, taps, false, px ? 1 : 2, 0),
                [
                  features,
                  upload(repack(get('weight0'), inC, outC, taps)),
                  phase,
                  uniform([n, n, inC, outC, Ho, Wo, P, 2, py, px], [0, 0, 0]),
                  s0,
                ],
                [Math.ceil((Ho * Wo) / t.BM), outC / t.BN, 1],
              );
            }
            act = buffer(size * size * outC * 4);
            step(
              FIR,
              [
                phase,
                act,
                uniform(
                  [size, outC],
                  [k['noiseStrength0'] as number, k['leakyAlpha0'] as number, k['gain0'] as number],
                ),
                upload(get('filter0')),
                d0,
                noiseBuf[block.noise.conv0.name] as GPUBuffer,
                upload(get('bias0')),
              ],
              grid((size * size * outC) / 4),
            );
          }
          const plan1 = block.stylePlans.conv1,
            c1In = block.hasConv0 ? outC : inC,
            s1 = styleOf('1', c1In, plan1),
            d1 = demodOf('1', s1, c1In, outC, plan1),
            t = TILES(outC),
            out = buffer(size * size * outC * 4);
          step(
            gemmShader(t, TAPS3, true),
            [
              act,
              upload(repack(get('weight1'), c1In, outC, TAPS3)),
              out,
              uniform(
                [size, size, c1In, outC, size, size, size, 1, 0, 0],
                [k['noiseStrength1'] as number, k['leakyAlpha1'] as number, k['gain1'] as number],
              ),
              s1,
              d1,
              noiseBuf[block.noise.conv1.name] as GPUBuffer,
              upload(get('bias1')),
            ],
            [Math.ceil((size * size) / t.BM), outC / t.BN, 1],
          );
          const sr = styleOf('Rgb', outC, block.stylePlans.torgb),
            rgb = buffer(size * size * 16),
            brgb = new Float32Array(4);
          brgb.set(get('biasRgb'));
          step(
            RGB,
            [
              out,
              rgb,
              uniform([size, outC, block.hasSkip ? 1 : 0]),
              sr,
              upload(get('weightRgb')),
              skip ?? dummy,
              upload(block.hasSkip ? get('filterRgb') : new Float32Array(16)),
              upload(brgb),
            ],
            grid(size * size),
          );
          features = out;
          skip = rgb;
        }
        if (!skip) throw Error('Direct engine stream has no blocks');
        const finalRgb: GPUBuffer = skip;
        const output = buffer(3 * PIXELS * 4, S | CS);
        step(outShader(PIXELS), [finalRgb, output], grid(PIXELS));
        const outSteps = steps.length;
        const rgba = buffer(PIXELS * 4 + 16, S | CS | CD),
          bad = buffer(16, S | CS | CD);
        step(
          rgba8Shader(PIXELS),
          [finalRgb, rgba, bad, upload(new Uint32Array(4), U | CD)],
          grid(PIXELS),
        );
        o.progress?.('gpu-direct-ready');
        const lastNoise: Record<string, Float32Array> = {};
        const writeInputs = (values: Float32Array, noise: NoiseSet) => {
          device.queue.writeBuffer(latent, 0, values as Float32Array<ArrayBuffer>);
          // Noise is constant across a morph: an array is uploaded only when a different one is handed over.
          for (const n of manifest.noise) {
            const a = noise[n.name] as Float32Array;
            if (lastNoise[n.name] !== a) {
              device.queue.writeBuffer(
                noiseBuf[n.name] as GPUBuffer,
                0,
                a as Float32Array<ArrayBuffer>,
              );
              lastNoise[n.name] = a;
            }
          }
        };
        const zero = new Uint32Array(4);
        function queue(values: Float32Array, noise: NoiseSet, mode: 'raw'): Promise<Float32Array>;
        function queue(
          values: Float32Array,
          noise: NoiseSet,
          mode: 'rgba',
        ): Promise<Uint8ClampedArray>;
        function queue(
          values: Float32Array,
          noise: NoiseSet,
          mode: 'raw' | 'rgba',
        ): Promise<Float32Array | Uint8ClampedArray> {
          if (failure) throw failure;
          if (closing) throw Error('GPU session closed.');
          writeInputs(values, noise);
          const e = device.createCommandEncoder(),
            pass = e.beginComputePass();
          steps.forEach((s, i) => {
            if (mode === 'raw' ? i >= outSteps : i === outSteps - 1) return;
            pass.setPipeline(s.pipe);
            pass.setBindGroup(0, s.group);
            pass.dispatchWorkgroups(s.wg[0], s.wg[1], s.wg[2] ?? 1);
          });
          pass.end();
          const src = mode === 'raw' ? output : rgba,
            size = mode === 'raw' ? output.size : PIXELS * 4,
            pool = pools[mode];
          if (mode === 'rgba') e.copyBufferToBuffer(bad, 0, rgba, PIXELS * 4, 4);
          const readback =
            pool.pop() ??
            device.createBuffer({
              size: mode === 'raw' ? size : size + 16,
              usage: BufferUsage.MAP_READ | CD,
            });
          e.copyBufferToBuffer(src, 0, readback, 0, mode === 'raw' ? size : size + 16);
          device.queue.submit([e.finish()]);
          if (mode === 'rgba') device.queue.writeBuffer(bad, 0, zero);
          const mapped = readback.mapAsync(MapMode.READ);
          return (async () => {
            try {
              await mapped;
            } catch (error) {
              readback.destroy();
              throw failure ?? error;
            }
            const range = readback.getMappedRange();
            let out: Float32Array | Uint8ClampedArray;
            if (mode === 'raw') out = new Float32Array(range.slice(0));
            else {
              const nonFinite = new Uint32Array(range, size, 1)[0];
              out = new Uint8ClampedArray(range.slice(0, size));
              if (nonFinite) {
                readback.unmap();
                readback.destroy();
                throw Error('Nonfinite synthesis output');
              }
            }
            readback.unmap();
            if (closing || pool.length >= 2) readback.destroy();
            else pool.push(readback);
            if (failure) throw failure;
            return out;
          })();
        }
        return {
          engine: 'direct-webgpu',
          route: 'webgpu',
          boundary: 'map-async-complete',
          submitRaw: async (values, noise) => ({ done: queue(values, noise, 'raw') }),
          submitRgba: async (values, noise) => ({ done: queue(values, noise, 'rgba') }),
          onLost: (l) => lost.push(l),
          liveResources: () => (closing ? 0 : all.length + pools.raw.length + pools.rgba.length),
          dispose,
        };
      } catch (error) {
        await dispose();
        throw error;
      }
    },
  });
}
