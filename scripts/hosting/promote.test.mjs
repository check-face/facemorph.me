// hosting/next-static/promote.py fails closed (fm-6fx6). Each case runs the real script against a planted qualified
// artifact with every external boundary intercepted: `gh`, `cf`, `npx`, `wrangler` and `curl` are recording stubs on
// PATH (gh serves the planted runs), and HTTP(S)_PROXY points at a recording proxy that refuses everything, so any
// request that bypassed the stubs would be recorded too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const PROMOTE = join(REPO, 'hosting/next-static/promote.py');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const SHA = 'c0ffee'.padEnd(40, '0');
const RUN = 4242;
const CANDIDATE = 'mobile-boundary-bounded-phone';
const SOURCE_HASH = 'ab'.repeat(32);
const PUBLISH_HOSTS = /https?:\/\/[^"]*(cloudflare|workers\.dev|facemorph\.me)/;
const gates = (names) => names.map((name) => ({ name, conclusion: 'success' }));
const LEGACY_MAIN_GATES = gates([
  'next-site / artifact',
  'next-site / compiled-ui',
  'next-site / qualify / real-ui-cpu',
]);
const SPLIT_MAIN_GATES = gates([
  'next-site-artifact / artifact',
  'next-site / compiled-ui',
  'next-site / qualify / real-ui-cpu',
]);
const SPLIT_CANDIDATE_GATES = gates([
  'artifact / artifact',
  'qualify / compiled-ui',
  'qualify / qualify / real-ui-cpu',
]);

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

const put = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

/** A planted qualified artifact, its qualification, a runtime and a ledger; returns the paths. */
function plant({
  kernel = {},
  ledgerRows,
  catalogue = '{"names":[]}',
  jobs = LEGACY_MAIN_GATES,
  workflow = '.github/workflows/main.yml',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'promote-'));
  const web = join(root, 'fixtures/web');
  put(join(web, 'deploy-next/index.html'), '<!doctype html><title>FaceMorph</title>');
  put(join(web, 'deploy-next/catalogue.json'), '{"names":[]}');
  const sums = ['deploy-next/catalogue.json', 'deploy-next/index.html']
    .map((p) => `${sha256(readFileSync(join(web, p)))}  ${p}`)
    .join('\n');
  put(join(web, 'next-site-SHA256SUMS'), sums + '\n');
  put(join(web, 'next-site-source.txt'), SHA + '\n');
  const runtime = join(root, 'runtime');
  const asset = Buffer.from('immutable runtime bytes');
  put(join(runtime, `assets/${sha256(asset)}/model.bin`), asset);
  const manifest = Buffer.from(
    JSON.stringify({
      assets: [
        {
          url: `https://h/runtime/assets/${sha256(asset)}/model.bin`,
          sha256: sha256(asset),
          size: asset.length,
        },
      ],
      kernel: {
        file: 'k.mjs',
        sha256: 'cd'.repeat(32),
        candidateId: CANDIDATE,
        sourceHash: SOURCE_HASH,
        ...kernel,
      },
    }),
  );
  put(join(runtime, 'manifest.json'), manifest);
  const proof = join(root, 'fixtures/proof');
  const checks = Object.fromEntries(
    [
      'nameSeed',
      'repeatOriginal',
      'syntheticPhotoE4e',
      'localCrop',
      'morphPlayableMp4',
      'routeRejectionNamed',
    ].map((k) => [k, { passed: true }]),
  );
  checks.projectSaveReopen = { shipped: false };
  put(
    join(proof, 'report.json'),
    JSON.stringify({ passed: true, checks, runtimeSha256: sha256(manifest) }),
  );
  put(join(proof, 'source-run.json'), JSON.stringify({ id: RUN, head_sha: SHA }));
  put(join(proof, 'next-site-SHA256SUMS'), sums + '\n');
  const ledger = join(root, 'results.tsv');
  const header =
    'experiment_id\tlane\tdevice_provider\tworkload\tsource_hash\tcontrol_ms\tcandidate_ms\tcorrectness\tstatus\tevidence\thypothesis';
  const rows = ledgerRows ?? [
    [CANDIDATE, 'webgpu', 'p30', 'w', SOURCE_HASH, '1', '1', 'ok', 'keep', 'e', 'h'],
  ];
  put(ledger, [header, ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
  put(join(root, 'catalogue.json'), catalogue);
  // Recording stubs. gh answers the planted runs; everything else only records and fails.
  const bin = join(root, 'bin');
  const log = join(root, 'commands.jsonl');
  const gh = `#!/usr/bin/env node
const fs=require('fs'),path=require('path');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(['gh',...a])+'\\n');
const repo={id:1,full_name:'facemorph-me/facemorph.me'};
if(a[0]==='api'&&a.includes('--paginate')){for(const job of ${JSON.stringify(jobs)})console.log(JSON.stringify(job));process.exit(0)}
if(a[0]==='api'){console.log(JSON.stringify({id:${RUN},path:${JSON.stringify(workflow)},head_sha:${JSON.stringify(SHA)},conclusion:null,repository:repo,head_repository:repo}));process.exit(0)}
if(a[0]==='run'&&a[1]==='download'){const n=a[a.indexOf('-n')+1],d=a[a.indexOf('-D')+1];const src=path.join(${JSON.stringify(join(root, 'fixtures'))},n.startsWith('next-site-')?'web':'proof');fs.cpSync(src,d,{recursive:true});process.exit(0)}
process.exit(97);
`;
  put(join(bin, 'gh'), gh);
  for (const name of ['cf', 'npx', 'wrangler', 'curl'])
    put(
      join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' "[\\"${name}\\"]" >> ${JSON.stringify(log)}\nexit 97\n`,
    );
  for (const name of ['gh', 'cf', 'npx', 'wrangler', 'curl']) chmodSync(join(bin, name), 0o755);
  return {
    root,
    runtime,
    ledger,
    bin,
    log,
    catalogue: join(root, 'catalogue.json'),
    work: join(root, 'work'),
  };
}

function promote(p, extra = [], env = {}) {
  const at = `http://127.0.0.1:${proxy.address().port}`;
  const r = spawnSync(
    'python3',
    [
      PROMOTE,
      '--build-run',
      String(RUN),
      '--qualification-run',
      String(RUN),
      '--runtime',
      p.runtime,
      '--catalogue',
      p.catalogue,
      '--work',
      p.work,
      '--ledger',
      p.ledger,
      ...extra,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${p.bin}:${process.env.PATH}`,
        HTTP_PROXY: at,
        HTTPS_PROXY: at,
        ALL_PROXY: at,
        http_proxy: at,
        https_proxy: at,
        NO_PROXY: '',
        no_proxy: '',
        NODE_USE_ENV_PROXY: '1',
        CLOUDFLARE_API_TOKEN: '',
        ...env,
      },
    },
  );
  const commands = existsSync(p.log)
    ? readFileSync(p.log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const last = r.stdout.trim().split('\n').pop();
  return { status: r.status, out: last ? JSON.parse(last) : null, stderr: r.stderr, commands };
}

test('missing ledger refuses', () => {
  const p = plant();
  rmSync(p.ledger);
  const r = promote(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.out.refused, /Research ledger .* is missing/);
  assert.deepEqual(r.commands, [], 'refused before any gh call');
  rmSync(p.root, { recursive: true, force: true });
});

test('ledger without a keep row for the kernel candidate refuses', () => {
  for (const rows of [
    [
      [
        CANDIDATE,
        'webgpu',
        'p30',
        'w',
        SOURCE_HASH,
        '1',
        '1',
        'ok',
        'inconclusive',
        'e',
        'keep would be in a note',
      ],
    ],
    [['another-candidate', 'webgpu', 'p30', 'w', SOURCE_HASH, '1', '1', 'ok', 'keep', 'e', 'h']],
  ]) {
    const p = plant({ ledgerRows: rows });
    const r = promote(p);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.out.refused, /has no keep row/);
    assert.deepEqual(r.commands, []);
    rmSync(p.root, { recursive: true, force: true });
  }
  const p = plant({
    ledgerRows: [
      [CANDIDATE, 'webgpu', 'p30', 'w', 'ef'.repeat(32), '1', '1', 'ok', 'keep', 'e', 'h'],
    ],
  });
  const r = promote(p);
  assert.equal(r.status, 1);
  assert.match(r.out.refused, /source hash .* is not recorded/);
  rmSync(p.root, { recursive: true, force: true });
});

test('missing kernel provenance refuses', () => {
  for (const field of ['file', 'sha256', 'candidateId', 'sourceHash']) {
    const p = plant({ kernel: { [field]: '' } });
    const r = promote(p);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.out.refused, new RegExp(`lacks kernel provenance field '${field}'`));
    assert.deepEqual(r.commands, []);
    rmSync(p.root, { recursive: true, force: true });
  }
});

test('catalogue differing from the qualified artifact refuses', () => {
  const p = plant({ catalogue: '{"names":["not the qualified one"]}' });
  const r = promote(p);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.out.refused, /Catalogue differs from the one built into the qualified artifact/);
  assert.ok(!existsSync(join(p.work, 'public')), 'nothing staged');
  rmSync(p.root, { recursive: true, force: true });
});

test('dry run without --publish publishes nothing (intercepted requests show no publish host)', () => {
  proxied.length = 0;
  const p = plant();
  const r = promote(p);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.published, false);
  assert.equal(r.out.source, SHA);
  assert.deepEqual(r.out.kernel.candidateId, CANDIDATE);
  assert.ok(
    existsSync(join(p.work, 'public/index.html')) &&
      existsSync(join(p.work, 'public/runtime/manifest.json')),
  );
  assert.equal(JSON.parse(readFileSync(join(p.work, 'promotion.json'), 'utf8')).published, false);
  // Only gh reads (the run, its jobs, the two downloads); no cf, npx, wrangler or curl; nothing through the proxy.
  assert.deepEqual(
    r.commands.map((c) => c[0]),
    ['gh', 'gh', 'gh', 'gh'],
  );
  assert.ok(r.commands.every((c) => c[1] === 'api' || (c[1] === 'run' && c[2] === 'download')));
  assert.deepEqual(proxied, []);
  assert.doesNotMatch(JSON.stringify(r.commands), PUBLISH_HOSTS);
  rmSync(p.root, { recursive: true, force: true });
});

test('split main, split candidate and legacy candidate gate contexts all admit the same dry-run artifact', () => {
  for (const [workflow, jobs] of [
    ['.github/workflows/main.yml', SPLIT_MAIN_GATES],
    ['.github/workflows/next-site.yml', SPLIT_CANDIDATE_GATES],
    [
      '.github/workflows/next-site.yml',
      gates(['artifact', 'compiled-ui', 'qualify / real-ui-cpu']),
    ],
  ]) {
    const p = plant({ workflow, jobs });
    try {
      const r = promote(p);
      assert.equal(r.status, 0, `${workflow}: ${r.stderr} ${JSON.stringify(r.out)}`);
      assert.equal(r.out.published, false);
      assert.equal(r.out.source, SHA);
      assert(r.commands.every((c) => c[0] === 'gh'));
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test('split contexts still require exactly one successful artifact/UI gate and every qualification success', () => {
  const invalid = [
    ...SPLIT_MAIN_GATES.map((_, i) => SPLIT_MAIN_GATES.filter((__, j) => j !== i)),
    ...SPLIT_MAIN_GATES.map((_, i) =>
      SPLIT_MAIN_GATES.map((job, j) => (j === i ? { ...job, conclusion: 'failure' } : job)),
    ),
    [...SPLIT_MAIN_GATES, { name: 'next-site / qualify / other-device', conclusion: 'failure' }],
    [...SPLIT_MAIN_GATES, { name: 'next-site / qualify / other-device', conclusion: 'skipped' }],
    [...SPLIT_MAIN_GATES, { name: 'next-site / qualify / other-device', conclusion: null }],
    [...SPLIT_MAIN_GATES, SPLIT_MAIN_GATES[0]],
    [...SPLIT_MAIN_GATES, SPLIT_MAIN_GATES[1]],
    ...[
      'unrelated / artifact',
      'unrelated / next-site-artifact / artifact',
      'next-site / next-site-artifact / artifact',
      'next-site-artifact / artifact-extra',
    ].map((name) => [{ name, conclusion: 'success' }, ...SPLIT_MAIN_GATES.slice(1)]),
    [
      SPLIT_MAIN_GATES[0],
      ...gates(['unrelated / compiled-ui', 'unrelated / qualify / real-ui-cpu']),
    ],
    [SPLIT_MAIN_GATES[0], SPLIT_MAIN_GATES[1], ...gates(['unrelated / qualify / real-ui-cpu'])],
  ];
  for (const jobs of invalid) {
    const p = plant({ jobs });
    try {
      const r = promote(p);
      assert.equal(r.status, 1, `${JSON.stringify(jobs)}: ${r.stderr}`);
      assert.match(r.out.refused, /exact-artifact gates did not all pass/);
      assert.equal(r.out.published, false);
      assert.deepEqual(
        r.commands.map((c) => c.slice(0, 2)),
        [
          ['gh', 'api'],
          ['gh', 'api'],
        ],
        'refused before artifact download or publication',
      );
      assert(!existsSync(p.work));
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test('a publish to a classic-owned target is refused before any network call, even when the variable names it', () => {
  proxied.length = 0;
  for (const target of ['next', 'production']) {
    const p = plant();
    const r = promote(p, ['--publish', '--target', target], {
      FACEMORPH_PUBLISH_TARGETS: 'next,production,staging',
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.out.refused, /classic-owned/);
    assert.deepEqual(r.commands, [], 'no gh, cf or curl ran');
    rmSync(p.root, { recursive: true, force: true });
  }
  const p = plant();
  const r = promote(p, ['--publish', '--target', 'staging'], { FACEMORPH_PUBLISH_TARGETS: '' });
  assert.equal(r.status, 1);
  assert.match(r.out.refused, /FACEMORPH_PUBLISH_TARGETS does not name staging/);
  assert.deepEqual(r.commands, []);
  assert.deepEqual(proxied, []);
  rmSync(p.root, { recursive: true, force: true });
});
