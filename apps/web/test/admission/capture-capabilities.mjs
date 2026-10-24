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
const record = await page.evaluate(async () => {
  const simd = WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
      15, 253, 98, 11,
    ]),
  );
  let threads = false;
  try {
    threads =
      typeof SharedArrayBuffer === 'function' &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
        SharedArrayBuffer;
  } catch {}
  // How far one WebAssembly memory can grow (64 KiB pages), probed up to the e4e limit and released.
  let maxMemoryBytes = 0;
  try {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 4096 });
    for (const step of [255, 768, 1024, 2048]) {
      try {
        m.grow(step);
      } catch {
        break;
      }
    }
    maxMemoryBytes = m.buffer.byteLength;
  } catch {}
  let webgpu = 'absent';
  if (navigator.gpu) {
    let adapter = null;
    for (let i = 0; i < 5 && !adapter; i++) {
      adapter = await navigator.gpu.requestAdapter().catch(() => null);
      if (!adapter) await new Promise((r) => setTimeout(r, 1000));
    }
    webgpu = adapter
      ? {
          adapter: {
            limits: {
              maxBufferSize: adapter.limits.maxBufferSize,
              maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
              maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
            },
            features: [...adapter.features].sort(),
            fallback: adapter.info?.isFallbackAdapter ?? null,
            architecture: adapter.info?.architecture ?? null,
            vendor: adapter.info?.vendor ?? null,
          },
        }
      : { adapter: null };
  }
  const avc = async (size) => {
    try {
      return (
        (
          await VideoEncoder.isConfigSupported({
            codec: 'avc1.42002A',
            width: size,
            height: size,
            bitrate: Math.round((size * size * 16 * 0.25) / 1000) * 1000,
            framerate: 16,
          })
        ).supported === true
      );
    } catch {
      return false;
    }
  };
  const videoEncoder =
    typeof VideoEncoder === 'function'
      ? { avc1024: await avc(1024), avc512: await avc(512) }
      : 'absent';
  return {
    webgpu,
    wasm: { simd, threads, maxMemoryBytes },
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    videoEncoder,
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    userAgent: navigator.userAgent,
  };
});
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
