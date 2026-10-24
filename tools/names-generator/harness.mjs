// Browser side of the catalogue result generator (bead fm-a40f). Runs the pinned candidate's own modules,
// served from classic at the pinned revision: the typed-name path (runtime.generate, mode 'text') and the
// candidate's Save path (downloadImage: WebP q0.8 with the v2 recovery envelope). Nothing here talks to
// the network except the candidate runtime loading its pinned, digest-checked model assets.
import { createBrowserRuntime } from '/src/Next/browser/runtime.mjs';
import { downloadImage } from '/src/Next/recovery-metadata.mjs';
import { digest } from '/src/Next/browser/originals.mjs';

let runtime;

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// The candidate persists every generated original in IndexedDB; 5,055 of them would fill the profile.
// Cleared by a transaction (never deleteDatabase, which an open connection would block).
async function clearOriginals() {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('checkface-originals-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('originals');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('originals', 'readwrite');
    tx.objectStore('originals').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function rgbaOf(blob) {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

// Start the candidate runtime on one route and run its own qualification (canaries against the manifest's
// reference values within the frozen tolerances).
window.setup = async (route) => {
  runtime?.dispose();
  runtime = createBrowserRuntime({ manifestUrl: '/runtime/manifest.json' });
  const admission = await runtime.qualify(route);
  return {
    admission: JSON.parse(JSON.stringify(admission ?? null)),
    status: JSON.parse(JSON.stringify(runtime.status())),
  };
};

// One catalogue name through the typed-name path, saved as the candidate saves it.
window.generateName = async (value, { withPng = false } = {}) => {
  const result = await runtime.generate({ mode: 'text', value });
  const latent = new Uint8Array(Float32Array.from(result.latent.values).buffer);
  const webp = new Uint8Array(await (await downloadImage(result)).arrayBuffer());
  const png = withPng ? new Uint8Array(await result.blob.arrayBuffer()) : null;
  await clearOriginals();
  return {
    webp: b64(webp),
    png: png && b64(png),
    latent: b64(latent),
    latentSha256: await digest(latent),
    sourceType: result.blob.type,
    cached: result.cached === true,
    generationKind: result.generationKind,
    generationSha256: result.generationSha256,
    provenance: JSON.parse(JSON.stringify(result.provenance)),
  };
};

// Independent reference: the same W+ through this page's runtime (the CPU route), compared over every
// RGBA8 channel with the producer's lossless output.
window.reference = async (latentB64, pngB64) => {
  const raw = unb64(latentB64);
  const values = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const ref = await runtime.synthesize(
    { space: 'w-plus', shape: [1, 18, 512], values: Float32Array.from(values) },
    { raw: true, persist: false },
  );
  const mine = new Uint8Array(ref.rgba);
  const theirs = await rgbaOf(new Blob([unb64(pngB64)], { type: 'image/png' }));
  if (mine.length !== theirs.length)
    return { maxDiff: 255, differing: -1, reference: 'size mismatch' };
  let maxDiff = 0;
  let differing = 0;
  for (let i = 0; i < mine.length; i++) {
    const d = Math.abs(mine[i] - theirs[i]);
    if (d) {
      differing++;
      if (d > maxDiff) maxDiff = d;
    }
  }
  return { maxDiff, differing, reference: `candidate ${runtime.status().route ?? 'cpu'} route` };
};

window.harnessReady = true;
