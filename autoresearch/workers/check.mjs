#!/usr/bin/env node
// Worker readiness for the maintained research drivers (fm-qqh): run on the worker itself, from its executable
// checkout, before a measured run. Checks the things a recipe used to assume: the checkout, Node, the browser
// controller and browser, the shared timing lock directory, the verified acquired runtime, the pinned control
// artifact, host load and, for browser-gpu, a hardware WebGPU adapter in the same browser and flags the drivers use
// (a software adapter is rejected). Prints one JSON line per check and a summary; exit 1 when any check fails.
//   node autoresearch/workers/check.mjs --lane browser-cpu|browser-gpu [--runtime <dir>] [--smoke] [--software]
// --software launches the adapter probe with SwiftShader forced: the planted case the recipe must reject.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname, loadavg, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { adapterVerdict } from '../drivers/lib/adapter.mjs';
import { CONTROL, REPO, artifactDigest } from '../drivers/lib/artifact.mjs';

const { values: opt } = parseArgs({
  options: {
    lane: { type: 'string', default: 'browser-cpu' },
    runtime: {
      type: 'string',
      default: process.env.FACEMORPH_RUNTIME ?? join(REPO, '.cache/runtime'),
    },
    software: { type: 'boolean', default: false },
    smoke: { type: 'boolean', default: false },
  },
});
const checks = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    checks.push({ check: name, ok: true, detail });
  } catch (error) {
    checks.push({ check: name, ok: false, detail: error.message });
  }
  console.log(JSON.stringify(checks.at(-1)));
};
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

await check('checkout', () => {
  const head = run('git', ['-C', REPO, 'rev-parse', 'HEAD']);
  const remote = run('git', ['-C', REPO, 'remote', 'get-url', 'origin']);
  if (!/facemorph\.me(\.git)?$/.test(remote))
    throw new Error(`origin is ${remote}, not this repository`);
  return { repo: REPO, head, remote, host: hostname() };
});
await check('node', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24)
    throw new Error(`Node ${process.version}: the drivers import .ts modules (Node 24 or later)`);
  return process.version;
});
let chromium;
await check('browser controller', async () => {
  const { createRequire } = await import('node:module');
  const pw = createRequire(join(REPO, 'apps/web/package.json'));
  chromium = pw(process.env.PLAYWRIGHT_MODULE ?? 'playwright').chromium;
  return `playwright ${pw('playwright/package.json').version} (apps/web, npm ci at the root)`;
});
const browser = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
await check('browser', () => run(browser, ['--version']));
await check('timing lock directory', () => {
  const path = process.env.FACEMORPH_LOCK_DIR ?? join(process.env.HOME, '.cache/facemorph/locks');
  if (!isAbsolute(path)) throw new Error('FACEMORPH_LOCK_DIR must be absolute');
  return { path, exclusive: 'gpu-timing', correctnessLock: false };
});
await check('acquired runtime', async () => {
  const { verifiedRuntime } = await import('../drivers/lib/session.mjs');
  const r = verifiedRuntime(resolve(opt.runtime));
  return { dir: r.dir, files: r.files, manifestSha256: r.manifestSha256 };
});
await check('control artifact', () => {
  const dir = join(REPO, CONTROL.path);
  if (!existsSync(join(dir, 'index.html')))
    throw new Error(`${dir} missing: node scripts/import/fetch-control.mjs --dest .cache/control`);
  const id = artifactDigest(dir);
  if (id.treeSha256 !== CONTROL.treeSha256)
    throw new Error(`${dir} is ${id.treeSha256}, not the pinned control ${CONTROL.treeSha256}`);
  return id;
});
await check('host load', () => {
  const [one] = loadavg();
  // A paired measurement refuses load above 4; a smoke (not an evaluated outcome) records it.
  if (one > 4 && !opt.smoke)
    throw new Error(`load ${one}: a paired measurement would be refused (--smoke records it)`);
  return { loadavg: loadavg(), smoke: opt.smoke };
});
if (opt.lane === 'browser-gpu')
  await check('WebGPU adapter', async () => {
    const { GPU_ARGS, adapterInfo } = await import('../drivers/lib/session.mjs');
    const profile = mkdtempSync(join(tmpdir(), 'facemorph-adapter-'));
    const server = createServer((_, res) => res.end('<title>adapter</title>'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const args = [
      '--no-sandbox',
      ...GPU_ARGS,
      ...(opt.software ? ['--use-webgpu-adapter=swiftshader'] : []),
    ];
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: browser,
      headless: true,
      args,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // navigator.gpu exists only in a secure context: http://127.0.0.1 is one, a data: page is not.
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const info = await adapterInfo(page);
      const verdict = adapterVerdict(info, 'browser-gpu');
      if (!verdict.ok) throw new Error(`rejected: ${verdict.reason}`);
      return { info, verdict: verdict.reason, forcedSoftware: opt.software };
    } finally {
      await context.close();
      server.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
const ok = checks.every((c) => c.ok);
console.log(
  JSON.stringify({
    summary: {
      ok,
      lane: opt.lane,
      host: hostname(),
      failed: checks.filter((c) => !c.ok).map((c) => c.check),
    },
  }),
);
process.exitCode = ok ? 0 : 1;
