// The re-homed deploy job (fm-6fx6): the single-publisher guard, the warm against a real local test mirror, and the
// workflow's own rules (origin from configuration, concurrency that never cancels a publication, the guard before
// every deploy, the release gate before the deploy job).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, loadTargets } from './publish-guard.mjs';
import { rollback, runtimeFiles, warm } from './deploy.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DEPLOY = join(REPO, 'scripts/hosting/deploy.mjs');
// The deploy step of release.yml (fm-fy2.11): its job, from `  deploy:` to the next job.
const RELEASE = readFileSync(join(REPO, '.github/workflows/release.yml'), 'utf8');
const WORKFLOW = /^ {2}deploy:\n(?:(?: {4}.*)?\n)+/m.exec(RELEASE)?.[0] ?? '';
const config = loadTargets();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

let proxy;
const proxied = [];
before(async () => {
  proxy = createServer((req, res) => {
    proxied.push(`${req.method} ${req.url}`);
    res.writeHead(403).end();
  });
  proxy.on('connect', (req, socket) => {
    proxied.push(`CONNECT ${req.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
});
after(() => proxy.close());

test('guard: the classic-owned target is refused for site and mirror, whatever the variable names', () => {
  for (const name of ['production'])
    for (const kinds of [['site'], ['mirror'], ['site', 'mirror']]) {
      const r = check({ config, name, kinds, allowed: ['next', 'production', 'staging'] });
      assert.equal(r.ok, false);
      assert.ok(
        r.refused.some((x) => /classic-owned/.test(x)),
        JSON.stringify(r),
      );
    }
});

test('guard: a target sharing a classic Worker, bucket or host is refused; the test target only when the variable names it', () => {
  const sneaky = structuredClone(config);
  sneaky.targets.sneaky = {
    classicOwned: false,
    site: { worker: 'x', origin: 'https://facemorph.me/' },
    mirror: {
      worker: 'y',
      bucket: 'z',
      origin: 'https://example.invalid/',
      prefixes: 'runtime/assets/',
    },
  };
  const r = check({
    config: sneaky,
    name: 'sneaky',
    kinds: ['site', 'mirror'],
    allowed: ['sneaky'],
  });
  assert.equal(r.ok, false);
  assert.ok(
    r.refused.some((x) => /site facemorph\.me of sneaky/.test(x)),
    JSON.stringify(r),
  );
  // Before the handover next was classic's: its Worker, bucket and mirror host were refused to everyone else.
  const before = structuredClone(config);
  before.targets.next.classicOwned = true;
  before.targets.sneaky = {
    classicOwned: false,
    site: { worker: 'facemorph-next', origin: 'https://example.invalid/' },
  };
  const pre = check({ config: before, name: 'sneaky', kinds: ['site'], allowed: ['sneaky'] });
  assert.ok(
    pre.refused.some((x) => /site facemorph-next of sneaky/.test(x)),
    JSON.stringify(pre),
  );
  assert.equal(
    check({ config, name: 'staging', kinds: ['site', 'mirror'], allowed: [] }).ok,
    false,
  );
  assert.equal(
    check({ config, name: 'staging', kinds: ['site', 'mirror'], allowed: ['staging'] }).ok,
    true,
  );
  assert.equal(check({ config, name: 'nowhere', kinds: ['site'], allowed: ['nowhere'] }).ok, false);
});

test('guard: since the candidate-source handover next is published here, only when the variable names it', () => {
  for (const kinds of [['site'], ['mirror'], ['site', 'mirror']]) {
    assert.equal(check({ config, name: 'next', kinds, allowed: ['next'] }).ok, true);
    const r = check({ config, name: 'next', kinds, allowed: ['staging'] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.refused, ['FACEMORPH_PUBLISH_TARGETS does not name next']);
  }
  // production's future Worker (promotionWorker) is not a classic identity; facemorph.me's host still is.
  assert.equal(config.targets.production.classicOwned, true);
  assert.equal(config.targets.production.site.worker, undefined);
});

test('guard: a publish attempt (site or mirror) to a classic-owned target is refused before any network call', () => {
  const at = `http://127.0.0.1:${proxy.address().port}`;
  const home = mkdtempSync(join(tmpdir(), 'guard-'));
  proxied.length = 0;
  for (const step of ['site-deploy', 'mirror-deploy', 'warm'])
    for (const target of ['production']) {
      const r = spawnSync(
        process.execPath,
        [DEPLOY, step, '--target', target, '--public', home, '--publish'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            FACEMORPH_PUBLISH_TARGETS: 'next,production,staging',
            // No credentials: and any request that did go out would be recorded by the refusing proxy.
            CLOUDFLARE_API_TOKEN: '',
            HTTP_PROXY: at,
            HTTPS_PROXY: at,
            http_proxy: at,
            https_proxy: at,
            NO_PROXY: '',
            NODE_USE_ENV_PROXY: '1',
            PATH: '/nonexistent', // cf, vite, gh and curl cannot even be found
          },
        },
      );
      assert.equal(r.status, 1, `${step} ${target}: ${r.stderr}`);
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.equal(out.ok, false);
      assert.match(out.refused, /publish refused: .*classic-owned/);
    }
  assert.deepEqual(proxied, []);
  rmSync(home, { recursive: true, force: true });
});

/** A staged public/ tree: immutable runtime paths, a mutable manifest pointer and a notices page. */
function stagedTree() {
  const root = mkdtempSync(join(tmpdir(), 'warm-'));
  const put = (p, d) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), d);
  };
  const assets = ['a', 'b', 'c'].map((x) => {
    const b = Buffer.from(`asset ${x}`);
    return `runtime/assets/${sha256(b)}/${x}.bin`;
  });
  const chunks = ['1', '2'].map((x) => `runtime/chunks/${sha256(Buffer.from(x))}.bin`);
  const manifests = [`runtime/manifests/${sha256(Buffer.from('m'))}.json`];
  for (const p of [...assets, ...chunks, ...manifests]) put(p, p);
  // The manifest names every immutable runtime path by its URL.
  const manifest = {
    assets: [...assets, ...manifests].map((p) => ({ url: `https://site.invalid/${p}` })),
    chunks: chunks.map((p) => ({ url: `https://site.invalid/${p}` })),
  };
  put('runtime/manifest.json', JSON.stringify(manifest));
  put('runtime/notices/index.html', 'notices');
  put('index.html', 'app');
  return { root, manifest, immutable: [...assets, ...chunks, ...manifests] };
}

