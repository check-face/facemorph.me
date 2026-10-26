#!/usr/bin/env node
// The site deploy re-homed from classic next-site.yml's deploy job (6107f80) onto this repository (fm-6fx6). Each
// step of .github/workflows/next-deploy.yml is one subcommand, so a local dry run executes exactly the workflow's
// commands (`all`). Targets come from hosting/publish-targets.json; nothing here names a host. Every Cloudflare write
// (`cf`, never Wrangler) is behind --publish and the single-publisher guard (publish-guard.mjs), checked before any
// network call; without --publish the site and mirror deploys are `cf deploy --dry-run` and the warm requests nothing.
//   verify       --artifact <dir>                    the artifact's files equal its next-site-SHA256SUMS
//   runtime      --runtime <dir>                     the acquired runtime set, file by file, and the WebGPU contract
//   stage        --runtime <dir> --artifact <dir> --public <dir>
//                                                    the built-in catalogue, then hosting/next-static/stage.py
//   site-deploy  --target <t> --public <dir> [--publish]
//                                                    guard; record the live version (rollback); cf deploy the site
//   live         --target <t> --public <dir> --artifact <dir>
//                                                    the target serves this build, the historic hello preview and
//                                                    every staged runtime file (read-only)
//   mirror-deploy --target <t> [--publish]           guard; the model-host package's mirror-deploy
//   warm         --target <t> --public <dir> [--publish]
//                                                    the package's warm: every immutable runtime path HEAD 200
//   all          every step above in order
// One JSON line per step on stdout; exit 0 ok, 1 refused or failed, 2 usage.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertMayPublish, loadTargets } from './publish-guard.mjs';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SITE_PROJECT = join(REPO, 'hosting/next-static');
const MODEL_HOST_CLI = join(REPO, 'packages/cloudflare-model-host/dist/cli.js');
const HELLO = join(REPO, 'apps/web/src/public/preview/hello-1024.webp');
export const COMPATIBILITY_DATE = '2026-09-16';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Regular files under dir, relative with '/', sorted. */
export function files(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const p = join(at, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** The staged runtime files the live check reads: every file under runtime/ but directory index pages. Pure. */
export const runtimeFiles = (paths) =>
  paths.filter(
    (p) => p.startsWith('runtime/') && !p.endsWith('/index.html') && p !== 'runtime/index.html',
  );

export function targetConfig(name, config = loadTargets()) {
  const t = config.targets?.[name];
  if (!t) throw Object.assign(new Error(`unknown target ${name}`), { code: 2 });
  return t;
}

const url = (origin, path) =>
  new URL(
    path.split('/').map(encodeURIComponent).join('/'),
    origin.endsWith('/') ? origin : `${origin}/`,
  );

/** Runs `parallel` at a time; returns the failures. */
async function each(items, parallel, fn) {
  const queue = [...items];
  const failed = [];
  await Promise.all(
    Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const r = await fn(item);
        if (r) failed.push(r);
      }
    }),
  );
  return failed.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function verify({ artifact }) {
  const sums = readFileSync(join(artifact, 'next-site-SHA256SUMS'), 'utf8')
    .split('\n')
    .filter(Boolean);
  const bad = [];
  for (const line of sums) {
    const [digest, name] = [line.slice(0, 64), line.slice(66)];
    const p = join(artifact, name);
    if (!existsSync(p) || sha256(readFileSync(p)) !== digest) bad.push(name);
  }
  const listed = new Set(sums.map((l) => l.slice(66)));
  const extra = files(join(artifact, 'deploy-next'))
    .map((p) => `deploy-next/${p}`)
    .filter((p) => !listed.has(p));
  return {
    step: 'verify',
    ok: bad.length === 0 && extra.length === 0 && sums.length > 0,
    files: sums.length,
    bad,
    extra,
  };
}

