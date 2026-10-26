// The paired facade page (fm-fy2.6 paired harness comparison). The runner copies this file to
// apps/web/test/e2e/facade-paired/page.ts inside each side's exported tree (the control revision and the build
// revision) and Vite-builds it there, so both sides run the same steps through their own typed facade, bridge,
// runtime loader and worker. It uses only the facade API both sides share (execute, subscribe) and the bridge's
// cropPhotoReported (the product's Use this crop), which exist unchanged at the fm-pia9 facade commit and at HEAD.
// It times in the page (performance.now around each step); nothing here replaces bridge behaviour.
import * as f from '../../../shell/facade/bridge.ts';
import { cropPhotoReported } from '../../../src/Next/product-bridge.mjs';

const invalid: string[] = [];
f.subscribe(
  () => {},
  (e) => invalid.push(e.message),
);
let job = 0;
const input = (
  id: string,
  mode: f.InputMode,
  value: string,
  file: Blob | null = null,
): f.Input => ({
  id,
  mode,
  value,
  file,
});
const request = (target: string, inputs: f.Input[]): f.Request => ({
  jobId: ++job,
  action: 'face',
  target,
  inputs,
  kind: 'linear',
  width: 1,
  pinch: false,
  frames: 8,
  fps: 16,
  provider: 'cpu',
});

/** Bytes the origin holds (navigator.storage.estimate usage), sampled while a step runs; the peak and the last. */
function storageSampler(everyMs = 200) {
  let peak = 0;
  let last = 0;
  let stopped = false;
  const sample = async () => {
    try {
      const { usage = 0 } = await navigator.storage.estimate();
      last = usage;
      if (usage > peak) peak = usage;
    } catch {
      /* estimate unavailable: stays 0 and the measure is reported unmeasured */
    }
  };
  const loop = (async () => {
    while (!stopped) {
      await sample();
      await new Promise((r) => setTimeout(r, everyMs));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    await sample();
    return { peak, last };
  };
}

const produced = (out: f.Output, id: string) =>
  out.errorMessage === '' && out.faces.some((x) => x.id === id);
const summary = (out: f.Output | null) =>
  out ? { message: out.message, faces: out.faces.map((x) => x.id), cropFace: out.cropFace } : null;

const harness = {
  /**
   * Cold photo on an empty profile: the e4e qualification image seed-0 (512 x 512 RGB) as a lossless PNG, confirmed
   * whole through the bridge's Use this crop at its own size, then run as a face. Time-to-encoded-face is from the
   * confirmation (crop call) to the face's Output; stored bytes are sampled throughout.
   */
  async coldPhoto(url: string) {
    const rgb = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const side = 512;
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(side, side);
    for (let i = 0; i < side * side; i++)
      image.data.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
    context.putImageData(image, 0, 0);
    const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'seed-0.png', {
      type: 'image/png',
    });
    const before = (await navigator.storage.estimate()).usage ?? 0;
    const stop = storageSampler();
    const began = performance.now();
    let out: f.Output | null = null;
    let error = '';
    try {
      const chosen = (await cropPhotoReported(
        file,
        { left: 0, top: 0, width: side, height: side },
        { previewScale: 1, rotation: 0, output: side },
      )) as File;
      out = await f.execute(request('p', [input('p', 'photo', 'Photo', chosen)]));
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    }
    const ms = performance.now() - began;
    const stored = await stop();
    return {
      ms,
      produced: out ? produced(out, 'p') : false,
      error:
        error || out?.errorMessage || (out?.cropFace ? `crop requested (${out.cropFace})` : ''),
      storedBefore: before,
      storedPeak: stored.peak,
      storedAfter: stored.last,
      out: summary(out),
      invalid: [...invalid],
    };
  },
  /** One face by name; `ms` from the call to its Output. */
  async face(id: string, value: string) {
    const began = performance.now();
    let out: f.Output | null = null;
    let error = '';
    try {
      out = await f.execute(request(id, [input(id, 'text', value)]));
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    }
    return {
      ms: performance.now() - began,
      produced: out ? produced(out, id) : false,
      error: error || out?.errorMessage || '',
      out: summary(out),
      invalid: [...invalid],
    };
  },
  async stored() {
    return (await navigator.storage.estimate()).usage ?? 0;
  },
};
Object.assign(window, { harness, harnessReady: true });
