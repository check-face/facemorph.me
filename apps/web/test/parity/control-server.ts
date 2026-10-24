// The verified control (classic's candidate build, import/control-artifact.json) served at https://next.facemorph.me
// by classic's own qualification server (apps/web/scripts/next-e2e-server.py), with the runtime from a verified
// acquisition (scripts/runtime/acquire.mjs) seeded into its sha-keyed mirror so a miss can never reach the
// network. deploy-next/ is re-checked against its identity first (npm run build:next -- --check); a control that
// does not verify is refused. Browsers reach it through a host mapping to 127.0.0.1:8443 (the server's fixed port).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const ORIGIN_HOST = 'next.facemorph.me';
export const ORIGIN = `https://${ORIGIN_HOST}`;
export const PORT = 8443;
/** The candidate's own public catalogue Workers: project hosts the control reads (names, previews). */
export const PROJECT_HOSTS = [
  'facemorph-name-catalogue.cdilga.workers.dev',
  'facemorph-seed-gallery.cdilga.workers.dev',
];
export const REPO = new URL('../../../../', import.meta.url).pathname;
const CACHE = join(REPO, '.cache');

export interface ControlIdentity {
  readonly ok: boolean;
  readonly kind: string;
  readonly files: number;
  readonly control?: { sha256?: string };
}

const sha256File = (path: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && !entry.name.endsWith('.part')) out.push(path);
  }
  return out;
}

/** Hard-links every acquired runtime file into mirror/<sha256> once per runtime manifest. */
async function seedMirror(runtime: string, mirror: string, manifestSha: string): Promise<number> {
  const marker = join(mirror, `.seeded-${manifestSha}`);
  if (existsSync(marker)) return Number(readFileSync(marker, 'utf8'));
  mkdirSync(mirror, { recursive: true });
  const files = walk(runtime);
  for (const f of files) {
    const target = join(mirror, await sha256File(f));
    if (!existsSync(target)) {
      try {
        linkSync(f, target);
      } catch {
        copyFileSync(f, target);
      }
    }
  }
  writeFileSync(marker, String(files.length));
  return files.length;
}

const portFree = async () => {
  const { createServer } = await import('node:net');
  return new Promise<boolean>((resolve) => {
    const s = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(PORT, '127.0.0.1');
  });
};

export interface Control {
  readonly identity: ControlIdentity;
  readonly manifestSha256: string;
  readonly mirrorFiles: number;
  stop(): Promise<void>;
}

export async function startControl({
  runtime = join(CACHE, 'runtime'),
  log = join(CACHE, 'control-site/server.log'),
} = {}): Promise<Control> {
  const check = (() => {
    try {
      return execFileSync(
        process.execPath,
        [join(REPO, 'scripts/import/build-next.mjs'), '--check'],
        { encoding: 'utf8' },
      );
    } catch (e) {
      throw new Error(
        `deploy-next/ does not verify against its identity (run npm run build:next at the repository root): ${(e as { stdout?: string }).stdout ?? e}`,
      );
    }
  })();
  const identity = (
    JSON.parse(check.trim().split('\n').at(-1) ?? '{}') as { summary: ControlIdentity }
  ).summary;
  if (identity.kind !== 'control')
    throw new Error(`deploy-next/ is a ${identity.kind} build, not the control`);
  const manifest = join(runtime, 'manifest.json');
  if (!existsSync(manifest))
    throw new Error(
      `no acquired runtime at ${runtime}: ACCEPT_MODEL_TERMS=yes node scripts/runtime/acquire.mjs`,
    );
  const manifestSha256 = await sha256File(manifest);
  if (!(await portFree()))
    throw new Error(
      `127.0.0.1:${PORT} is in use (the device lab's local server or another control); classic's server needs it`,
    );

  const work = join(CACHE, 'control-site');
  rmSync(join(work, 'deploy-next'), { recursive: true, force: true });
  mkdirSync(join(work, 'overlay'), { recursive: true });
  cpSync(join(REPO, 'deploy-next'), join(work, 'deploy-next'), { recursive: true });
  for (const name of ['next-site-source.txt', 'next-site-SHA256SUMS'])
    copyFileSync(join(REPO, name), join(work, name));
  copyFileSync(manifest, join(work, 'overlay/manifest.json'));
  const mirrorFiles = await seedMirror(runtime, join(work, '.runtime-mirror'), manifestSha256);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(work, 'next.key'),
      '-out',
      join(work, 'next.crt'),
      '-days',
      '1',
      '-subj',
      `/CN=${ORIGIN_HOST}`,
    ],
    { stdio: 'ignore' },
  );
  const server: ChildProcess = spawn(
    'python3',
    [
      join(REPO, 'apps/web/scripts/next-e2e-server.py'),
      '--manifest-sha',
      manifestSha256,
      '--runtime-overlay',
      join(work, 'overlay'),
      '--runtime-files',
      runtime,
      '--cert',
      join(work, 'next.crt'),
      '--key',
      join(work, 'next.key'),
    ],
    { cwd: work, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] },
  );
  const stop = () =>
    new Promise<void>((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', () => resolve());
      server.kill('SIGTERM');
    });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null)
      throw new Error(`classic's server exited (${server.exitCode}); see ${log}`);
    try {
      execFileSync('curl', [
        '-kfsS',
        '--max-time',
        '2',
        `https://127.0.0.1:${PORT}/runtime/manifest.json`,
        '-o',
        '/dev/null',
      ]);
      return { identity, manifestSha256, mirrorFiles, stop };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await stop();
  throw new Error(`classic's server did not answer on ${PORT}; see ${log}`);
}

/** Chromium arguments that send the production origin to the local server. */
export const chromiumArgs = [
  `--host-resolver-rules=MAP ${ORIGIN_HOST}:443 127.0.0.1:${PORT}`,
  '--ignore-certificate-errors',
];
