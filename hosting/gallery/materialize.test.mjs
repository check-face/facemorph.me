// Real local files, HTTPS and the installed CLI. Planted producer records test staging,
// not inference quality. Publication must stay usable when the retired API is blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpsServer } from 'node:https';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { embedRecovery, recoverEnvelope } from '../../apps/web/src/Next/image-envelope.mjs';
import {
  headerLine,
  rowLine,
  resultSet,
  nameIdentity,
  sha256,
} from '../../tools/names-generator/lib.mjs';
import {
  checkInputUrls,
  getPublished,
  staticUrl,
  main,
} from '../../scripts/names-publish/publish.mjs';
import { classify, tally } from '../../scripts/names-snapshot/net-recorder.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
async function inputs(root) {
  const generated = join(root, 'generated'),
    legacy = join(root, 'legacy');
  mkdirSync(generated);
  mkdirSync(legacy);
  const original = readFileSync(
    new URL('../../apps/web/test/fixtures/verify/stills/recovery-v2.webp', import.meta.url),
  );
  const decoded = await recoverEnvelope(new Blob([original]));
  const wrapped = await embedRecovery(decoded.blob, {
    ...decoded,
    provenance: { ...decoded.provenance, manifestSha256: 'a'.repeat(64) },
  });
  const bytes = Buffer.from(await wrapped.blob.arrayBuffer());
  const fixture = await recoverEnvelope(new Blob([bytes]));
  const set = resultSet({
    manifestSha256: fixture.provenance.manifestSha256,
    modelSha256: fixture.provenance.modelSha256,
    generationSha256: fixture.generationSha256,
  });
  const name = nameIdentity('Charlotte');
  writeFileSync(join(generated, 'result.webp'), bytes);
  writeFileSync(
    join(generated, 'manifest.jsonl'),
    headerLine(set) +
      rowLine({
        ...name,
        resultSet: set.digest,
        file: 'result.webp',
        bytes: bytes.length,
        fileSha256: sha256(bytes),
        imageSha256: fixture.imageSha256,
        latentSha256: fixture.latentSha256,
        latentCheck: 'exact',
        referenceLatent: { status: 'pass', maxAbsDiff: 0 },
        synthesisCheck: { status: 'pass', maxRgbDiff: 0 },
      }),
  );
  const catalogue = {
    names: [
      {
        ...name,
        latent: {
          sha256: fixture.latentSha256,
          modelSha256: set.identity.modelSha256,
          generationSha256: set.identity.generationSha256,
        },
      },
    ],
  };
  writeFileSync(join(legacy, 'catalogue.json'), JSON.stringify(catalogue));
  return { generated, legacy, catalogue };
}
function cli(args, env) {
  return new Promise((resolveChild, reject) => {
    const child = spawn('python3', ['hosting/gallery/materialize.py', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.once('error', reject);
    child.once('close', (code) => resolveChild({ code, output }));
  });
}

test('configured API origins and nested catalogue URLs fail before any connection', async (t) => {
  await assert.rejects(main(['--publish=false']), /Use --publish without a value/);
  await assert.rejects(main(['--publish', '--check']), /Choose --check or --publish/);
  const root = mkdtempSync(join(tmpdir(), 'fm-materialize-refuse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await inputs(root);
  const record = join(root, 'network.jsonl');
  const options = {
    NET_RECORD: record,
    NODE_OPTIONS: `--import=${join(ROOT, 'scripts/names-snapshot/net-recorder.mjs')}`,
  };
  const args = [
    `--generated=${input.generated}`,
    `--legacy=${input.legacy}`,
    `--output=${root}/out`,
    '--check',
  ];
  for (const origin of ['https://API.facemorph.me./', 'https://x.checkface.facemorph.me/']) {
    const result = await cli([...args, `--origin=${origin}`], options);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /not a static URL/);
  }
  input.catalogue.names[0].latent.url = '//api.facemorph.me/latent.f32';
  writeFileSync(join(input.legacy, 'catalogue.json'), JSON.stringify(input.catalogue));
  const result = await cli([...args, '--origin=https://catalogue.example/'], options);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /not a static URL/);
  assert.equal(existsSync(record), false, 'refusal made no outbound connection');
  assert.equal(staticUrl('/full/result.webp', 'https://static.example/').host, 'static.example');
  assert.throws(
    () => checkInputUrls({ source: 'https://api.facemorph.me/x' }, 'https://static.example/'),
    /not a static URL/,
  );
});

test('redirects are refused before their target receives a request', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/source') {
      res.writeHead(302, { location: '/target' });
      res.end();
    } else res.end('must not be requested');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  await assert.rejects(
    getPublished(`http://127.0.0.1:${server.address().port}/source`),
    /Publication read/,
  );
  assert.equal(requests.length, 3, 'bounded retries');
  assert.equal(
    requests.every((path) => path === '/source'),
    true,
  );
});

