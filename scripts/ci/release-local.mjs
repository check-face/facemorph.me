#!/usr/bin/env node
// npm run release:local — the checks of .github/workflows/release.yml, under the same names, against a local build
// (or a downloaded CI artifact), so a failure seen in CI is fixed and re-checked here in one go (operator, 28 October
// 2026). Every failure is listed at the end with its numbers and its own repro command, as the run summary does.
//
//   npm run release:local                          everything that runs without a live site
//   npm run release:local -- --only timing,engine   checks whose name starts with any of these
//   npm run release:local -- --artifact <dir>       use a downloaded next-site artifact instead of building
//   npm run release:local -- --url <origin>         also the post-switch checks against that live site
//   npm run release:local -- --list                 print the checks and their commands
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCandidateRuntime } from './candidate-runtime.ts';
import { markdown, record } from './failures.mjs';
import { TIMING_SEGMENTS, timingCommands } from './release-checks.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const LAB = join(REPO, 'tools/device-lab');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15); // run.ts refuses an existing label dir

/** The release checks for one artifact, in release.yml's order and names. Pure. */
export function checks({ artifact, runtimeSha, runtimeDir, out, url, control }) {
  const site = join(artifact, 'deploy-next');
  const journeys = (browser, set, list) => ({
    name: `journeys:${browser}:${set}`,
    cwd: LAB,
    cmd: `uv run --quiet --with playwright python hosted.py browser --lane linux-${browser} --browser ${browser} --journey ${list} --artifact ${site} --runtime-sha ${runtimeSha} --out ${join(out, `journeys-${browser}-${set}`)}`,
  });
  const list = [
    ...['chromium', 'firefox'].flatMap((b) => [
      journeys(b, 'faces', 'cold-face,warm-face,morph'),
      journeys(b, 'operated', 'operated'),
    ]),
    // The verify.functional manifest's operated cases, every e2e file it names, on this artifact (release.yml functional).
    {
      name: 'functional',
      cwd: join(REPO, 'apps/web'),
      env: {
        FACEMORPH_DEPLOY_OUT: site,
        FACEMORPH_REQUIRE_RUNTIME: '1',
        FACEMORPH_RUNTIME_DIR: runtimeDir,
      },
      cmd: `node --test --test-concurrency=1 --test-timeout=2400000 $(node --input-type=module -e "import { VERIFY_FUNCTIONAL as m } from './test/verify/cases/verify-functional.ts'; console.log([...new Set(m.cases.map((c) => 'test/e2e/' + c.test.file))].sort().join(' '))")`,
    },
    {
      name: 'engine',
      cwd: REPO,
      env: {
        FACEMORPH_FULL_QUALIFY: '1',
        FACEMORPH_RUNTIME_CACHE: runtimeDir,
        // The regenerated full31 fixtures, where the release's engine job reads them.
        FACEMORPH_FULL31: join(process.env.HOME ?? '', '.cache/facemorph-device-lab/full31'),
      },
      cmd: `node scripts/ci/fetch-full31.mjs --dest ${join(process.env.HOME ?? '', '.cache/facemorph-device-lab/full31')} && node scripts/ci/scaffold-test-shards.mjs --workspace packages/stylegan-js`,
    },
    ...TIMING_SEGMENTS.map((segment) => ({
      name: `timing:${segment}`,
      cwd: REPO,
      cmd: timingCommands({
        segment,
        build: site,
        runtimeDir,
        out: join(out, 'timing'),
        local: true,
        label: `release-local-${segment}-${STAMP}`,
      }).join(' && '),
    })),
    {
      name: 'cells',
      cwd: LAB,
      cmd: `uv run --quiet --with playwright python lab.py matrix --artifact ${artifact} --runtime-sha ${runtimeSha} --journey cold-face,warm-face,morph --label release-local`,
    },
  ];
  if (url)
    list.push(
      {
        name: 'live:check',
        cwd: REPO,
        cmd: `node scripts/delivery/post-delivery-check.mjs --mode app --host ${new URL(url).host}`,
      },
      {
        name: 'live:cells',
        cwd: LAB,
        cmd: `uv run --quiet --with playwright python lab.py matrix --url ${url} --deployed ${artifact} --journey cold-face,warm-face,morph --phone-budgets-from-pairs cold-face,warm-face --label release-local-live`,
      },
      {
        name: 'live:phone-pairs',
        cwd: LAB,
        cmd: `uv run --quiet --with playwright python lab.py matrix --url ${url} --deployed ${artifact} --control-url ${control} --cells phone-cpu,phone-webgpu --journey cold-face,warm-face --label release-local-pairs`,
      },
    );
  return list;
}

