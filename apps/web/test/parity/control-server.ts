// The verified control (classic's candidate build, import/control-artifact.json) served at https://next.facemorph.me
// by classic's own qualification server (apps/web/scripts/next-e2e-server.py), with the runtime from a verified
// acquisition (scripts/runtime/acquire.mjs) seeded into its sha-keyed mirror so a miss can never reach the
// network. deploy-next/ is re-checked against its identity first (npm run build:next -- --check); a control that
// does not verify is refused. Each independent run owns its port and server directory.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchControl } from '../../../../scripts/import/fetch-control.mjs';

export const ORIGIN_HOST = 'next.facemorph.me';
export const ORIGIN = `https://${ORIGIN_HOST}`;
// Playwright's setup and workers inherit the same mapping; independent runs choose their own port.
// Chosen below Linux's ephemeral range (32768+): a port the OS handed out for listen(0) and released is soon reused
// as some outgoing connection's source port, so the server could not bind it later (runtime-e2e, full run
// 40455559357: 'Address already in use'). Outgoing connections never take ports below that range.
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const tryPort = (port: number) =>
    new Promise<boolean>((resolve) => {
      const server = createServer();
      server
        .once('error', () => resolve(false))
        .listen(port, '127.0.0.1', () => {
          server.close(() => resolve(true));
        });
    });
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 12000);
    if (await tryPort(port)) return port;
  }
  throw new Error('no free control port in 20000-31999');
}
export const PORT = Number(process.env['FACEMORPH_CONTROL_PORT'] ?? (await freePort()));
process.env['FACEMORPH_CONTROL_PORT'] = String(PORT);
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
      } catch (error) {
        // Another run may have linked it first. Cross-device copies publish only complete bytes.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          const part = `${target}.${randomUUID()}.part`;
          try {
            copyFileSync(f, part);
            renameSync(part, target);
          } finally {
            rmSync(part, { force: true });
          }
        }
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

export interface StartOptions {
  readonly runtime?: string;
  readonly log?: string;
  /** Parity harness (fm-q007): serve this deploy-next-shaped directory as the subject instead of the verified control. */
  readonly artifact?: string;
  /** The subject's own source identity (sent as X-Next-Artifact-Source); required with `artifact`. */
  readonly source?: string;
  /** Opt-in live HTTP fault file: exact path, optional delaySeconds (0..15), optional status (503). */
  readonly faultFile?: string;
}

export async function startControl({
  runtime = join(CACHE, 'runtime'),
  log,
  artifact,
  source,
  faultFile,
}: StartOptions = {}): Promise<Control> {
  if (artifact && !source) throw new Error('a subject artifact needs its own source identity');
  const subjectIdentity = (): ControlIdentity => ({
    ok: existsSync(join(artifact!, 'index.html')),
    kind: 'subject',
    files: walk(artifact!).length,
  });
  // Retained control is independent of build:next, which now builds the destination.
  const retained = artifact ? null : await fetchControl({ log: () => {} });
  const controlDir = retained?.dir;
  const identity: ControlIdentity = artifact
    ? subjectIdentity()
    : {
        ok: true,
        kind: 'control',
        files: retained!.record.files.length,
        control: { sha256: retained!.record.release.sha256 },
      };
  if (artifact && !identity.ok)
    throw new Error(`${artifact} has no index.html: not a servable subject`);
  const manifest = join(runtime, 'manifest.json');
  if (!existsSync(manifest))
    throw new Error(
      `no acquired runtime at ${runtime}: ACCEPT_MODEL_TERMS=yes node scripts/runtime/acquire.mjs`,
    );
  const manifestSha256 = await sha256File(manifest);
  if (!(await portFree()))
    throw new Error(
      `control port 127.0.0.1:${PORT} is already in use; retry with a free FACEMORPH_CONTROL_PORT`,
    );

  mkdirSync(CACHE, { recursive: true });
  const work = mkdtempSync(join(CACHE, 'control-site-'));
  log ??= join(work, 'server.log');
  mkdirSync(join(work, 'overlay'), { recursive: true });
  cpSync(artifact ?? join(controlDir!, 'deploy-next'), join(work, 'deploy-next'), {
    recursive: true,
  });
  if (artifact) writeFileSync(join(work, 'next-site-source.txt'), `${source}\n`);
  else
    for (const name of ['next-site-source.txt', 'next-site-SHA256SUMS'])
      copyFileSync(join(controlDir!, name), join(work, name));
  copyFileSync(manifest, join(work, 'overlay/manifest.json'));
  const mirror = join(CACHE, 'control-mirror');
  const mirrorFiles = await seedMirror(runtime, mirror, manifestSha256);
  symlinkSync(mirror, join(work, '.runtime-mirror'));
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
  const logFd = openSync(log, 'w');
  let server: ChildProcess;
  try {
    server = spawn(
      'python3',
      [
        join(REPO, 'apps/web/scripts/next-e2e-server.py'),
        '--port',
        String(PORT),
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
        ...(faultFile ? ['--fault-file', resolve(faultFile)] : []),
      ],
      { cwd: work, stdio: ['ignore', logFd, logFd] },
    );
  } finally {
    closeSync(logFd);
  }
  const stop = async () => {
    if (server.exitCode === null)
      await new Promise<void>((resolve) => {
        server.once('exit', () => resolve());
        server.kill('SIGTERM');
      });
    rmSync(work, { recursive: true, force: true });
  };
  try {
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
    throw new Error(`classic's server did not answer on ${PORT}; see ${log}`);
  } catch (error) {
    const detail = existsSync(log) ? readFileSync(log, 'utf8').slice(-4000) : '';
    await stop();
    throw new Error(`${error}\n${detail}`);
  }
}

/** Chromium arguments that send the production origin to the local server. */
export const chromiumArgs = [
  `--host-resolver-rules=MAP ${ORIGIN_HOST}:443 127.0.0.1:${PORT}`,
  '--ignore-certificate-errors',
];
