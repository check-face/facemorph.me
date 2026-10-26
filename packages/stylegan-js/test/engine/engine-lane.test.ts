// The engine's inference lane (fm-1jr7 regression): an operation submitted the moment the previous one settles must
// run. The caller-loaded example found it in Chromium: map settled, synthesize was queued while the lane's pump was
// finishing, and it stayed queued forever (state(): queued 1, running false). The capability below answers at once,
// which is the narrowest timing; it is a minimal contract implementation, not a stand-in for a dependency under test.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoadedModelCapability } from '../../src/contracts/capability.ts';
import type { SynthesisRequest } from '../../src/contracts/operations.ts';
import { createEngine } from '../../src/engine/engine.ts';

const LAYERS = 2;
const WIDTH = 4;
const instant = (): LoadedModelCapability => ({
  identity: {
    modelSha256: 'a'.repeat(64),
    noiseSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
  },
  latent: { zLength: WIDTH, layers: LAYERS, width: WIDTH },
  image: { width: 1, height: 1 },
  provider: { requested: 'cpu', actual: 'cpu', admission: 'admitted', validation: 'validated' },
  unsupported: [],
  map: async (r) => ({
    ids: r.ids,
    wPlus: { space: 'w-plus', shape: [LAYERS, WIDTH], values: new Float32Array(LAYERS * WIDTH) },
    provider: 'cpu',
  }),
  synthesize: async (r) => ({
    ids: r.ids,
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray(4),
    provider: 'cpu',
    readiness: {
      pixelsAvailable: true,
      fileReady: false,
      persisted: false,
      displayDecoded: false,
      videoPlayable: 'not-applicable',
    },
  }),
  dispose: async () => {},
});

const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(Error(`${what} never settled`)), ms)),
  ]);

test('an operation submitted as the previous one settles runs (no lost wake-up)', async () => {
  const e = createEngine({ generator: instant() });
  let revision = 0;
  const ids = () => ({ requestId: `r${++revision}`, inputRevision: revision, attemptId: 0 });
  for (let i = 0; i < 50; i++) {
    const m = await within(
      e.map({ ids: ids(), z: new Float32Array(WIDTH), truncation: { psi: 0.7, cutoff: 1 } }),
      2000,
      `map ${i}`,
    );
    assert.equal(m.status, 'completed');
    if (m.status !== 'completed') return;
    const request: SynthesisRequest = { ids: ids(), wPlus: m.result.wPlus, output: 'rgba' };
    const s = await within(e.synthesize(request, { slot: `face-${i}` }), 2000, `synthesize ${i}`);
    assert.equal(s.status, 'completed', `iteration ${i}`);
  }
  assert.deepEqual(e.state(), { admitted: true, invalid: null, queued: 0, running: false });
  await e.dispose();
});
