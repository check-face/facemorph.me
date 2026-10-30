// Browser A/B of the selection worker: original vs fast, same origin (routed https://next.facemorph.me), fresh context per run.
import { chromium, firefox } from 'playwright';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = new URL('./site/', import.meta.url).pathname,
  imgDir = new URL('./img/', import.meta.url).pathname;
const [, , engine = 'chromium', rounds = '3', ...imgs] = process.argv;
const types = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html',
  '.bin': 'application/octet-stream',
  '.dat': 'application/octet-stream',
};
const browser = await (engine === 'firefox' ? firefox : chromium).launch();
async function once(variant, img) {
  const ctx = await browser.newContext();
  await ctx.route('https://next.facemorph.me/**', (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const f = join(root, p);
    if (!existsSync(f) || statSync(f).isDirectory())
      return route.fulfill({ status: 404, body: '' });
    route.fulfill({
      status: 200,
      body: readFileSync(f),
      headers: { 'content-type': types[extname(f)] || 'application/octet-stream' },
    });
  });
  const page = await ctx.newPage();
  await page.goto('https://next.facemorph.me/h/index.html');
  const bytes = [...readFileSync(join(imgDir, img))];
  const out = await page.evaluate(
    async ({ variant, bytes }) => {
      const res = [];
      for (const pass of ['cold', 'warm']) {
        const w = new Worker(
          `/h/Next/photo/${variant === 'orig' ? 'selection-worker-orig' : 'selection-worker'}.mjs`,
          { type: 'module' },
        );
        const t = performance.now();
        const r = await new Promise((ok, bad) => {
          w.onmessage = ({ data }) => {
            if (data.type === 'complete') ok(data.result);
            else if (data.type === 'error') bad(Error(data.message));
          };
          w.onerror = (e) => bad(Error(e.message));
          w.postMessage({
            type: 'align',
            blob: new Blob([new Uint8Array(bytes)]),
            tryAlign: true,
            requireSingleFace: false,
            manifestUrl:
              'https://next.facemorph.me/runtime/photo/3cc958b232e8616db831b8429eea4446c990a845738320270b47121a2d2dbdfe/manifest.json',
          });
        });
        const wall = performance.now() - t;
        w.terminate();
        const st = Object.fromEntries(r.stats.stages.map((s) => [s.name, Math.round(s.ms)]));
        res.push({
          pass,
          wall: Math.round(wall),
          faces: r.faceCount,
          rgb: r.stats.preparedSha256.slice(0, 12),
          build: r.stats.nativeBuild || 'pinned',
          fastLoader: r.stats.fastLandmarkLoader,
          cache: r.stats.modelCache,
          ...st,
        });
      }
      return res;
    },
    { variant, bytes },
  );
  await ctx.close();
  return out;
}
for (const img of imgs)
  for (let r = 0; r < +rounds; r++)
    for (const v of ['orig', 'fast', 'fast', 'orig'])
      for (const row of await once(v, img)) console.log(JSON.stringify({ engine, img, v, ...row }));
await browser.close();
