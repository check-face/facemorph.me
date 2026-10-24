// The ORT WebGPU engine (fm-3h3w): the bounded split graph on onnxruntime-web 1.22.0's JSEP WebGPU
// execution provider, ported from the candidate's browser/webgpu-engine.mjs (classic a42829b; product
// extraction of gpu-worker-v11, candidate mobile-boundary-bounded, 686 ms/face on the S24 Ultra). It is the
// WebGPU engine on phones and the fallback when the direct engine is not offered or has failed.
//
// - The adapter is probed and its limits checked before any runtime byte is read or any GPU device is
//   acquired: the split needs exactly 128 MiB buffers and storage bindings, on the adapter and again on
//   the device ORT creates.
// - The pinned JSEP module, factory and WASM are imported from verified bytes, with numThreads 1 and the
//   adapter that passed the check, before any session; CPU fallback inside ORT is disabled.
// - The prefix segment's two 64-channel phase tiles feed the fused-resample kernel, whose output feeds the
//   suffix; one face is a single GPU schedule plus a copy into its own readback buffer, mapped before the
//   next face can write the shared output (two readbacks are pooled; more are destroyed).

import type { RequestedRoute } from '../../contracts/capability.ts';
import { floats, readLocal, type EngineAsset, type LocalAssetReader } from '../reader.ts';
import { BufferUsage, MapMode } from './gpu-constants.ts';
import { ortWebGpuSupported } from '../routes.ts';
import { createBoundaryPipeline } from './fused-resample.ts';
import {
  assembleGenerator,
  type Generator,
  type GeneratorManifest,
  type NoiseSet,
  type SynthesisBackend,
} from './generator.ts';
import {
  loadOrtRuntime,
  type ModuleHost,
  type OrtModule,
  type OrtRuntimeAssets,
  type OrtSession,
  type OrtTensor,
} from './ort.ts';

/** manifest.webgpu. */
export interface OrtWebGpuBundle {
  readonly runtime: OrtRuntimeAssets & { readonly version?: string };
  readonly prefix: EngineAsset;
  readonly suffix: EngineAsset;
  readonly split: EngineAsset;
  readonly metadata: EngineAsset;
  readonly filter: EngineAsset;
  readonly bias: EngineAsset;
  readonly kernel?: EngineAsset;
}

/** Raised when the GPU cannot run the engine at all: the route is unsupported, not failed. */
export class GpuUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSupportedError';
  }
}

const json = async (reader: LocalAssetReader, asset: EngineAsset) =>
  JSON.parse(new TextDecoder().decode(await readLocal(reader, asset))) as Record<string, unknown>;

