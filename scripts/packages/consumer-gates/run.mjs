#!/usr/bin/env node
// Package consumer gates (fm-7ge). Builds and packs the four workspace packages, installs the tarballs into a fresh
// project outside the workspace (mkdtemp: no workspace links, no path aliases, no Vite config of the app's), then:
//   1 packed    per package: the tarball content scan (scripts/packages/check-tarball-contents.mjs; reported, and
//               blocking only with --strict-scan, except required-file findings, which wait on fm-oagi's LICENSE
//               and notices), every module reference
//               in the shipped code (packed-imports.mjs: no repository alias, no path out of the package, no
//               undeclared dependency), every `exports` target present, and every subpath imported by Node from
//               the consumer; the consumer type-checks against the declarations only (consumer/ plus fm-hwh's
//               tests/external-consumer/consumer/src, and an import of every subpath), as run.mjs there asserts.
//   2 bundler   Vite (rolldown) builds consumer/bundle: stylegan-js's explicit worker entry points (serveEngine in a
//               consumer-owned worker, connectEngine on the page) must come out as a separate worker chunk, and
//               the manager's browser entry must bundle. Packages' own `new URL(.., import.meta.url)` assets are
//               listed per package; none emits a worker file today, and the report says so.
//   3 sandbox   each subpath imported in sandbox.mjs: no I/O, no scheduling, no global or built-in changes.
//   4 boundary  boundaries.mjs over the repository's package sources.
//   5 host      cloudflare-model-host's installed bin: usage error exits 2, `stage --dry-run` writes nothing,
//               `stage` then `verify` pass on a planted bundle; its declarations compile (consumer/node).
//   6 blend     blend, clampWeight, latentDigest exported by the installed stylegan-js and working (smoke.mjs),
//               when src/index.ts exports ./blend/blend.ts.
//   7 cache     createModelCache, createBrowserModelCache, createShardStore, openShardStore, Sha256 and cache.local
//               from the installed browser-model-manager, typed (consumer/browser/manager-cache.ts) and working.
//   model-conv  has no JavaScript: its tarball must declare no JS entry (main/module/exports/bin/types), carry no
//               JS/TS code, no __pycache__ or .pyc, every `files` entry, and Python that parses.
//   node scripts/packages/consumer-gates/run.mjs [--skip-build] [--keep] [--strict-scan] [--report <file>]
// One JSON line per gate and a final summary; exit 0 when every gate passes, 1 otherwise.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile, scanInput } from '../check-tarball-contents.mjs';
import { references } from './ast.mjs';
import { checkBoundaries } from './boundaries.mjs';
import { checkPackedImports, exportEntries, missingExportTargets } from './packed-imports.mjs';
import { sandboxImport, verdict } from './sandbox.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../../..');
export const PACKAGES = [
  { dir: 'packages/stylegan-js', profile: 'stylegan-js', build: true },
  { dir: 'packages/browser-model-manager', profile: 'browser-model-manager', build: true },
  { dir: 'packages/cloudflare-model-host', profile: 'cloudflare-model-host', build: true },
  { dir: 'packages/model-conv', profile: null, build: false },
];
const PROVISIONAL_RULES = new Set(['required-file']); // LICENSE, notices, provenance: fm-oagi

const sh = (cmd, args, cwd, opts = {}) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
    ...opts,
  });

/** npm pack one directory (a workspace or a planted package) into `dest`; the tarball path. */
export function pack(dir, dest) {
  const out = JSON.parse(sh('npm', ['pack', '--json', '--pack-destination', dest], dir));
  return join(dest, out[0].filename);
}

/** A fresh consumer project at `dir` with the tarballs (and extra registry packages) installed. */
export function installConsumer(dir, tarballs, extra = []) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'facemorph-package-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  sh(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefer-offline',
      '--no-package-lock',
      ...tarballs,
      ...extra,
    ],
    dir,
  );
}

