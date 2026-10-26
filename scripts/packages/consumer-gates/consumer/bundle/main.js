// Bundler consumer (fm-7ge, gate 2): the page side of stylegan-js's explicit worker entry points. The package ships
// serveEngine/connectEngine rather than a prebuilt worker file, so the consumer owns the worker module and the
// bundler must emit it as its own chunk through new Worker(new URL(...), import.meta.url).
import { connectEngine } from 'stylegan-js/engine';

export function startEngine() {
  const worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  return connectEngine(worker);
}
