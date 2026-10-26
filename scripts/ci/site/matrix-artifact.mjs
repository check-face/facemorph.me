// fm-r4a: serve one verified candidate at its production HTTPS origin without
// editing DNS, /etc/hosts, trust stores or browser-wide settings.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const MATRIX_ORIGIN = 'https://next.facemorph.me';
const AUTHORITY = 'next.facemorph.me:443';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Playwright uses the same explicit proxy option for Chromium, Firefox and WebKit. */
export function matrixProxy(server) {
  const url = new URL(server);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('matrix proxy must be an HTTP loopback origin with an explicit port');
  return { server: url.origin };
}

/** Only this authority can tunnel, and its upstream is always the owned loopback TLS port. */
export async function startConnectProxy(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('matrix TLS port must be an integer from 1 to 65535');
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    return socket;
  };
  const server = createServer((_request, response) => {
    response.writeHead(403, { connection: 'close' });
    response.end('CONNECT to the candidate origin only');
  });
  server.on('connection', track);
  server.on('connect', (request, client, head) => {
    if (request.url !== AUTHORITY) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = track(connect({ host: '127.0.0.1', port }));
    const timer = setTimeout(
      () => upstream.destroy(new Error('matrix TLS connect timed out')),
      5000,
    );
    upstream.once('connect', () => {
      clearTimeout(timer);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.once('error', () => client.destroy());
    upstream.once('close', () => {
      clearTimeout(timer);
      client.destroy();
    });
    client.once('close', () => upstream.destroy());
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    proxy: matrixProxy(`http://127.0.0.1:${server.address().port}`),
    stop: async () => {
      const closed = new Promise((resolveClose) => server.close(resolveClose));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}

/** Verify the downloaded root and expected runtime before starting a server or browser. */
export async function verifyMatrixArtifact({ artifact, commit, runtime, runtimeSha }) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? ''))
    throw new Error('matrix artifact commit must be 40 lowercase hex');
  if (!/^[0-9a-f]{64}$/.test(runtimeSha ?? ''))
    throw new Error('matrix runtime SHA must be 64 lowercase hex');
  const { verifyUnpacked } = await import('../fetch-artifact.ts');
  const { readIdentity } = await import('../../import/build-next.mjs');
  const verified = verifyUnpacked(artifact, commit);
  const { identity, findings } = readIdentity(artifact);
  if (
    findings.length ||
    identity?.kind !== 'destination' ||
    identity.deploySource?.commit !== commit ||
    identity.deploySource?.sourceTreeClean !== true
  )
    throw new Error(
      `matrix requires the exact clean destination artifact: ${JSON.stringify(findings)}`,
    );
  const actual = createHash('sha256')
    .update(readFileSync(join(runtime, 'manifest.json')))
    .digest('hex');
  if (actual !== runtimeSha) throw new Error(`matrix runtime ${actual} differs from ${runtimeSha}`);
  return { commit, artifactDigest: verified.digest, runtimeSha256: actual };
}

/** Own a verified artifact server and its origin-restricted transport as one lifetime. */
export async function startMatrixArtifact({ artifact, commit, runtime, runtimeSha }) {
  const receipt = await verifyMatrixArtifact({ artifact, commit, runtime, runtimeSha });
  const { startControl, PORT } = await import('../../../apps/web/test/parity/control-server.ts');
  const site = await startControl({
    artifact: join(resolve(artifact), 'deploy-next'),
    source: commit,
    runtime: resolve(runtime),
  });
  let transport;
  try {
    transport = await startConnectProxy(PORT);
    return {
      receipt,
      proxy: transport.proxy,
      stop: async () => {
        try {
          await transport.stop();
        } finally {
          await site.stop();
        }
      },
    };
  } catch (error) {
    await site.stop();
    throw error;
  }
}

/** Run the unchanged product stages; the parent owns every server/socket and child lifetime. */
export async function runMatrixArtifact({ artifact, commit, runtime, runtimeSha, engine, out }) {
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('invalid matrix engine');
  const site = await startMatrixArtifact({ artifact, commit, runtime, runtimeSha });
  let child;
  const terminate = () => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  };
  process.on('SIGTERM', terminate);
  process.on('SIGINT', terminate);
  try {
    child = spawn(process.execPath, [join(REPO, 'apps/web/scripts/next-matrix.mjs'), engine], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NEXT_MATRIX_ORIGIN: MATRIX_ORIGIN,
        NEXT_MATRIX_PROXY: site.proxy.server,
        NEXT_MATRIX_LOCAL_PORT: '',
        NEXT_MATRIX_RUNTIME_SHA: runtimeSha,
        NEXT_MATRIX_ARTIFACT_COMMIT: site.receipt.commit,
        NEXT_MATRIX_ARTIFACT_DIGEST: site.receipt.artifactDigest,
        NEXT_MATRIX_OUT: resolve(out),
      },
    });
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    });
  } finally {
    process.off('SIGTERM', terminate);
    process.off('SIGINT', terminate);
    terminate();
    await site.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      artifact: { type: 'string' },
      commit: { type: 'string' },
      runtime: { type: 'string' },
      'runtime-sha': { type: 'string' },
      engine: { type: 'string' },
      out: { type: 'string' },
    },
  });
  for (const name of ['artifact', 'commit', 'runtime', 'runtime-sha', 'engine', 'out'])
    if (!values[name]) throw new Error(`--${name} is required`);
  process.exitCode = await runMatrixArtifact({ ...values, runtimeSha: values['runtime-sha'] });
}
