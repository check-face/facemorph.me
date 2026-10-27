import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get, request } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';
import test from 'node:test';
import { stageBuilt } from '../../import/build-next.mjs';
import { matrixProxy, startConnectProxy, verifyMatrixArtifact } from './matrix-artifact.mjs';

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'facemorph-matrix-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function tunnel(proxy, authority = 'next.facemorph.me:443') {
  const endpoint = new URL(proxy.server);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: endpoint.hostname,
      port: endpoint.port,
      method: 'CONNECT',
      path: authority,
    });
    req.once('error', reject);
    req.once('connect', (response, socket, head) => {
      if (head.length) socket.unshift(head);
      resolve({ response, socket });
    });
    req.end();
  });
}

test(
  'real TLS bytes traverse CONNECT at the production authority and shutdown closes live tunnels',
  { timeout: 15000 },
  async (t) => {
    const root = scratch(t);
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(root, 'key'),
        '-out',
        join(root, 'cert'),
        '-days',
        '1',
        '-subj',
        '/CN=next.facemorph.me',
      ],
      { stdio: 'ignore' },
    );
    let hits = 0;
    const server = createServer(
      { key: readFileSync(join(root, 'key')), cert: readFileSync(join(root, 'cert')) },
      (req, response) => {
        hits++;
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(`candidate bytes ${req.url} ${req.headers.host}`);
      },
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const transport = await startConnectProxy(server.address().port);
    t.after(async () => {
      await transport.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const { response, socket } = await tunnel(transport.proxy);
    assert.equal(response.statusCode, 200);
    const tls = connect({ socket, servername: 'next.facemorph.me', rejectUnauthorized: false });
    await once(tls, 'secureConnect');
    assert.equal(tls.getPeerCertificate().subject.CN, 'next.facemorph.me');
    let bytes = '';
    tls.setEncoding('utf8').on('data', (data) => {
      bytes += data;
    });
    const ended = once(tls, 'end');
    tls.end('GET /worker.js HTTP/1.1\r\nHost: next.facemorph.me\r\nConnection: close\r\n\r\n');
    await ended;
    assert.match(bytes, /HTTP\/1.1 200/);
    assert.match(bytes, /candidate bytes \/worker.js next.facemorph.me/);
    assert.equal(hits, 1);

    for (const authority of [
      'example.com:443',
      '127.0.0.1:443',
      'next.facemorph.me:80',
      'next.facemorph.me.evil:443',
      'next.facemorph.me:443@evil',
    ]) {
      const denied = await tunnel(transport.proxy, authority);
      assert.equal(denied.response.statusCode, 403, authority);
      denied.socket.destroy();
    }
    const plainStatus = await new Promise((resolve, reject) => {
      get(transport.proxy.server + '/plain', (result) => {
        result.resume();
        resolve(result.statusCode);
      }).once('error', reject);
    });
    assert.equal(plainStatus, 403);
    assert.equal(hits, 1, 'forbidden requests never reach the TLS upstream');
    const live = await tunnel(transport.proxy);
    const closed = once(live.socket, 'close');
    await transport.stop();
    await closed;
  },
);

test('proxy configuration refuses remote endpoints, credentials, paths and invalid upstream ports', async () => {
  assert.deepEqual(matrixProxy('http://127.0.0.1:1234'), { server: 'http://127.0.0.1:1234' });
  for (const value of [
    'https://127.0.0.1:1234',
    'http://example.com:1234',
    'http://user:pass@127.0.0.1:1234',
    'http://127.0.0.1',
    'http://127.0.0.1:1234/path',
    'http://127.0.0.1:1234/?query',
    'http://127.0.0.1:1234/#fragment',
  ])
    assert.throws(() => matrixProxy(value));
  for (const port of [0, -1, 65536, 1.5, '443'])
    await assert.rejects(startConnectProxy(port), /TLS port/);
});

test('candidate admission binds artifact sums, clean source identity and runtime bytes before serving', async (t) => {
  const root = scratch(t);
  const built = join(root, 'built');
  const artifact = join(root, 'artifact');
  const runtime = join(root, 'runtime');
  mkdirSync(built);
  mkdirSync(runtime);
  writeFileSync(join(built, 'index.html'), '<!doctype html><p>identified fixture candidate</p>');
  const commit = 'a'.repeat(40);
  const source = {
    commit,
    buildId: commit,
    sourceTreeSha256: 'b'.repeat(64),
    sourceTreeClean: true,
  };
  stageBuilt({ out: artifact, built, source });
  const bytes = Buffer.from('{"schemaVersion":1,"fixture":"real runtime bytes"}\n');
  writeFileSync(join(runtime, 'manifest.json'), bytes);
  const runtimeSha = createHash('sha256').update(bytes).digest('hex');
  const input = { artifact, commit, runtime, runtimeSha };
  const receipt = await verifyMatrixArtifact(input);
  assert.equal(receipt.commit, commit);
  assert.equal(receipt.runtimeSha256, runtimeSha);
  assert.match(receipt.artifactDigest, /^[0-9a-f]{64}$/);
  await assert.rejects(verifyMatrixArtifact({ ...input, commit: 'invalid' }), /40 lowercase hex/);
  await assert.rejects(
    verifyMatrixArtifact({ ...input, runtimeSha: 'invalid' }),
    /64 lowercase hex/,
  );
  await assert.rejects(
    verifyMatrixArtifact({ ...input, commit: 'c'.repeat(40) }),
    /SourceMismatch|names/,
  );
  await assert.rejects(verifyMatrixArtifact({ ...input, runtimeSha: 'd'.repeat(64) }), /differs/);
  const identityPath = join(artifact, 'next-site-identity.json');
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  identity.deploySource.sourceTreeClean = false;
  writeFileSync(identityPath, JSON.stringify(identity));
  await assert.rejects(verifyMatrixArtifact(input), /clean destination artifact/);
  identity.deploySource.sourceTreeClean = true;
  writeFileSync(identityPath, JSON.stringify(identity));
  writeFileSync(join(artifact, 'deploy-next/index.html'), '<p>unrecorded mutation</p>');
  await assert.rejects(verifyMatrixArtifact(input), /does not match|DigestMismatch/);
});