async function mirror(holds) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(holds.has(decodeURIComponent(req.url.slice(1))) ? 200 : 404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, origin: `http://127.0.0.1:${server.address().port}/` };
}

const probeConfig = (origin) => ({
  targets: {
    probe: {
      classicOwned: false,
      site: { worker: 'probe-site', origin: 'http://127.0.0.1:1/' },
      mirror: {
        worker: 'probe-mirror',
        bucket: 'probe',
        origin,
        prefixes: config.targets.staging.mirror.prefixes,
      },
    },
  },
});

test("warm: all present exits 0 and prints the held count, equal to the manifest's immutable runtime path count", async () => {
  const t = stagedTree();
  const m = await mirror(new Set(t.immutable));
  const r = await warm({
    target: 'probe',
    public: t.root,
    publish: true,
    env: { ...process.env, FACEMORPH_PUBLISH_TARGETS: 'probe' },
    config: probeConfig(m.origin),
  });
  const named = [...t.manifest.assets, ...t.manifest.chunks].map((a) =>
    new URL(a.url).pathname.slice(1),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.held, named.length);
  assert.equal(r.paths, named.length);
  assert.equal(r.summary, `${named.length} runtime files held by ${m.origin}`);
  // Only immutable prefixes are requested, with HEAD: never the mutable manifest pointer or the notices page.
  assert.ok(
    m.seen.every((s) => s.startsWith('HEAD /runtime/') && !/manifest\.json|notices/.test(s)),
  );
  assert.deepEqual(runtimeFiles(['runtime/notices/index.html', 'runtime/a.bin', 'index.html']), [
    'runtime/a.bin',
  ]);
  m.server.close();
  rmSync(t.root, { recursive: true, force: true });
});

