// The bundler-emitted app workers (import/build-inputs.json worker_graphs.emitted), one factory each, written as
// the literal `new Worker(new URL(...), { type: 'module' })` Vite bundles. They are inventoried apart from the
// workers and modules the runtime manifest pins and the app loads by URL (scripts/runtime/check-pins.mjs).
export const EMITTED_WORKERS = {
  'ort-worker': () => new Worker(new URL('../src/Next/browser/ort-worker.mjs', import.meta.url), { type: 'module' }),
  'image-encoder-worker': () => new Worker(new URL('../src/Next/image-encoder-worker.mjs', import.meta.url), { type: 'module' }),
  'video-worker': () => new Worker(new URL('../src/Next/video-worker.mjs', import.meta.url), { type: 'module' }),
  'selection-worker': () => new Worker(new URL('../src/Next/photo/selection-worker.mjs', import.meta.url), { type: 'module' }),
} as const;

export type EmittedWorker = keyof typeof EMITTED_WORKERS;
