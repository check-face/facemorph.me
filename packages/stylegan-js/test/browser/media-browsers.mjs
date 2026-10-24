// Real-browser checks of the recovery helpers (fm-1muu) in Chromium, Firefox and WebKit, on the built package
// (npm run build -w packages/stylegan-js first):
// - inspection makes no network request: every request the page makes is intercepted, and only the package's
//   own module files may be served; the still bytes are handed to the page, never fetched;
// - every inspectStill kind on the candidate's fixtures matches the Node verdicts;
// - encodePng and encodeLosslessWebp output (with its envelope) decodes in the browser to exactly the supplied
//   opaque RGBA.
//
//   node packages/stylegan-js/test/browser/media-browsers.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright');
const ORIGIN = 'https://media.test';

const served = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) served.set(`${ORIGIN}/${relative(pkg, p)}`, readFileSync(p));
  }
};
walk(join(pkg, 'dist'));
if (!served.has(`${ORIGIN}/dist/index.js`))
  throw new Error('build the package first: npm run build -w packages/stylegan-js');

const vector = (name) => readFileSync(join(pkg, 'test/vectors', name)).toString('base64');
const fixtures = {
  'recovery-v1.png': 'matching',
  'recovery-v2.png': 'matching',
  'recovery-v2.webp': 'matching',
  'model-mismatch-v2.png': 'incompatible-model',
  'damaged-v1.png': 'damaged',
};
const plain = vector('plain.png');

async function check(page) {
  return page.evaluate(
    async ({ origin, fixtures, stills, plain }) => {
      const m = await import(`${origin}/dist/index.js`);
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const models = {
        loaded: { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) },
        known: [
          { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) },
          { modelSha256: '9'.repeat(64), noiseSha256: '3'.repeat(64) },
        ],
      };
      const kinds = {};
      for (const name of Object.keys(fixtures))
        kinds[name] = m.inspectStill(bytes(stills[name]), models).kind;
      kinds['plain.png'] = m.inspectStill(bytes(plain), models).kind;
      // Exact decode of the writers' output, envelope included.
      const width = 64;
      const height = 48;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : (i * 2654435761) >>> 24;
      const recovery = {
        generationKind: 'seed',
        generationSha256: 'a'.repeat(64),
        provenance: models.loaded,
        latent: {
          space: 'w-plus',
          shape: [18, 512],
          values: new Float32Array(18 * 512).map((_, i) => Math.sin(i)),
        },
        seed: 1,
      };
      const decode = async (data, type) => {
        const bitmap = await createImageBitmap(new Blob([data], { type }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const got = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        return got.length === rgba.length && got.every((v, i) => v === rgba[i]);
      };
      const png = await m.encodePng({ width, height, rgba }, recovery, { compress: true });
      const webp = m.encodeLosslessWebp({ width, height, rgba }, recovery);
      const roundTrip = (data) => {
        const r = m.readRecovery(data);
        return (
          r.kind === 'parsed' &&
          r.recovered.latent.values.every((v, i) => v === recovery.latent.values[i])
        );
      };
      return {
        kinds,
        pngExact: await decode(png, 'image/png'),
        webpExact: await decode(webp, 'image/webp'),
        pngRecovery: roundTrip(png),
        webpRecovery: roundTrip(webp),
      };
    },
    {
      origin: ORIGIN,
      fixtures,
      stills: Object.fromEntries(Object.keys(fixtures).map((n) => [n, vector(`stills/${n}`)])),
      plain,
    },
  );
}

let failed = false;
for (const [name, type] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  const browser = await type.launch();
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url);
    const body =
      served.get(url) ??
      (url === `${ORIGIN}/` ? Buffer.from('<!doctype html><title>media</title>') : null);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      status: 200,
      body,
      contentType: url.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
  });
  await page.goto(`${ORIGIN}/`);
  const result = await check(page);
  await browser.close();
  const unexpected = requests.filter((u) => u !== `${ORIGIN}/` && !served.has(u));
  const kindsOk =
    Object.entries(fixtures).every(([n, k]) => result.kinds[n] === k) &&
    result.kinds['plain.png'] === 'missing';
  const ok =
    kindsOk &&
    result.pngExact &&
    result.webpExact &&
    result.pngRecovery &&
    result.webpRecovery &&
    unexpected.length === 0;
  failed ||= !ok;
  console.log(
    JSON.stringify({
      browser: name,
      ok,
      ...result,
      requests: requests.length,
      unexpectedRequests: unexpected,
    }),
  );
}
process.exitCode = failed ? 1 : 0;