export async function loadOrtWebGpuGenerator(o: {
  readonly reader: LocalAssetReader;
  readonly manifest: GeneratorManifest & { readonly webgpu: OrtWebGpuBundle };
  readonly manifestSha256: string;
  readonly gpu: GPU;
  readonly host: ModuleHost;
  /** The CPU ORT module for the mapping session. */
  readonly cpuOrt: () => Promise<OrtModule>;
  readonly requested?: RequestedRoute;
  readonly now?: () => number;
  readonly release?: () => void;
  readonly progress?: (stage: 'gpu-prefix-loading' | 'gpu-suffix-loading') => void;
}): Promise<Generator> {
  const { reader, manifest } = o;
  const bundle = manifest.webgpu;
  // Probe and check before anything is read: an unusable adapter costs no bytes and no device.
  const adapter = await o.gpu.requestAdapter();
  if (!adapter) throw new GpuUnsupported('WebGPU is unavailable.');
  if (!ortWebGpuSupported(adapter.limits as unknown as Record<string, number>))
    throw new GpuUnsupported(
      'The bounded WebGPU route needs 128 MiB buffers and storage bindings.',
    );
  const bundleAssets = [
    bundle.runtime.module,
    bundle.runtime.factory,
    bundle.runtime.wasm,
    bundle.prefix,
    bundle.suffix,
    bundle.split,
    bundle.metadata,
    bundle.filter,
    bundle.bias,
  ];
  return assembleGenerator({
    reader,
    manifest,
    manifestSha256: o.manifestSha256,
    requested: o.requested ?? 'webgpu',
    mapping: { ort: o.cpuOrt },
    warmMapping: true,
    extraAssets: bundleAssets,
    unsupported: [],
    ...(o.now ? { now: o.now } : {}),
    ...(o.release ? { release: o.release } : {}),
    backend: async (): Promise<SynthesisBackend> => {
      const sessions: OrtSession[] = [];
      const buffers = new Set<GPUBuffer>();
      let device: GPUDevice | undefined;
      let ort: OrtModule | undefined;
      let release: () => void = () => {};
      let closing = false;
      let failure: Error | null = null;
      const lost: ((message: string) => void)[] = [];
      const fail = (error: Error) => {
        if (closing || failure) return;
        failure = error;
        for (const l of lost) l(error.message);
      };
      async function dispose() {
        if (closing) return;
        closing = true;
        for (const s of sessions.splice(0)) await s.release().catch(() => {});
        for (const b of buffers) b.destroy();
        buffers.clear();
        // Session creation can allocate a device and then reject before `device` is assigned.
        (device ?? (ort?.env.webgpu?.device as GPUDevice | undefined))?.destroy();
        release();
      }
      try {
        const runtime = await loadOrtRuntime(reader, bundle.runtime, o.host, 1);
        ort = runtime.ort;
        release = runtime.release;
        if (!ort.env.webgpu) throw Error('The pinned runtime has no WebGPU environment.');
        ort.env.webgpu.adapter = adapter;
        const meta = await json(reader, bundle.metadata);
        const split = (await json(reader, bundle.split)) as {
          prefixOutputs: Record<string, number[]>;
          suffixInputs: string[];
          external: string;
        };
        const filter = floats(await readLocal(reader, bundle.filter));
        const bias = floats(await readLocal(reader, bundle.bias));
        const options = {
          executionProviders: ['webgpu'],
          preferredOutputLocation: 'gpu-buffer',
          extra: { session: { disable_cpu_ep_fallback: '1' } },
        };
        // Each stage is announced once its bytes are in hand, never before.
        const prefixModel = await readLocal(reader, bundle.prefix);
        o.progress?.('gpu-prefix-loading');
        const prefix = await ort.InferenceSession.create(prefixModel, options);
        sessions.push(prefix);
        device = ort.env.webgpu.device as GPUDevice;
        const d = device;
        if (!ortWebGpuSupported(d.limits as unknown as Record<string, number>))
          throw new GpuUnsupported(
            'The bounded WebGPU route needs 128 MiB buffers and storage bindings.',
          );
        void d.lost.then((info) => fail(Error('GPU device lost: ' + info.reason)));
        d.addEventListener('uncapturederror', (event) => {
          failure ??= Error('GPU validation: ' + (event as GPUUncapturedErrorEvent).error.message);
        });
        const suffixModel = await readLocal(reader, bundle.suffix);
        o.progress?.('gpu-suffix-loading');
        const suffix = await ort.InferenceSession.create(suffixModel, {
          ...options,
          executionProviders: [{ name: 'webgpu', device: d }],
        });
        sessions.push(suffix);
        if (ort.env.webgpu.device !== d) throw Error('GPU sessions use different devices.');
        const O = ort;
        const tensor = (dims: readonly number[], data?: Float32Array) => {
          const size = dims.reduce((a, b) => a * b, 4);
          const buffer = d.createBuffer({
            size,
            usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
          });
          buffers.add(buffer);
          if (data) d.queue.writeBuffer(buffer, 0, data as Float32Array<ArrayBuffer>);
          const t = O.Tensor.fromGpuBuffer?.(buffer, { dataType: 'float32', dims });
          if (!t) throw Error('The pinned runtime cannot wrap GPU buffers.');
          return { buffer, tensor: t };
        };
        const all: Record<string, { buffer: GPUBuffer; tensor: OrtTensor }> = {
          w: tensor([1, 18, 512]),
        };
        for (const n of manifest.noise) all[n.name] = tensor(n.shape);
        const outputs = Object.fromEntries(
          Object.entries(split.prefixOutputs).map(([name, dims]) => [name, tensor(dims)]),
        );
        const external = tensor([1, 32, 1024, 1024]);
        const out = tensor([1, 3, 1024, 1024]);
        const filterBuffer = tensor([16], filter);
        const biasBuffer = tensor([32], bias);
        const pick = (name: string) => {
          const t = outputs[name] ?? all[name];
          if (!t) throw Error(`Split graph names an unknown tensor: ${name}`);
          return t;
        };
        const feeds = Object.fromEntries(
          prefix.inputNames.map((name) => [name, pick(name).tensor]),
        );
        const preout = Object.fromEntries(
          Object.entries(outputs).map(([name, item]) => [name, item.tensor]),
        );
        const suffixFeeds = Object.fromEntries(
          split.suffixInputs.map((name) => [
            name,
            name === split.external ? external.tensor : pick(name).tensor,
          ]),
        );
        const phase = String(meta['phase']);
        const fused = (
          await createBoundaryPipeline(
            d,
            meta as unknown as { strength: number; gain: number },
            true,
            256,
            'bounded',
          )
        ).bind({
          phase: pick(phase + '__tile0').buffer,
          phaseB: pick(phase + '__tile1').buffer,
          demod: outputs[String(meta['demod'])]?.buffer,
          noise: all['noise_15']?.buffer,
          filter: filterBuffer.buffer,
          bias: biasBuffer.buffer,
          output: external.buffer,
        });
        const spare: GPUBuffer[] = [];
        const submitRaw = async (values: Float32Array, set: NoiseSet) => {
          if (failure) throw failure;
          if (closing) throw Error('GPU session closed.');
          d.queue.writeBuffer(all['w']!.buffer, 0, values as Float32Array<ArrayBuffer>);
          for (const n of manifest.noise)
            d.queue.writeBuffer(all[n.name]!.buffer, 0, set[n.name] as Float32Array<ArrayBuffer>);
          await prefix.run(feeds, preout);
          const command = d.createCommandEncoder();
          fused.encode(command);
          d.queue.submit([command.finish()]);
          await suffix.run(suffixFeeds, { image: out.tensor });
          if (failure) throw failure;
          let readback = spare.pop();
          if (!readback) {
            readback = d.createBuffer({
              size: out.buffer.size,
              usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST,
            });
            buffers.add(readback);
          }
          const rb = readback;
          const drop = () => {
            buffers.delete(rb);
            rb.destroy();
          };
          const copy = d.createCommandEncoder();
          copy.copyBufferToBuffer(out.buffer, 0, rb, 0, out.buffer.size);
          d.queue.submit([copy.finish()]);
          const mapped = rb.mapAsync(MapMode.READ);
          const done = (async () => {
            try {
              await mapped;
            } catch (error) {
              drop();
              throw failure ?? error;
            }
            const result = new Float32Array(rb.getMappedRange().slice(0));
            rb.unmap();
            if (failure) {
              drop();
              throw failure;
            }
            if (closing || spare.length >= 2) drop();
            else spare.push(rb);
            return result;
          })();
          return { done };
        };
        return {
          engine: 'ort-webgpu',
          route: 'webgpu',
          boundary: 'map-async-complete',
          submitRaw,
          onLost: (l) => lost.push(l),
          liveResources: () => sessions.length + buffers.size,
          dispose,
        };
      } catch (error) {
        await dispose();
        throw error;
      }
    },
  });
}