test('warm: a test mirror missing one path fails the job naming that path', async () => {
  const t = stagedTree();
  const missing = t.immutable[3];
  const m = await mirror(new Set(t.immutable.filter((p) => p !== missing)));
  const r = await warm({
    target: 'probe',
    public: t.root,
    publish: true,
    env: { ...process.env, FACEMORPH_PUBLISH_TARGETS: 'probe' },
    config: probeConfig(m.origin),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, [{ path: missing, status: 404 }]);
  assert.equal(r.held, t.immutable.length - 1);
  m.server.close();
  rmSync(t.root, { recursive: true, force: true });
});

test('warm: without --publish nothing is requested', async () => {
  const t = stagedTree();
  const m = await mirror(new Set());
  const r = await warm({
    target: 'probe',
    public: t.root,
    env: process.env,
    config: probeConfig(m.origin),
  });
  assert.equal(r.ok, true);
  assert.equal(r.published, false);
  assert.equal(r.paths, t.immutable.length);
  assert.deepEqual(m.seen, []);
  m.server.close();
  rmSync(t.root, { recursive: true, force: true });
});

const steps = [...WORKFLOW.matchAll(/^ {6}- (?:name: (.*)|uses: (.*))$/gm)].map(
  (m) => m[1] ?? m[2],
);
const runOf = (name) => {
  const at = WORKFLOW.indexOf(`- name: ${name}`);
  const end = WORKFLOW.indexOf('\n      - ', at + 1);
  return WORKFLOW.slice(at, end === -1 ? undefined : end);
};

test('workflow: the mirror origin comes from configuration (no literal model host in the workflow)', () => {
  assert.doesNotMatch(WORKFLOW, /models\.facemorph\.me/);
  assert.doesNotMatch(
    WORKFLOW.replace(/^\s*#.*$/gm, ''),
    /https?:\/\//,
    'no origin outside comments',
  );
  assert.match(
    runOf('Warm the runtime mirror with every immutable runtime file'),
    /deploy\.mjs warm --target "\$TARGET"/,
  );
});

test('workflow: concurrency, one fixed group per target that never cancels a publication in progress', () => {
  const block = /^ {4}concurrency:\n {6}group: (.*)\n {6}cancel-in-progress: (.*)$/m.exec(WORKFLOW);
  assert.ok(block, 'the deploy job has a concurrency block');
  // A push deploys to next (operator, 28 October 2026); a dispatch names its target.
  assert.equal(block[1], "deploy-${{ (inputs.target || 'next') }}");
  assert.equal(block[2], 'false');
  assert.doesNotMatch(
    block[1],
    /github\.(ref|sha|run_id|run_number)/,
    'a second push waits in the same group',
  );
  assert.doesNotMatch(WORKFLOW, /cancel-in-progress: true/);
  assert.match(RELEASE, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('workflow: the guard runs before any network step; every deploy runs through deploy.mjs behind it', () => {
  const guard = steps.indexOf('Single-publisher guard, site and mirror, before any network call');
  assert.ok(
    guard >= 0 && steps.slice(0, guard).every((s) => s === 'actions/checkout@v4'),
    steps.join(' | '),
  );
  assert.match(runOf(steps[guard]), /publish-guard\.mjs --target "\$TARGET" --kind site,mirror/);
  assert.doesNotMatch(
    WORKFLOW,
    /wrangler|cf deploy/,
    'cf runs only inside deploy.mjs, after its own guard',
  );
  const order = [
    'The artifact is the one built',
    'The runtime set',
    'Stage',
    // The mirror only adds immutable files: it goes first, so the previous build keeps working (the warmed rollback).
    'Deploy the runtime mirror',
    'Warm the runtime mirror',
    'Deploy the site',
    'The live site serves',
  ];
  const at = order.map((o) => steps.findIndex((s) => s.startsWith(o)));
  assert.ok(
    at.every((i, k) => i > guard && (k === 0 || i > at[k - 1])),
    JSON.stringify(at),
  );
});

test('workflow: the deploy step needs every qualifying job and publishes only the digest built in this run', () => {
  // The go/no-go (journeys, engine, timing) gates the switch (operator, 28 October 2026).
  assert.match(WORKFLOW, /^ {4}needs: \[build, gate\]$/m);
  assert.match(
    RELEASE,
    /^ {2}gate:\n {4}needs: \[build, checked, journeys, engine, timing-gate, timing-final\]$/m,
  );
  const verify = runOf('The artifact is the one built in this run and qualified above');
  // This run's build, or (site=promote) the digest the promoted green run recorded; nothing else is deployable.
  assert.match(
    verify,
    /DIGEST: \$\{\{ \(inputs\.site \|\| 'candidate'\) == 'promote' && inputs\.promote_digest \|\| needs\.build\.outputs\.digest \}\}/,
  );
  assert.match(verify, /test "\$got" = "\$DIGEST"/);
  assert.match(verify, /deploy\.mjs verify --artifact web/);
  // Unticked publish is the dry run: every step runs and deploy.mjs publishes nothing without --publish.
  assert.match(
    WORKFLOW,
    /PUBLISH: \$\{\{ \(inputs\.publish \|\| github\.event_name == 'push'\) && '--publish' \|\| '' \}\}/,
  );
});

test('rollback: needs a version id; without --publish it only names the command; publishing goes through the guard', () => {
  assert.equal(rollback({ target: 'staging', version: 'latest' }).ok, false);
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  const dry = rollback({ target: 'staging', version: id });
  assert.equal(dry.published, false);
  assert.match(
    dry.command,
    /workers deployments create --worker facemorph-next-staging --strategy percentage/,
  );
  assert.throws(() =>
    rollback({
      target: 'next',
      version: id,
      publish: true,
      env: { FACEMORPH_PUBLISH_TARGETS: 'staging' },
    }),
  );
});

test('release: every push to main deploys to next behind check.yml; a broken next rolls back on its own', () => {
  // Operator, 28 October 2026: push deploys to next; fail forward or roll back is the agent's call, and a site
  // that fails its post-delivery check goes back to the version the deploy replaced.
  assert.match(RELEASE, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(
    RELEASE,
    /gh run list -R "\$GITHUB_REPOSITORY" -w check\.yml --commit "\$GITHUB_SHA"/,
  );
  assert.match(RELEASE, /broken: \$\{\{ steps\.delivery\.outcome == 'failure' \}\}/);
  assert.match(
    RELEASE,
    /needs\.verify\.outputs\.broken == 'true' && needs\.deploy\.outputs\.previous != ''/,
  );
  assert.match(RELEASE, /previous=\$\{r\.published \? r\.previousVersion \?\? "" : ""\}/);
});
