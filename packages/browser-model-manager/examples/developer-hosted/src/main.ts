// The page: `?model=<converted model base URL>&runtime=<runtime base URL>`, both on your static model origin.
// Nothing is requested from that origin until the person presses Review. The example is also on window.example.
import { createDeveloperHostedExample } from './example.js';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $<HTMLPreElement>('report');
const bar = $<HTMLProgressElement>('progress');
const show = (value: unknown) => {
  out.textContent = JSON.stringify(
    value,
    (_k, v: unknown) => (v instanceof Uint8ClampedArray ? `${v.length} bytes` : v),
    2,
  );
};
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

const example = createDeveloperHostedExample({
  modelBase: new URL(params.get('model') ?? './model/', location.href).href,
  runtimeBase: new URL(params.get('runtime') ?? './runtime/', location.href).href,
  onProgress: (t) => {
    bar.max = t.total;
    bar.value = t.loaded;
    $('progress-text').textContent =
      `${mb(t.loaded)} of ${mb(t.total)} (${mb(t.fetched)} of ${mb(t.fetchedTotal)} downloaded)`;
  },
});

const on = (id: string, run: () => Promise<unknown> | unknown) =>
  $<HTMLButtonElement>(id).addEventListener('click', async () => show(await run()));

on('review', async () => {
  const r = await example.review();
  if (r.ok)
    $('consent').textContent =
      `Download ${mb(r.remainingBytes)} from ${r.origin} (${r.assets} files, ${mb(r.totalBytes)} in all)?`;
  return r;
});
on('authorize', async () => {
  const a = example.authorize();
  return a.ok ? example.acquire() : a;
});
on('abort', () => example.abort());
on('generate', async () => {
  const g = await example.generate();
  if (g.ok) {
    const canvas = $<HTMLCanvasElement>('image');
    canvas.width = g.width;
    canvas.height = g.height;
    canvas
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(g.rgba), g.width, g.height), 0, 0);
  }
  return g;
});
on('release', () => example.release());
on('evict', () => example.evict());
on('status', () => example.status());

Object.assign(window, { example });
show(await example.status());
