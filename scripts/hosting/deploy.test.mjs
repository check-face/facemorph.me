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
import { runtimeFiles, warm } from './deploy.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const DEPLOY = join(REPO, 'scripts/hosting/deploy.mjs');
const WORKFLOW = readFileSync(join(REPO, '.github/workflows/next-deploy.yml'), 'utf8');
const MAIN = readFileSync(join(REPO, '.github/workflows/main.yml'), 'utf8');
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

test('guard: the classic-owned targets are refused for site and mirror, whatever the variable names', () => {
  for (const name of ['next', 'production'])
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
    site: { worker: 'facemorph-next', origin: 'https://example.invalid/' },
    mirror: {
      worker: 'x',
      bucket: 'facemorph-runtime-mirror',
      origin: 'https://models.facemorph.me/',
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
  assert.ok(r.refused.some((x) => /site facemorph-next of sneaky/.test(x)));
  assert.ok(r.refused.some((x) => /mirror facemorph-runtime-mirror/.test(x)));
  assert.ok(r.refused.some((x) => /mirror models\.facemorph\.me/.test(x)));
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

test('guard: a publish attempt (site or mirror) to a classic-owned target is refused before any network call', () => {
  const at = `http://127.0.0.1:${proxy.address().port}`;
  const home = mkdtempSync(join(tmpdir(), 'guard-'));
  proxied.length = 0;
  for (const step of ['site-deploy', 'mirror-deploy', 'warm'])
    for (const target of ['next', 'production']) {
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
  assert.equal(block[1], 'next-deploy-${{ inputs.target }}');
  assert.equal(block[2], 'false');
  assert.doesNotMatch(
    block[1],
    /github\.(ref|sha|run_id|run_number)/,
    'a second push waits in the same group',
  );
  assert.doesNotMatch(WORKFLOW, /cancel-in-progress: true/);
  // main.yml, the caller, keeps its own single never-cancelling group.
  assert.match(MAIN, /^concurrency:\n {2}group: main\n {2}cancel-in-progress: false$/m);
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
    'Verify the artifact',
    'The acquired runtime set',
    'Stage',
    'Deploy the site',
    'Check the live site',
    'Deploy the runtime mirror',
    'Warm the runtime mirror',
  ];
  const at = order.map((o) => steps.findIndex((s) => s.startsWith(o)));
  assert.ok(
    at.every((i, k) => i > guard && (k === 0 || i > at[k - 1])),
    JSON.stringify(at),
  );
});

test('workflow: the deploy job needs the release gate for the artifact it publishes', () => {
  assert.match(
    WORKFLOW,
    /^ {2}gate:\n(?: {4}.*\n)*? {4}uses: \.\/\.github\/workflows\/release-gate\.yml$/m,
  );
  assert.match(WORKFLOW, /^ {2}deploy:\n {4}needs: gate$/m);
  for (const input of ['artifact_run', 'artifact_name', 'artifact_commit', 'runtime_sha'])
    assert.match(WORKFLOW, new RegExp(`${input}: \\$\\{\\{ inputs\\.${input} \\}\\}`));
  // Publication follows complete qualification of the exact artifact.
  const job = /^ {2}next-deploy:\n((?: {4}.*\n)+)/m.exec(MAIN)?.[1] ?? '';
  assert.match(job, /needs: \[changes, next-site-artifact, next-site, pre-deploy\]/);
  assert.match(
    job,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.dependency_group == '' && vars\.FACEMORPH_DEPLOY_TARGET != '' && needs\.pre-deploy\.result == 'success'/,
  );
  assert.match(job, /uses: \.\/\.github\/workflows\/next-deploy\.yml/);
});