test('verified local names stage against a real static HTTPS origin with zero API requests', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm-materialize-stage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await inputs(root);
  const cert = join(root, 'cert.pem'),
    key = join(root, 'key.pem');
  const openssl = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(openssl.status, 0, openssl.stderr);
  const requests = [];
  const server = httpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    requests.push({ path: req.url, host: req.headers.host, method: req.method });
    if (req.url === '/catalogue.json') res.end(readFileSync(join(input.legacy, 'catalogue.json')));
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const record = join(root, 'network.jsonl');
  const result = await cli(
    [
      `--generated=${input.generated}`,
      `--legacy=${input.legacy}`,
      `--output=${root}/out`,
      `--origin=https://127.0.0.1:${server.address().port}/`,
      `--previous=${root}/previous`,
      '--check',
    ],
    {
      NODE_EXTRA_CA_CERTS: cert,
      NET_RECORD: record,
      NODE_OPTIONS: `--import=${join(ROOT, 'scripts/names-snapshot/net-recorder.mjs')}`,
    },
  );
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /"event":"validated"/);
  const connections = readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(connections.length > 0);
  assert.equal(
    connections.every((c) => c.host === '127.0.0.1'),
    true,
    JSON.stringify(connections),
  );
  const byHostClass = tally(connections, (connection) =>
    classify(connection, { sources: ['127.0.0.1'] }),
  );
  assert.equal(byHostClass['retired-api'].connections, 0);
  assert.ok(byHostClass['source-worker'].bytes > 0);
  assert.equal(
    requests.every((r) => r.method === 'GET'),
    true,
    'no publication request',
  );
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/publication.json', '/catalogue.json'],
  );
  assert.equal(existsSync(join(root, 'out/publication.json')), true);
  assert.equal(
    existsSync(join(root, 'out/catalogue-v2.json')),
    false,
    'check does not switch pointer',
  );
  if (process.env.MATERIALIZE_CF_DRY_RUN === '1') {
    const dryRun = await cli(
      [
        `--generated=${input.generated}`,
        `--legacy=${input.legacy}`,
        `--output=${root}/dryrun`,
        `--origin=https://127.0.0.1:${server.address().port}/`,
        `--previous=${root}/previous`,
      ],
      { NODE_EXTRA_CA_CERTS: cert, NET_RECORD: record, NODE_OPTIONS: `--import=${join(ROOT, 'scripts/names-snapshot/net-recorder.mjs')}` },
    );
    assert.equal(dryRun.code, 0, dryRun.output);
    assert.equal([...dryRun.output.matchAll(/--dry-run: exiting now/g)].length, 2, dryRun.output);
    assert.equal(existsSync(join(root, 'dryrun/catalogue-v2.json')), true);
    assert.equal(
      requests.every((r) => r.method === 'GET'),
      true,
    );
    const dryConnections = readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(dryConnections.every(c => c.host === '127.0.0.1'), JSON.stringify(dryConnections));
    console.log(dryRun.output);
  }
  console.log(
    JSON.stringify({
      staticRequests: requests.length,
      apiRequests: 0,
      byHostClass,
      staged: true,
      published: false,
    }),
  );
});
