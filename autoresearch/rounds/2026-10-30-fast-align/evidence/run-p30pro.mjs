// P30 Pro A/B of the selection worker over real Chrome (CDP via adb forward); page at http://localhost:PORT (adb reverse).
import { chromium } from 'playwright';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
const ADB = process.env.ADB,
  SERIAL = 'DUM0220115002146',
  PORT = 8461;
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' }).trim();
const root = new URL('./site/', import.meta.url).pathname,
  imgDir = new URL('./img/', import.meta.url).pathname;
const [, , rounds = '3', ...imgs] = process.argv;
const types = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html',
};
const server = createServer((q, r) => {
  const f = join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!existsSync(f) || statSync(f).isDirectory()) {
    r.writeHead(404).end();
    return;
  }
  r.writeHead(200, {
    'content-type': types[extname(f)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  r.end(readFileSync(f));
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
adb('reverse', '--no-rebind', `tcp:${PORT}`, `tcp:${PORT}`);
let fwd, browser, page;
try {
  adb(
    'shell',
    'am start -n com.android.chrome/com.google.android.apps.chrome.Main -d about:blank >/dev/null',
  );
  await new Promise((r) => setTimeout(r, 3000));
  fwd = adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote');
  browser = await chromium.connectOverCDP(`http://localhost:${fwd}`);
  page = await browser.contexts()[0].newPage();
  await page.bringToFront();
  await page.goto(`http://localhost:${PORT}/h/index.html`);
  console.log(
    JSON.stringify({
      device: adb('shell', 'getprop ro.product.model'),
      chrome: await page.evaluate(() => navigator.userAgent),
    }),
  );
  for (const img of imgs) {
    const bytes = [...readFileSync(join(imgDir, img))];
    for (let r = 0; r < +rounds; r++)
      for (const v of ['orig', 'fast', 'fast', 'orig']) {
        const rows = await page.evaluate(
          async ({ variant, bytes }) => {
            const root = await navigator.storage.getDirectory();
            try {
              await root.removeEntry(
                'landmarks-fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f.dat',
              );
            } catch {}
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
                    location.origin +
                    '/runtime/photo/3cc958b232e8616db831b8429eea4446c990a845738320270b47121a2d2dbdfe/manifest.json',
                });
              });
              const wall = performance.now() - t;
              w.terminate();
              res.push({
                pass,
                wall: Math.round(wall),
                faces: r.faceCount,
                rgb: r.stats.preparedSha256.slice(0, 12),
                build: r.stats.nativeBuild || 'pinned',
                fastLoader: r.stats.fastLandmarkLoader,
                cache: r.stats.modelCache,
                ...Object.fromEntries(r.stats.stages.map((s) => [s.name, Math.round(s.ms)])),
              });
            }
            return res;
          },
          { variant: v, bytes },
        );
        for (const row of rows)
          console.log(JSON.stringify({ cell: 'p30pro-chrome', img, v, ...row }));
      }
  }
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(
        'landmarks-fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f.dat',
      );
    } catch {}
  });
} finally {
  try {
    await page?.close();
  } catch {}
  try {
    await browser?.close();
  } catch {}
  if (fwd)
    try {
      adb('forward', '--remove', `tcp:${fwd}`);
    } catch {}
  try {
    adb('reverse', '--remove', `tcp:${PORT}`);
  } catch {}
  server.close();
}