function build() {
  const r = spawnSync('npm', ['run', 'build:next'], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('npm run build:next failed');
  const check = spawnSync('npm', ['run', 'build:next', '--', '--check'], {
    cwd: REPO,
    stdio: 'inherit',
  });
  if (check.status !== 0) throw new Error('npm run build:next -- --check failed');
  return REPO; // build-next writes deploy-next/ and its identity files at the repository root
}

if (import.meta.main) {
  const { values: o } = parseArgs({
    options: {
      only: { type: 'string' },
      artifact: { type: 'string' },
      url: { type: 'string' },
      out: { type: 'string', default: join(REPO, '.cache/release-local') },
      list: { type: 'boolean' },
    },
  });
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const runtime = loadCandidateRuntime(REPO);
  const runtimeDir = join(REPO, '.cache/ci-runtime');
  const targets = JSON.parse(
    readFileSync(join(REPO, 'hosting/publish-targets.json'), 'utf8'),
  ).targets;
  const wanted = o.only ? o.only.split(',') : null;
  const planned = (artifact) =>
    checks({
      artifact,
      runtimeSha: runtime.manifestSha256,
      runtimeDir,
      out,
      url: o.url,
      control: targets.control.site.origin,
    }).filter((c) => !wanted || wanted.some((w) => c.name.startsWith(w)));
  if (o.list) {
    for (const c of planned(o.artifact ? resolve(o.artifact) : REPO))
      console.log(`${c.name}\n  (cd ${c.cwd} && ${c.cmd})`);
    process.exit(0);
  }
  if (!existsSync(join(runtimeDir, 'manifest.json')))
    throw new Error(
      `no runtime at ${runtimeDir}: acquire it first: node scripts/runtime/acquire-ci.mjs --inputs import/build-inputs.json --cache .cache/ci-runtime (as setup-runtime does)`,
    );
  const manifest = createHash('sha256')
    .update(readFileSync(join(runtimeDir, 'manifest.json')))
    .digest('hex');
  if (manifest !== runtime.manifestSha256)
    throw new Error(`runtime ${manifest} is not the pinned ${runtime.manifestSha256}`);
  const artifact = o.artifact ? resolve(o.artifact) : build();
  const failures = [];
  for (const c of planned(artifact)) {
    console.log(`\n=== ${c.name}\n$ (cd ${c.cwd} && ${c.cmd})`);
    const started = Date.now();
    const r = spawnSync('bash', ['-o', 'pipefail', '-c', c.cmd], {
      cwd: c.cwd,
      env: { ...process.env, FACEMORPH_RUNTIME_SHA256: manifest, ...c.env },
      stdio: 'inherit',
    });
    const s = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`=== ${c.name}: ${r.status === 0 ? 'ok' : 'FAILED'} in ${s} s`);
    if (r.status !== 0)
      failures.push(
        record({
          check: c.name,
          repro: `npm run release:local -- --only ${c.name}${o.artifact ? ` --artifact ${o.artifact}` : ''}`,
          detail: `exit ${r.status}`,
        }),
      );
  }
  const text = markdown(failures);
  writeFileSync(join(out, 'summary.md'), text);
  console.log(`\n${text}`);
  process.exitCode = failures.length ? 1 : 0;
}
