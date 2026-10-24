// Browser sessions for the maintained research drivers (fm-qqh): a verified artifact served at the production
// origin by classic's qualification server (apps/web/test/parity/control-server.ts, the same path the parity specs
// use), a Chromium with its own profile, every request through the interception helper (only the origin and the
// project's catalogue Workers resolve; everything else is aborted and counted), and a trace plus a screenshot kept
// when a session fails.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { acquiredFindings } from '../../../scripts/inventory/check-build-inputs.mjs';
import { BUILD_INPUTS, readJson, sha256 } from '../../../scripts/inventory/lib.mjs';
import { readFileSync } from 'node:fs';
import { REPO } from './artifact.mjs';
import {
  chromiumArgs,
  ORIGIN,
  ORIGIN_HOST,
  PROJECT_HOSTS,
  startControl,
} from '../../../apps/web/test/parity/control-server.ts';

export { ORIGIN, ORIGIN_HOST };
const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
export const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
/** eris: WebGPU on the NVIDIA card through Vulkan via ANGLE (autoresearch/devices/eris/launch-chromium.sh). */
export const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-gl=angle',
  '--disable-vulkan-surface',
];

/** The verified acquired runtime the server serves; refused unless every pinned file checks out. */
export function verifiedRuntime(dir) {
  const { out, files } = acquiredFindings(dir, readJson(BUILD_INPUTS).runtime.assets);
  if (out.length || !files)
    throw new Error(`${dir} is not a verified acquired runtime (${out.length} findings)`);
  return { dir, files, manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))) };
}

/** Serves the artifact at ORIGIN (port 8443 through the host mapping); stop() ends the server. */
export const serve = ({ artifact, source, runtime, log }) =>
  startControl({ artifact, source, runtime, log });

/** Host class of a request: the origin, a project host, or 'blocked:<host>'. Pure. */
export function hostClass(url) {
  const u = new URL(url);
  if (u.protocol === 'data:' || u.protocol === 'blob:') return 'inline';
  if (u.hostname === ORIGIN_HOST) return 'origin';
  if (PROJECT_HOSTS.includes(u.hostname)) return `project:${u.hostname}`;
  return `blocked:${u.hostname}`;
}

/** The request-interception helper: allow the origin and project hosts, abort the rest, count both. */
export async function guardNetwork(context) {
  const network = {};
  const count = (cls, bytes = 0) => {
    const n = (network[cls] ??= { requests: 0, bytes: 0 });
    n.requests++;
    n.bytes += bytes;
  };
  await context.route('**/*', (route) => {
    const cls = hostClass(route.request().url());
    if (cls.startsWith('blocked:')) {
      count(cls);
      return route.abort();
    }
    return route.continue();
  });
  context.on('requestfinished', async (request) => {
    const cls = hostClass(request.url());
    if (cls === 'inline') return;
    const sizes = await request.sizes().catch(() => null);
    count(cls, sizes ? sizes.responseBodySize : 0);
  });
  return network;
}

export async function launch({ profile, route }) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM,
    headless: true,
    viewport: { width: 1280, height: 960 },
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      ...chromiumArgs,
      ...(route === 'webgpu' ? GPU_ARGS : []),
    ],
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  return context;
}

/** Ends a session: on failure keep the trace and a screenshot in dir; on success discard the trace. */
export async function finish(context, { failed, dir }) {
  const kept = [];
  if (failed) {
    const page = context.pages()[0];
    if (page)
      await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }).then(
        () => kept.push('failure.png'),
        () => {},
      );
    await context.tracing.stop({ path: join(dir, 'trace.zip') }).then(() => kept.push('trace.zip'));
  } else await context.tracing.stop();
  await context.close();
  return kept;
}

const quiet = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

/** Host facts recorded before and after a run: load, GPU state, browser build. */
export const environment = () => ({
  at: new Date().toISOString(),
  loadavg: loadavg(),
  gpu: quiet('nvidia-smi', [
    '--query-gpu=name,driver_version,utilization.gpu,memory.used,temperature.gpu,clocks.sm',
    '--format=csv,noheader',
  ]),
  chromium: quiet(CHROMIUM, ['--version']),
});

/** The WebGPU adapter the page sees, or null. requestAdapter() answers null until the GPU process has
 * initialised (seconds after launch on eris), so it is asked again for up to 15 s before none is concluded. */
export const adapterInfo = (page) =>
  page.evaluate(async () => {
    for (const end = performance.now() + 15000; ;) {
      const a = await navigator.gpu?.requestAdapter();
      if (a) {
        const i = a.info ?? {};
        return {
          vendor: i.vendor,
          architecture: i.architecture,
          device: i.device,
          description: i.description,
          isFallbackAdapter: Boolean(i.isFallbackAdapter ?? a.isFallbackAdapter),
        };
      }
      if (!navigator.gpu || performance.now() > end) return null;
      await new Promise((r) => setTimeout(r, 250));
    }
  });