export async function runtime({ runtime: dir }) {
  const [{ acquiredFindings }, { readJson, BUILD_INPUTS }] = await Promise.all([
    import('../inventory/check-build-inputs.mjs'),
    import('../inventory/lib.mjs'),
  ]);
  const { out, files: count } = acquiredFindings(dir, readJson(BUILD_INPUTS).runtime.assets);
  const contract = spawnSync(
    'python3',
    [join(SITE_PROJECT, 'webgpu_contract.py'), '--runtime', dir],
    {
      encoding: 'utf8',
    },
  );
  return {
    step: 'runtime',
    ok: out.length === 0 && !!count && contract.status === 0,
    files: count,
    findings: out.slice(0, 20),
    manifestSha256: sha256(readFileSync(join(dir, 'manifest.json'))),
    webgpuContract: contract.status === 0 ? 'ok' : (contract.stderr || contract.stdout).trim(),
  };
}

export function stage({ runtime: dir, artifact, public: out, catalogue }) {
  catalogue ??= join(SITE_PROJECT, 'catalogue.json');
  const built = join(artifact, 'deploy-next/catalogue.json');
  // The names index must be the one built into the qualified artifact (promote.py's rule).
  if (!existsSync(built) || !readFileSync(built).equals(readFileSync(catalogue)))
    return {
      step: 'stage',
      ok: false,
      refused: 'catalogue differs from the one built into the artifact',
    };
  const r = spawnSync(
    'python3',
    [
      join(SITE_PROJECT, 'stage.py'),
      '--runtime',
      dir,
      '--frontend',
      join(artifact, 'deploy-next'),
      '--catalogue',
      catalogue,
      '--output',
      out,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return { step: 'stage', ok: false, error: (r.stderr || r.stdout).trim() };
  const staged = files(out);
  return {
    step: 'stage',
    ok: true,
    files: staged.length,
    runtimeFiles: runtimeFiles(staged).length,
  };
}

function cf(args, env, base = process.env, cwd = SITE_PROJECT) {
  const bin = join(REPO, 'node_modules/.bin/cf');
  const r = spawnSync(bin, args, {
    cwd,
    env: { ...base, ...env, CI: '1', CF_SEND_TELEMETRY: 'false' },
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return {
    status: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`,
  };
}

// stage.py writes classic's `/* /index.html 200` _redirects, which Workers Static Assets refuse as an infinite loop
// under the default html handling (API error 100324). Wrangler skipped the invalid rule with a warning, so
// next.facemorph.me has never applied it (an unknown path answers 404 there); leaving the file out serves the same.
export const NOT_UPLOADED = ['_redirects'];

/** Hard-links (else copies) every staged file but NOT_UPLOADED into the build's assets directory. */
function linkTree(from, to) {
  for (const p of files(from)) {
    if (NOT_UPLOADED.includes(p)) continue;
    const dest = join(to, p);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      linkSync(join(from, p), dest);
    } catch {
      copyFileSync(join(from, p), dest);
    }
  }
}

/** The site's environment for cloudflare.config.ts. Pure. */
export function siteEnv(site) {
  return {
    SITE_WORKER: site.worker,
    SITE_COMPATIBILITY_DATE: site.compatibilityDate ?? COMPATIBILITY_DATE,
    ...(site.workersDev ? { SITE_WORKERS_DEV: '1' } : {}),
    ...(site.diagnostics?.bucket ? { SITE_DIAGNOSTICS_BUCKET: site.diagnostics.bucket } : {}),
    ...(site.diagnostics?.namespace
      ? { SITE_DIAGNOSTICS_NAMESPACE: site.diagnostics.namespace }
      : {}),
  };
}

export function siteDeploy({ target, public: dir, publish = false, env = process.env }) {
  const site = publish ? assertMayPublish(target, ['site'], env).site : targetConfig(target).site;
  const environment = siteEnv(site);
  const out = join(SITE_PROJECT, '.cloudflare');
  rmSync(out, { recursive: true, force: true });
  const vite = spawnSync(join(REPO, 'node_modules/.bin/vite'), ['build'], {
    cwd: SITE_PROJECT,
    env: { ...env, ...environment },
    encoding: 'utf8',
  });
  if (vite.status !== 0)
    return { step: 'site-deploy', ok: false, error: (vite.stderr || vite.stdout).trim() };
  const assets = join(out, 'output/v0/workers/default/assets');
  rmSync(assets, { recursive: true, force: true });
  linkTree(resolve(dir), assets);
  // Rollback target: the version serving now (classic: wrangler versions deploy <previous>@100).
  let previous = null;
  if (publish) {
    const list = cf(['workers', 'deployments', 'list', '--worker', site.worker], environment, env);
    const m = /"version_id"\s*:\s*"([0-9a-f-]{36})"/.exec(list.output);
    previous = m ? m[1] : null;
  }
  const r = cf(['deploy', '--prebuilt', ...(publish ? [] : ['--dry-run'])], environment, env);
  const files = /Read (\d+) files? from the assets directory/.exec(r.output)?.[1];
  return {
    step: 'site-deploy',
    ok: r.status === 0,
    published: publish && r.status === 0,
    worker: site.worker,
    cfAssetsRead: files ? Number(files) : null,
    notUploaded: NOT_UPLOADED,
    previousVersion: previous,
    rollback: previous
      ? `cf workers deployments create --worker ${site.worker} --strategy percentage --versions '[{"version_id":"${previous}","percentage":100}]'`
      : null,
    ...(r.status === 0 ? {} : { output: r.output.slice(-4000) }),
  };
}

export async function live({
  target,
  public: dir,
  artifact,
  attempts = 12,
  wait = 15000,
  fetchImpl = fetch,
}) {
  const { origin } = targetConfig(target).site;
  const index = readFileSync(join(artifact, 'deploy-next/index.html'));
  let serving = false;
  for (let i = 0; i < 20 && !serving; i++) {
    try {
      const r = await fetchImpl(url(origin, ''), { cache: 'no-store' });
      serving = r.ok && Buffer.from(await r.arrayBuffer()).equals(index);
    } catch {}
    if (!serving) await sleep(wait / 2.5);
  }
  let hello = false;
  for (let i = 0; i < 5 && !hello; i++) {
    try {
      const r = await fetchImpl(url(origin, 'preview/hello-1024.webp'));
      hello = r.ok && Buffer.from(await r.arrayBuffer()).equals(readFileSync(HELLO));
    } catch {}
    if (!hello) await sleep(wait / 5);
  }
  // Qualification runs before the deploy, against the old origin, so it cannot see a file the new tree left out.
  // New assets take a minute or two to reach every edge after the deploy returns.
  let pending = runtimeFiles(files(dir));
  const total = pending.length;
  let missing = [];
  for (let i = 0; i < attempts; i++) {
    missing = await each(pending, 16, async (path) => {
      try {
        const r = await fetchImpl(url(origin, path), { method: 'HEAD' });
        return r.status === 200 ? null : { path, status: r.status };
      } catch (e) {
        return { path, status: e.message };
      }
    });
    if (!missing.length) break;
    pending = missing.map((m) => m.path);
    if (i < attempts - 1) await sleep(wait);
  }
  return {
    step: 'live',
    ok: serving && hello && missing.length === 0,
    origin,
    servesThisBuild: serving,
    helloPreview: hello,
    runtimeFiles: total,
    missing: missing.slice(0, 50),
    summary: `${total - missing.length} runtime files served`,
  };
}

/** Runs the model-host package's CLI without blocking this process (a local test mirror may be serving here). */
function modelHost(args, env = process.env) {
  if (!existsSync(MODEL_HOST_CLI))
    throw new Error(
      'packages/cloudflare-model-host is not built: npm run build -w packages/cloudflare-model-host',
    );
  return new Promise((done) => {
    const child = spawn(process.execPath, [MODEL_HOST_CLI, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => {
      let report = null;
      try {
        report = JSON.parse(stdout.trim().split('\n').pop());
      } catch {}
      done({ status, report, stderr: stderr.slice(-4000) });
    });
  });
}

export async function mirrorDeploy({ target, publish = false, env = process.env }) {
  const t = publish ? assertMayPublish(target, ['mirror'], env) : targetConfig(target);
  const m = t.mirror;
  const r = await modelHost(
    [
      'mirror-deploy',
      '--worker',
      m.worker,
      '--bucket',
      m.bucket,
      '--upstream',
      t.site.origin,
      '--prefixes',
      m.prefixes,
      '--site',
      t.site.worker,
      ...(m.domain ? ['--domain', m.domain] : []),
      ...(m.workersDev ? ['--workers-dev'] : []),
      ...(publish ? ['--publish'] : []),
    ],
    env,
  );
  return {
    step: 'mirror-deploy',
    ok: r.status === 0,
    worker: m.worker,
    published: r.report?.published ?? false,
    ...(r.status === 0 ? {} : { output: r.stderr }),
  };
}

export async function warm({ target, public: dir, publish = false, env = process.env, config }) {
  const t = publish
    ? assertMayPublish(target, ['mirror'], env, config ?? loadTargets())
    : targetConfig(target, config);
  const r = await modelHost(
    [
      'warm',
      '--root',
      dir,
      '--origin',
      t.mirror.origin,
      '--prefixes',
      t.mirror.prefixes,
      ...(publish ? ['--publish'] : []),
    ],
    env,
  );
  const report = r.report ?? {};
  return {
    step: 'warm',
    ok: r.status === 0 && (report.failed ?? []).length === 0,
    published: report.published ?? false,
    paths: report.paths ?? null,
    held: report.held ?? 0,
    failed: report.failed ?? [{ path: '(warm)', status: r.stderr || 'no report' }],
    summary: report.published
      ? `${report.held} runtime files held by ${report.origin}`
      : `${report.paths} runtime files to warm on ${report.origin} (not requested without --publish)`,
  };
}

const STEPS = ['verify', 'runtime', 'stage', 'site-deploy', 'live', 'mirror-deploy', 'warm'];

async function run(step, v) {
  const o = {
    target: v.target,
    public: v.public,
    artifact: v.artifact,
    runtime: v.runtime,
    publish: v.publish === true,
  };
  if (step === 'verify') return verify(o);
  if (step === 'runtime') return runtime(o);
  if (step === 'stage') return stage(o);
  if (step === 'site-deploy') return siteDeploy(o);
  if (step === 'live') return live(o);
  if (step === 'mirror-deploy') return mirrorDeploy(o);
  if (step === 'warm') return warm(o);
  return null;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      public: { type: 'string' },
      artifact: { type: 'string' },
      runtime: { type: 'string' },
      publish: { type: 'boolean' },
      record: { type: 'string' },
    },
  });
  const step = positionals[0];
  const steps = step === 'all' ? STEPS : [step];
  if (!step || !steps.every((s) => STEPS.includes(s))) {
    console.error(
      `usage: deploy.mjs <${STEPS.join('|')}|all> [--target t] [--public dir] [--artifact dir] [--runtime dir] [--publish]`,
    );
    process.exit(2);
  }
  const records = [];
  let code = 0;
  for (const s of steps) {
    let r;
    try {
      r = await run(s, values);
    } catch (e) {
      r = { step: s, ok: false, refused: e.message, ...(e.report ? { guard: e.report } : {}) };
    }
    records.push({ ...r, at: new Date().toISOString() });
    console.log(JSON.stringify(r));
    if (r.summary) console.error(r.summary);
    if (!r.ok) {
      code = 1;
      break;
    }
  }
  if (values.record)
    writeFileSync(values.record, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.exit(code);
}
