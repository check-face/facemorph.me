// The qualification server must serve the manager's cache-busting retry from the
// same pinned bytes. Real HTTPS requests, including a failed first transfer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverScript = fileURLToPath(
  new URL('../../apps/web/scripts/next-e2e-server.py', import.meta.url),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const source of ['cache', 'runtime-files'])
  test(
    `qualification retries preserve pinned ${source} bytes and refuse other runtime queries`,
    { timeout: 15_000 },
    async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'facemorph-runtime-retry-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      mkdirSync(join(root, 'deploy-next'));
      mkdirSync(join(root, 'overlay'));
      mkdirSync(join(root, '.runtime-mirror'));
      writeFileSync(join(root, 'next-site-source.txt'), 'runtime-retry-test');
      writeFileSync(join(root, 'deploy-next/index.html'), '<!doctype html><title>Retry</title>');
      const bytes = Buffer.from([0, 1, 4, 15, 255]);
      const sha = digest(bytes);
      const path = `/runtime/assets/${'a'.repeat(64)}/noise_15.f32`;
      const manifest = Buffer.from(
        JSON.stringify({
          asset: { url: 'https://next.facemorph.me' + path, sha256: sha, size: bytes.length },
        }),
      );
      writeFileSync(join(root, 'overlay/manifest.json'), manifest);
      const localFile = join(root, 'runtime-files', path.slice('/runtime/'.length));
      mkdirSync(join(localFile, '..'), { recursive: true });
      writeFileSync(source === 'cache' ? join(root, '.runtime-mirror', sha) : localFile, bytes);
      const cert = join(root, 'cert.pem'),
        key = join(root, 'key.pem');
      execFileSync(
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
        ],
        { stdio: 'ignore' },
      );
      const listener = net.createServer();
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const fault = join(root, 'fault.json');
      const server = spawn(
        'python3',
        [
          serverScript,
          '--port',
          String(port),
          '--manifest-sha',
          digest(manifest),
          '--runtime-overlay',
          join(root, 'overlay'),
          '--cert',
          cert,
          '--key',
          key,
          '--runtime-files',
          join(root, 'runtime-files'),
          '--fault-file',
          fault,
        ],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let log = '';
      server.stdout.on('data', (data) => {
        log += data;
      });
      server.stderr.on('data', (data) => {
        log += data;
      });
      const closed = new Promise((resolve) => server.once('exit', resolve));
      t.after(async () => {
        server.kill();
        await closed;
      });
      const agent = new https.Agent({ ca: readFileSync(cert) });
      t.after(() => agent.destroy());
      const request = (requestPath) =>
        new Promise((resolve, reject) => {
          const req = https.get(
            { hostname: '127.0.0.1', servername: 'localhost', port, path: requestPath, agent },
            (response) => {
              const chunks = [];
              response.on('data', (chunk) => chunks.push(chunk));
              response.on('end', () =>
                resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }),
              );
              response.on('error', reject);
            },
          );
          req.on('error', reject);
        });
      const deadline = Date.now() + 5000;
      for (;;) {
        try {
          if ((await request('/runtime/manifest.json')).status === 200) break;
        } catch {
          /* startup only */
        }
        assert.ok(
          Date.now() < deadline && server.exitCode === null,
          `server did not start: ${log}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      writeFileSync(fault, JSON.stringify({ path, status: 503 }));
      assert.equal((await request(path)).status, 503, 'the first actual request fails');
      rmSync(fault);
      for (const suffix of ['', '?retry=1', '?retry=2']) {
        const response = await request(path + suffix);
        assert.equal(response.status, 200, suffix);
        assert.equal(digest(response.bytes), sha, 'retry retains manifest identity');
        assert.deepEqual(response.bytes, bytes);
      }
      assert.deepEqual((await request('/runtime/manifest.json?retry=1')).bytes, manifest);
      if (source === 'runtime-files') {
        writeFileSync(localFile, Buffer.from([1, 1, 4, 15, 255]));
        assert.equal((await request(path)).status, 502, 'corrupt local bytes cannot pass the pin');
        writeFileSync(localFile, Buffer.concat([bytes, Buffer.from([0])]));
        assert.equal(
          (await request(path + '?retry=3')).status,
          502,
          'wrong local size cannot pass the pin',
        );
        writeFileSync(localFile, bytes);
        assert.deepEqual((await request(path + '?retry=4')).bytes, bytes);
      }
      for (const suffix of [
        '?',
        '?other=1',
        '?retry=0',
        '?retry=-1',
        '?retry=1.5',
        '?retry=1&other=1',
        '?retry=1&retry=2',
        '#fragment',
        '?retry=%31',
      ])
        assert.equal((await request(path + suffix)).status, 400, `refuses ${suffix}`);
      assert.equal((await request('/runtime/../secret?retry=1')).status, 400);
      assert.equal((await request('/runtime/%2e%2e/secret?retry=1')).status, 400);
    },
  );
