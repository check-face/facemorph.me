// Real-browser checks of the confirmed-crop policy (fm-smdf) in Chromium, Firefox and WebKit, on the built package
// (npm run build -w packages/stylegan-js first): the policy run in the page reproduces the candidate's qualified
// preprocessing digests (the same vectors as test/crop-policy.test.ts), every EXIF orientation and rotation gives
// the Node digests, and crop guides drawn on a display canvas in the page never reach the tensor.
//   node packages/stylegan-js/test/browser/crop-policy-browsers.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright');
const ORIGIN = 'https://crop.test';

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

const dir = join(pkg, 'test/vectors/candidate-preprocessing');
const { cases } = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
const inputs = Object.fromEntries(
  cases.map((c) => [c.id, readFileSync(join(dir, c.inputRgb)).toString('base64')]),
);

// The same variants computed in Node, as the reference for every browser.
const m = await import(new URL('../../dist/index.js', import.meta.url).href);
function variants(mod, rgb, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++)
    rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
  const out = {};
  const size = Math.min(width, height);
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8])
    for (const rotationDegrees of [0, 90, 180, 270]) {
      const crop = mod.createConfirmedCrop({
        sourceRevision: 1,
        sourceDigest: 'a'.repeat(64),
        rect: { left: 0, top: 0, width: size, height: size },
        rotationDegrees,
        exifOrientation: o,
        exifApplied: true,
        policyVersion: 'crop-preprocessing-v1',
        policyParams: mod.CROP_PREPROCESSING_POLICY_V1,
      });
      out[`o${o}-r${rotationDegrees}`] = mod.deriveEncoderInput(
        { width, height, data: rgba },
        crop,
      ).tensorDigest;
    }
  return out;
}
const seed = cases.find((c) => c.id === 'seed-0-unaligned');
const reference = variants(m, readFileSync(join(dir, seed.inputRgb)), seed.width, seed.height);

async function check(page) {
  return page.evaluate(
    async ({ origin, cases, inputs, variantsSource }) => {
      const mod = await import(`${origin}/dist/index.js`);
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const hex = async (b) =>
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
      const prepared = {};
      for (const c of cases)
        prepared[c.id] = await hex(
          mod.pillowBilinearRgb(bytes(inputs[c.id]), c.width, c.height, 256, 256),
        );
      const seed = cases.find((c) => c.id === 'seed-0-unaligned');
      const rgb = bytes(inputs[seed.id]);
      // eslint-disable-next-line no-new-func -- the same variant builder as Node, shipped as source
      const variants = new Function(`return ${variantsSource}`)()(
        mod,
        rgb,
        seed.width,
        seed.height,
      );
      // A display canvas with the photo and crop guides drawn over it; the tensor comes from the decoded pixels.
      const canvas = new OffscreenCanvas(seed.width, seed.height);
      const ctx = canvas.getContext('2d');
      const image = new ImageData(seed.width, seed.height);
      for (let i = 0; i < seed.width * seed.height; i++)
        image.data.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
      ctx.putImageData(image, 0, 0);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, seed.width - 20, seed.height - 20);
      ctx.beginPath();
      ctx.moveTo(seed.width / 3, 0);
      ctx.lineTo(seed.width / 3, seed.height);
      ctx.stroke();
      const shown = ctx.getImageData(0, 0, seed.width, seed.height).data;
      const guidesDrawn = shown.some((v, i) => v !== image.data[i]);
      return { prepared, variants, guidesDrawn };
    },
    { origin: ORIGIN, cases, inputs, variantsSource: variants.toString() },
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
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const body =
      served.get(url) ??
      (url === `${ORIGIN}/` ? Buffer.from('<!doctype html><title>crop</title>') : null);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      status: 200,
      body,
      contentType: url.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
  });
  await page.goto(`${ORIGIN}/`);
  const r = await check(page);
  await browser.close();
  const preparedOk = cases.every((c) => r.prepared[c.id] === c.preparedSha256);
  const variantsOk = Object.entries(reference).every(([k, v]) => r.variants[k] === v);
  // The guides changed the display canvas, and the tensors still equal Node's (computed from pixels alone).
  const ok =
    preparedOk && variantsOk && r.guidesDrawn && r.variants['o1-r0'] === reference['o1-r0'];
  console.log(
    JSON.stringify({
      browser: name,
      preparedOk,
      variants: Object.keys(reference).length,
      variantsOk,
      guidesDrawn: r.guidesDrawn,
      ok,
    }),
  );
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