/** Gates 1 and 3 for one installed JS package: references, export targets, Node resolution, sandbox. */
export function gateInstalledPackage({ consumer, name }) {
  const dir = join(consumer, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const imports = checkPackedImports({ dir, pkg });
  const targets = missingExportTargets({ dir, pkg });
  const subpaths = [...new Set(exportEntries(pkg).map((e) => e.subpath))];
  const entries = subpaths.map((subpath) => {
    const specifier = subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`;
    const r = sandboxImport({ cwd: consumer, specifier });
    return {
      specifier,
      loaded: r.loaded,
      exports: r.exportNames.length,
      exportNames: r.exportNames,
      problems: verdict(r),
    };
  });
  const failures = [
    ...imports.findings.map((f) => `${f.rule}: ${f.file}:${f.line} ${f.spec} (${f.detail})`),
    ...targets.missing.map(
      (m) => `missing export target: ${m.subpath} [${m.conditions}] ${m.target}`,
    ),
    ...entries.filter((e) => !e.loaded).map((e) => `${e.specifier} did not load`),
    ...(subpaths.length ? [] : ['no exports entries']),
  ];
  const sideEffects = entries.flatMap((e) =>
    e.problems.filter((p) => !p.startsWith('did not load')).map((p) => `${e.specifier}: ${p}`),
  );
  return {
    name,
    scanned: imports.scanned.length,
    findings: imports.findings,
    unpackedConditions: targets.unpackedConditions,
    entries,
    failures,
    sideEffects,
    ok: failures.length === 0 && sideEffects.length === 0,
  };
}

const emit = (o) => console.log(JSON.stringify(o));
const sha = (b) => createHash('sha256').update(b).digest('hex');

function plantBundle(dir) {
  const put = (rel, text) => {
    const b = Buffer.from(text);
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), b);
    return { file: rel, sha256: sha(b), size: b.length };
  };
  const noise = put('assets/n/noise0.f32', 'noise '.repeat(512));
  const manifest = {
    schemaVersion: 1,
    bundleVersion: 'consumer-gate-v1',
    modelSourceSha256: 'a'.repeat(64),
    noiseSha256: sha(Buffer.from(noise.sha256)),
    mapping: put('assets/m/mapping.onnx', 'mapping '.repeat(128)),
    synthesis: put('assets/s/synthesis.onnx', 'synthesis '.repeat(256)),
    noise: [{ ...noise, name: 'noise0', shape: [1, 1, 4, 4] }],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
}

function hostBin(consumer, work) {
  const bin = join(consumer, 'node_modules/.bin/facemorph-model-host');
  const base = 'https://models.example.org/runtime';
  const source = join(work, 'host-source');
  const out = join(work, 'host-staged');
  plantBundle(source);
  const runBin = (args) => {
    const r = spawnSync(bin, args, { cwd: consumer, encoding: 'utf8' });
    let report = null;
    try {
      report = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
    } catch {
      /* not one JSON report */
    }
    return { status: r.status, report, stderr: r.stderr.trim().slice(-500) };
  };
  const checks = [];
  const usage = runBin(['no-such-command']);
  checks.push({ step: 'usage error', ok: usage.status === 2, status: usage.status });
  const dry = runBin(['stage', '--source', source, '--out', out, '--base', base, '--dry-run']);
  checks.push({
    step: 'stage --dry-run',
    ok: dry.status === 0 && dry.report !== null && !existsSync(join(out, 'manifest.json')),
    status: dry.status,
    wrote: existsSync(out) ? readdirSync(out) : [],
    stderr: dry.stderr || undefined,
  });
  const staged = runBin(['stage', '--source', source, '--out', out, '--base', base]);
  checks.push({
    step: 'stage',
    ok: staged.status === 0 && existsSync(join(out, 'manifest.json')),
    status: staged.status,
    stderr: staged.stderr || undefined,
  });
  const verified = runBin(['verify', '--root', out, '--base', base]);
  checks.push({
    step: 'verify',
    ok: verified.status === 0 && verified.report?.ok === true,
    status: verified.status,
    findings: verified.report?.findings,
    stderr: verified.stderr || undefined,
  });
  return checks;
}

function modelConv(tarball, consumer) {
  const listed = sh('tar', ['-tzf', tarball], ROOT)
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^package\//, ''));
  const dir = join(consumer, 'node_modules/@facemorph/model-conv');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const failures = [];
  for (const k of ['main', 'module', 'exports', 'bin', 'types', 'typings', 'browser'])
    if (pkg[k] !== undefined) failures.push(`declares ${k} but the package has no JavaScript`);
  for (const p of listed) {
    if (/\.(?:[cm]?[jt]sx?)$/.test(p)) failures.push(`JS/TS code in the tarball: ${p}`);
    if (/(?:^|\/)__pycache__\/|\.py[co]$/.test(p))
      failures.push(`Python bytecode in the tarball: ${p}`);
  }
  // A negated entry (`!**/__pycache__`) excludes; the bytecode check above covers it.
  for (const f of (pkg.files ?? []).filter((x) => !x.startsWith('!')))
    if (!listed.some((p) => p === f || p.startsWith(`${f}/`)))
      failures.push(`files entry ${f} is not packed`);
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  let parsed = 'skipped: python3 not found';
  const py = listed.filter((p) => p.endsWith('.py')).map((p) => join(dir, p));
  if (python.status === 0) {
    const r = spawnSync(
      'python3',
      [
        '-I',
        '-c',
        'import ast,sys\nfor f in sys.argv[1:]:\n  ast.parse(open(f,"rb").read(),f)',
        ...py,
      ],
      { encoding: 'utf8' },
    );
    parsed = r.status === 0 ? `${py.length} files parse` : `parse failure: ${r.stderr.trim()}`;
    if (r.status !== 0) failures.push(parsed);
  }
  const imported = sandboxImport({ cwd: consumer, specifier: '@facemorph/model-conv' });
  if (imported.loaded) failures.push('@facemorph/model-conv imports as JavaScript');
  return { files: listed.length, python: parsed, importRefused: !imported.loaded, failures };
}

async function bundle(consumer, work) {
  const { build } = await import('vite');
  const root = join(consumer, 'bundle');
  const outDir = join(work, 'bundle-out');
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    worker: { format: 'es' },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      modulePreload: false,
      rolldownOptions: {
        input: { main: join(root, 'main.js'), manager: join(root, 'manager.js') },
        preserveEntrySignatures: 'exports-only',
      },
    },
  });
  const files = [];
  const walk = (d, rel = '') => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), p);
      else files.push(p);
    }
  };
  walk(outDir);
  const read = (f) => readFileSync(join(outDir, f), 'utf8');
  const MARK = 'a worker message is a plain object';
  const worker = files.find((f) => /engine-worker[^/]*\.js$/.test(f));
  const main = files.find((f) => /(?:^|\/)main[^/]*\.js$/.test(f));
  const manager = files.find((f) => /(?:^|\/)manager[^/]*\.js$/.test(f));
  const checks = {
    workerChunk: Boolean(worker),
    workerHasServeEngine: Boolean(worker && read(worker).includes(MARK)),
    mainReferencesWorker: Boolean(worker && main && read(main).includes(worker.split('/').pop())),
    managerBundled: Boolean(manager && read(manager).includes('checkface-model-blobs-v1')),
  };
  return { files, worker, checks, ok: Object.values(checks).every(Boolean) };
}

async function main(argv) {
  const skipBuild = argv.includes('--skip-build');
  const keep = argv.includes('--keep');
  const strictScan = argv.includes('--strict-scan');
  const ri = argv.indexOf('--report');
  const reportPath = ri >= 0 ? resolve(argv[ri + 1]) : null;
  const results = {};
  const fail = [];
  const gate = (name, ok, detail) => {
    results[name] = { ok, ...detail };
    emit({ event: 'package-consumer-gate', gate: name, ok, ...detail });
    if (!ok) fail.push(name);
  };

  if (!skipBuild)
    for (const p of PACKAGES.filter((x) => x.build)) sh('npm', ['run', 'build', '-w', p.dir], ROOT);

  const work = mkdtempSync(join(tmpdir(), 'facemorph-consumer-gates-'));
  try {
    const packs = join(work, 'packs');
    mkdirSync(packs);
    const tarballs = PACKAGES.map((p) => ({ ...p, tarball: pack(join(ROOT, p.dir), packs) }));
    for (const t of tarballs) {
      const pkg = JSON.parse(readFileSync(join(ROOT, t.dir, 'package.json'), 'utf8'));
      t.name = pkg.name;
      if (!t.profile) continue;
      const scan = scanInput({ profile: loadProfile(t.profile), input: t.tarball });
      const blocking = scan.findings.filter((f) => !PROVISIONAL_RULES.has(f.rule));
      // Advisory unless --strict-scan: the scan's profiles belong to fm-1jr7/fm-3osh, and today they flag names
      // the packages keep on purpose (checkface-* storage keys, the manager's ORT adapter). Reported either way.
      gate(`scan:${t.name}`, strictScan ? blocking.length === 0 : true, {
        advisory: !strictScan,
        clean: blocking.length === 0,
        files: scan.files.length,
        blocking,
        provisional: scan.findings.filter((f) => PROVISIONAL_RULES.has(f.rule)).map((f) => f.path),
      });
    }

    const consumer = join(work, 'consumer');
    const repoVersion = (p) =>
      JSON.parse(readFileSync(join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version;
    installConsumer(
      consumer,
      tarballs.map((t) => t.tarball),
      [`typescript@${repoVersion('typescript')}`, `@types/node@${repoVersion('@types/node')}`],
    );

    const js = tarballs.filter((t) => t.profile);
    const installed = {};
    for (const t of js) {
      const r = gateInstalledPackage({ consumer, name: t.name });
      installed[t.name] = r;
      gate(`packed:${t.name}`, r.failures.length === 0, {
        scanned: r.scanned,
        entries: r.entries.map((e) => ({
          specifier: e.specifier,
          loaded: e.loaded,
          exports: e.exports,
        })),
        unpackedConditions: r.unpackedConditions.map(
          (u) => `${u.subpath} [${u.conditions}] ${u.target}`,
        ),
        failures: r.failures,
      });
      gate(`sandbox:${t.name}`, r.sideEffects.length === 0, {
        entries: r.entries.map((e) => e.specifier),
        problems: r.sideEffects,
      });
    }

    // Declarations: consumer sources, fm-hwh's external consumer, and an import of every subpath.
    cpSync(join(here, 'consumer'), consumer, { recursive: true });
    cpSync(join(ROOT, 'tests/external-consumer/consumer/src'), join(consumer, 'external'), {
      recursive: true,
    });
    mkdirSync(join(consumer, 'generated'), { recursive: true });
    const everySubpath = (names) =>
      names
        .flatMap((n) => installed[n].entries.map((e) => e.specifier))
        .map((s, i) => `import * as e${i} from '${s}';\nexport { e${i} };\n`)
        .join('');
    writeFileSync(
      join(consumer, 'generated/browser-exports.ts'),
      everySubpath(['@facemorph/stylegan-js', '@facemorph/browser-model-manager']),
    );
    writeFileSync(
      join(consumer, 'generated/node-exports.ts'),
      everySubpath(['@facemorph/cloudflare-model-host']),
    );
    const tsc = join(consumer, 'node_modules/.bin/tsc');
    for (const config of ['tsconfig.json', 'tsconfig.node.json']) {
      const r = spawnSync(tsc, ['-p', config], { cwd: consumer, encoding: 'utf8' });
      const listed = spawnSync(tsc, ['-p', config, '--listFilesOnly'], {
        cwd: consumer,
        encoding: 'utf8',
      }).stdout.split('\n');
      const ours = listed.filter((f) => f.includes('/node_modules/@facemorph/'));
      const sources = ours.filter((f) => !f.endsWith('.d.ts'));
      gate(`types:${config}`, r.status === 0 && ours.length > 0 && sources.length === 0, {
        declarations: ours.length,
        sources,
        errors: r.status === 0 ? [] : (r.stdout + r.stderr).trim().split('\n').slice(0, 30),
      });
    }

    const b = await bundle(consumer, work).catch((e) => ({
      ok: false,
      error: String(e?.stack ?? e).slice(0, 2000),
    }));
    gate('bundler:vite', b.ok, {
      ...b,
      packageWorkerAssets: Object.fromEntries(
        js.map((t) => [
          t.name,
          installed[t.name].findings.length
            ? 'see packed findings'
            : workerAssets(join(consumer, 'node_modules', t.name)),
        ]),
      ),
    });

    const smoke = spawnSync(process.execPath, ['smoke.mjs'], { cwd: consumer, encoding: 'utf8' });
    let smokeReport = null;
    try {
      smokeReport = JSON.parse(smoke.stdout.trim().split('\n').pop());
    } catch {
      /* reported below */
    }
    const sgExports = new Set(installed['@facemorph/stylegan-js'].entries[0]?.exportNames ?? []);
    const blendExported = /export \* from '\.\/blend\/blend\.ts'/.test(
      readFileSync(join(ROOT, 'packages/stylegan-js/src/index.ts'), 'utf8'),
    );
    const blendNames = ['blend', 'clampWeight', 'latentDigest'];
    gate(
      'blend:@facemorph/stylegan-js',
      !blendExported ||
        (blendNames.every((n) => sgExports.has(n)) &&
          smokeReport?.checks?.blend === true &&
          smokeReport.checks.clampWeight &&
          smokeReport.checks.latentDigest),
      {
        indexExportsBlend: blendExported,
        missing: blendNames.filter((n) => !sgExports.has(n)),
        smoke: smokeReport?.checks ?? smoke.stderr.trim().slice(-1000),
      },
    );
    const bmmExports = new Set(
      installed['@facemorph/browser-model-manager'].entries[0]?.exportNames ?? [],
    );
    const cacheNames = [
      'createModelCache',
      'createBrowserModelCache',
      'createShardStore',
      'openShardStore',
      'Sha256',
    ];
    gate(
      'cache:@facemorph/browser-model-manager',
      cacheNames.every((n) => bmmExports.has(n)) &&
        smokeReport?.checks?.cacheLocal === true &&
        smokeReport.checks.sha256 === true,
      {
        missing: cacheNames.filter((n) => !bmmExports.has(n)),
        smoke: smokeReport?.checks,
      },
    );

    const host = hostBin(consumer, work);
    gate(
      'host-bin:@facemorph/cloudflare-model-host',
      host.every((c) => c.ok),
      { checks: host },
    );

    const mc = modelConv(tarballs.find((t) => t.dir === 'packages/model-conv').tarball, consumer);
    gate('packed:@facemorph/model-conv', mc.failures.length === 0, mc);

    const bnd = checkBoundaries({ root: ROOT });
    gate('boundaries', bnd.findings.length === 0, bnd);

    if (keep) emit({ event: 'package-consumer-gates-workdir', work });
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
  const summary = { event: 'package-consumer-gates', ok: fail.length === 0, failed: fail };
  emit(summary);
  if (reportPath)
    writeFileSync(reportPath, `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  return fail.length === 0 ? 0 : 1;
}

/** The `new URL('<literal>', import.meta.url)` assets (emitted workers included) a package's shipped JS references. */
function workerAssets(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory() && e.name !== 'node_modules') walk(p);
      else if (/\.[cm]?js$/.test(e.name))
        for (const r of references(p, readFileSync(p, 'utf8')))
          if (r.kind === 'asset-url') out.push(`${p.slice(dir.length + 1)} -> ${r.spec}`);
    }
  };
  walk(dir);
  return out.length ? out : 'none: the package emits no worker or asset file';
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
