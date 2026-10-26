#!/usr/bin/env node
// The Cloudflare guide (docs/cloudflare.md) run verbatim against a real account, on disposable test resources
// (fm-19eb). It changes the account: it creates two Workers and an R2 bucket named with a test prefix, and always
// deletes them again, logging every resource it creates and deletes. Not part of `npm test`; run it on a machine
// where `cf` is signed in:
//
//   FACEMORPH_CF_SUBDOMAIN=<account>.workers.dev node packages/cloudflare-model-host/test/cloudflare-guide.live.mjs
//
// From the repository root it packs stylegan-js, browser-model-manager and cloudflare-model-host, installs the
// tarballs in a clean project, links the converted AFHQ cat model (FACEMORPH_AFHQ_CAT, default
// packages/model-conv/out/afhqcat) as ./converted, and runs, in order:
//   - the README quickstart blocks the guide reuses (stage, the terms record);
//   - every guide block (set-origin, run, cloudflare-dry-run, needs-test-origin).
// The only changes to the commands, each logged:
//   - my-model-origin / my-model-mirror become <prefix>-origin / <prefix>-mirror;
//   - your-subdomain.workers.dev becomes FACEMORPH_CF_SUBDOMAIN;
//   - `npx cf auth login` is skipped (the session is signed in).
// Exit 0 when every block succeeded and teardown removed everything; the log is <workdir>/run.log.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SUBDOMAIN = process.env['FACEMORPH_CF_SUBDOMAIN'];
const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
if (!SUBDOMAIN || !/^[a-z0-9-]+\.workers\.dev$/.test(SUBDOMAIN)) {
  console.error('set FACEMORPH_CF_SUBDOMAIN to the account subdomain, e.g. example.workers.dev');
  process.exit(2);
}
if (!existsSync(join(MODEL, 'manifest.json'))) {
  console.error(`no converted model at ${MODEL}`);
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12);
const P = `fmtest-${stamp}`;
const work = mkdtempSync(join(tmpdir(), `${P}-`));
const app = join(work, 'app');
const LOG = join(work, 'run.log');
const log = (line) => {
  const text = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
  console.log(text);
  appendFileSync(LOG, `${text}\n`);
};
const sh = (script, cwd = app, env = {}) => {
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  appendFileSync(LOG, `${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r;
};

/** The fenced sh blocks of a Markdown file with the docs-test annotation on the line before each. */
function blocks(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```sh\s*$/.test(lines[i])) continue;
    const end = lines.findIndex((l, j) => j > i && /^```\s*$/.test(l));
    const kind = /^<!-- docs-test: (\S+)/.exec(lines[i - 1] ?? '')?.[1] ?? '';
    out.push({ kind, code: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return out;
}

const substitute = (code) =>
  code
    .replaceAll('my-model-origin', `${P}-origin`)
    .replaceAll('my-model-mirror', `${P}-mirror`)
    .replaceAll('your-subdomain.workers.dev', SUBDOMAIN)
    .split('\n')
    .filter((l) => l.trim() !== 'npx cf auth login')
    .join('\n');

const created = [];
let failed = false;
function teardown() {
  log('TEARDOWN');
  const cf = join(app, 'node_modules/.bin/cf');
  if (!existsSync(cf)) {
    // cf comes with the installed package; without it nothing could have been created.
    log(
      created.length
        ? `cf missing, cannot remove: ${created.join(', ')}`
        : 'cf not installed: nothing was created',
    );
    return created.length === 0;
  }
  // The mirror first: it holds a service binding to the origin, which blocks deleting the origin.
  for (const w of [`${P}-mirror`, `${P}-origin`]) {
    const r = sh(`"${cf}" workers delete ${w} --force`);
    log(`delete worker ${w}: ${r.status === 0 ? 'deleted' : `failed (${r.status})`}`);
  }
  const listed = sh(`"${cf}" r2 objects list --bucket-name ${P}-mirror --per-page 1000`);
  if (listed.status === 0) {
    const keys = JSON.parse(listed.stdout || '[]').map((o) => o.key);
    if (keys.length) {
      const r = sh(
        `"${cf}" r2 objects bulk-delete --bucket-name ${P}-mirror --body '${JSON.stringify(keys)}' --force`,
      );
      log(
        `delete ${keys.length} mirror object(s): ${r.status === 0 ? 'deleted' : `failed (${r.status})`}`,
      );
    }
    const r = sh(`"${cf}" r2 buckets delete ${P}-mirror --force`);
    log(`delete bucket ${P}-mirror: ${r.status === 0 ? 'deleted' : `failed (${r.status})`}`);
  } else log(`bucket ${P}-mirror: absent`);
  const left = [`${P}-mirror`, `${P}-origin`].filter(
    (w) => sh(`"${cf}" workers get ${w}`).status === 0,
  );
  if (sh(`"${cf}" r2 objects list --bucket-name ${P}-mirror --per-page 1`).status === 0)
    left.push(`bucket ${P}-mirror`);
  log(left.length ? `LEFT BEHIND: ${left.join(', ')}` : 'teardown complete: nothing left');
  return left.length === 0;
}

try {
  log(`prefix ${P}, subdomain ${SUBDOMAIN}, workdir ${work}`);
  const packs = join(work, 'packs');
  mkdirSync(packs, { recursive: true });
  for (const p of ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host'])
    sh(`npm pack -w packages/${p} --pack-destination "${packs}"`, REPO);
  sh(
    `mkdir -p "${app}" && cd "${app}" && npm init -y >/dev/null && npm pkg set type=module && npm install --no-audit --no-fund ${readdirSync(
      packs,
    )
      .map((t) => `"${join(packs, t)}"`)
      .join(' ')}`,
    work,
  );
  symlinkSync(MODEL, join(app, 'converted'));
  const readme = blocks(join(REPO, 'packages/cloudflare-model-host/README.md'));
  const guide = blocks(join(REPO, 'packages/cloudflare-model-host/docs/cloudflare.md'));
  // The quickstart blocks the guide says it reuses: the stage that the terms block reads, and the terms record.
  const prerequisites = readme
    .filter((b) => b.kind === 'run' && /stage --source|terms\.json/.test(b.code))
    .slice(0, 2);
  let env = {};
  for (const b of [...prerequisites, ...guide]) {
    const code = substitute(b.code);
    if (code !== b.code) log(`SUBSTITUTED (${b.kind}):\n${code}`);
    if (b.kind === 'set-origin') {
      env = Object.fromEntries([...code.matchAll(/export (\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
      log(`origins ${JSON.stringify(env)}`);
      continue;
    }
    if (/origin-deploy[\s\S]*--publish/.test(code)) created.push(`worker ${P}-origin`);
    if (/r2 buckets create/.test(code)) created.push(`bucket ${P}-mirror`);
    if (/mirror-deploy[\s\S]*--publish/.test(code)) created.push(`worker ${P}-mirror`);
    log(`RUN (${b.kind})`);
    const r = sh(code, app, env);
    log(`exit ${r.status}: ${(r.stdout || '').trim().split('\n').at(-1)?.slice(0, 300) ?? ''}`);
    if (r.status !== 0) {
      failed = true;
      break;
    }
    // A fresh Workers deployment takes a moment to answer on workers.dev.
    if (/origin-deploy[\s\S]*--publish/.test(code))
      sh(
        `for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$MODEL_ORIGIN/models/my-model-v1/manifest.json")" = 200 ] && exit 0; sleep 5; done; exit 1`,
        app,
        env,
      );
  }
  log(`created: ${created.join(', ') || 'nothing'}`);
} catch (error) {
  failed = true;
  log(`ERROR ${error.message}`);
} finally {
  const clean = teardown();
  log(failed ? 'GUIDE RUN FAILED' : 'GUIDE RUN COMPLETE');
  process.exitCode = failed || !clean ? 1 : 0;
}
