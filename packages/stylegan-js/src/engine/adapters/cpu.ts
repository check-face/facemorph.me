// The CPU route (fm-3h3w): one ORT WASM synthesis session fed W+ [1, layers, width] and the manifest's noise
// tensors, as the candidate's ort-worker.mjs load() and run() (classic a42829b). Threads are bounded to
// 1-4 by routes.ts cpuThreads(); the canaries admit the route whatever the count. Loading is sequential:
// noise, the synthesis session, then the mapping session on the first map().

import type { RequestedRoute } from '../../contracts/capability.ts';
import type { ModelDescriptor } from '../../contracts/descriptor.ts';
import { readLocal, runCompute, type LocalAssetReader } from '../reader.ts';
import {
  assembleGenerator,
  describedGeometry,
  type Generator,
  type GeneratorManifest,
  type NoiseSet,
  type SynthesisBackend,
} from './generator.ts';
import type { OrtModule, OrtSession, OrtTensor } from './ort.ts';

export async function loadCpuGenerator(o: {
  readonly reader: LocalAssetReader;
  readonly manifest: GeneratorManifest;
  readonly manifestSha256: string;
  /** The CPU ORT module, threads already set (loadOrtRuntime in a browser; the npm module in Node). */
  readonly ort: () => Promise<OrtModule>;
  readonly requested?: RequestedRoute;
  /** The model the manifest holds (default FFHQ config-F); every shape below comes from it. */
  readonly descriptor?: ModelDescriptor;
  readonly now?: () => number;
  readonly release?: () => void;
}): Promise<Generator> {
  const { reader, manifest } = o;
  const described = describedGeometry('ort-wasm', manifest, o.descriptor);
  return assembleGenerator({
    ...described,
    reader,
    manifest,
    manifestSha256: o.manifestSha256,
    requested: o.requested ?? 'cpu',
    mapping: { ort: o.ort },
    warmMapping: false,
    extraAssets: [manifest.synthesis],
    unsupported: [{ capability: 'webgpu', reason: 'This generator runs the CPU (WASM) route.' }],
    ...(o.now ? { now: o.now } : {}),
    ...(o.release ? { release: o.release } : {}),
    backend: async (_noise, _trace, reader, geometry): Promise<SynthesisBackend> => {
      const { latent, channels, height, width } = geometry;
      const ort = await o.ort();
      const model = await readLocal(reader, manifest.synthesis);
      let session: OrtSession | null = await runCompute(reader, () =>
        ort.InferenceSession.create(model, { executionProviders: ['wasm'] }),
      );
      const run = (values: Float32Array, noise: NoiseSet): Promise<Float32Array> =>
        runCompute(reader, async () => {
          if (!session) throw Error('The CPU session was released.');
          const feeds: Record<string, OrtTensor> = {
            w: new ort.Tensor('float32', values, [1, latent.layers, latent.width]),
          };
          for (const item of manifest.noise)
            feeds[item.name] = new ort.Tensor(
              'float32',
              noise[item.name] as Float32Array,
              item.shape,
            );
          let output: OrtTensor | undefined;
          try {
            output = (await session.run(feeds))['image'];
            if (!output) throw Error('Synthesis produced no image output');
            const raw = new Float32Array((await output.getData()) as Float32Array);
            if (raw.length !== channels * height * width)
              throw Error(`Synthesis output is not [1,${channels},${height},${width}]`);
            return raw;
          } finally {
            for (const t of Object.values(feeds)) t.dispose();
            output?.dispose();
          }
        });
      return {
        engine: 'ort-wasm',
        route: 'cpu',
        boundary: 'readback-complete',
        // The CPU runs one face at a time: "queued" is "done".
        submitRaw: async (values, noise) => {
          const raw = await run(values, noise);
          return { done: Promise.resolve(raw) };
        },
        liveResources: () => (session ? 1 : 0),
        async dispose() {
          const s = session;
          session = null;
          await s?.release();
        },
      };
    },
  });
}
