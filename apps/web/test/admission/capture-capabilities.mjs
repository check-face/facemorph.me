// Captures a capability record from a real browser (fm-4umi): what the page can read without loading a model.
// The records in capabilities/ are inputs for the pure admission tests; each names its browser, machine and date.
//   node apps/web/test/admission/capture-capabilities.mjs <chromium|chromium-webgpu|firefox|webkit> <out.json> [--executable <path>]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';

const [kind, out] = process.argv.slice(2);
const exe = process.argv.includes('--executable')
  ? process.argv[process.argv.indexOf('--executable') + 1]
  : undefined;
const require = createRequire(new URL('../../package.json', import.meta.url));
const pw = require('playwright');
const engine = kind.startsWith('chromium') ? pw.chromium : pw[kind];
const args =
  kind === 'chromium-webgpu'
    ? [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--use-angle=vulkan',
        '--ignore-gpu-blocklist',
      ]
    : [];
const browser = await engine.launch({
  ...(exe ? { executablePath: exe } : {}),
  args,
  headless: kind !== 'chromium-webgpu' ? true : false,
});
const page = await browser.newPage();
await page.route('**/*', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'text/html',
    headers: {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    },
    body: '<!doctype html><title>caps</title>',
  }),
);
await page.goto('https://caps.test/');
const probe = (await import('./probe.js')).default.toString();
const record = await page.evaluate(`(${probe})()`);
await browser.close();
const doc = {
  captured: new Date().toISOString().slice(0, 10),
  machine: hostname(),
  browser: `${kind} ${browser.version()}`,
  note: 'userAgent is recorded for provenance only; admission never reads it',
  record,
};
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(
  JSON.stringify({
    kind,
    webgpu:
      typeof record.webgpu === 'string'
        ? record.webgpu
        : record.webgpu.adapter
          ? 'adapter'
          : 'null',
    wasm: record.wasm,
    coi: record.crossOriginIsolated,
    video: record.videoEncoder,
  }),
);
