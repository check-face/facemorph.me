// Compose a candidate runtime beside a preverified frozen control. Shared model bytes
// are borrowed by relative links; this helper never writes through those links.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { composeManifest, validateOverlay, verifyOverlay } from './ort-mirror.ts';

const MAX_TARBALL = 256 * 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;
const MAX_MANIFEST = 4 * 1024 * 1024;
const digest = (bytes: Buffer | string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

export interface ApplyOptions {
  controlRuntime: string;
  overlay: unknown;
  out: string;
  /** Test transport injection. The CLI always uses canonical-registry fetch with no redirects. */
  fetch?: typeof fetch;
}

export interface AppliedRuntime {
  schema: 'facemorph.ort-acquisition/1';
  controlRuntime: string;
  controlManifestSha256: string;
  runtimeDir: string;
  manifestSha256: string;
  ortVersion: string;
  files: number;
  bytes: number;
}

function fail(message: string): never {
  throw new Error(`ORT acquisition: ${message}`);
}

function below(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function outputPath(input: string, control: string): string {
  if (input.split(/[\\/]/).includes('..')) fail('output path must not contain traversal');
  const out = resolve(input);
  if (below(out, control) || below(control, out)) fail('output and control trees must be separate');
  for (let path = out; ; path = dirname(path)) {
    try {
      const stat = lstatSync(path);
      if (path === out) fail('output already exists');
      if (!stat.isDirectory() || stat.isSymbolicLink())
        fail('output parents must be real directories');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (path !== out) fail('output parent must already exist');
    }
    if (path === dirname(path)) break;
  }
  return out;
}

/** Refuse hidden links/special files in the borrowed control before creating output. */
function controlTree(root: string): void {
  let entries = 0;
  function visit(path: string): void {
    const stat = lstatSync(path);
    if (++entries > 8192) fail('control file inventory exceeds limit');
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (!stat.isFile()) fail('control must contain only real files and directories');
  }
  visit(root);
}

async function tarball(url: string, request: typeof fetch): Promise<Buffer> {
  const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (response.status !== 200 || !response.body) fail(`registry returned ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_TARBALL)) {
    await response.body.cancel();
    fail('registry tarball exceeds size bound');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_TARBALL) fail('registry tarball exceeds size bound');
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!bytes || (declared !== null && bytes !== Number(declared)))
    fail('registry tarball is empty or truncated');
  return Buffer.concat(chunks, bytes);
}

/** Read one fixed member to stdout; never extract archive paths onto the filesystem. */
function member(archive: string, path: string, bound: number): Buffer {
  try {
    return execFileSync('tar', ['-xOf', archive, '--', path], {
      maxBuffer: bound + 1,
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return fail(`missing, oversized or unreadable archive member: ${path}`);
  }
}

export async function applyOrtMirror(options: ApplyOptions): Promise<AppliedRuntime> {
  const overlay = validateOverlay(options.overlay);
  for (const file of overlay.files)
    if (file.size > MAX_ASSET) fail(`${file.file} exceeds asset size bound`);
  const control = realpathSync(options.controlRuntime);
  controlTree(control);
  if (!lstatSync(control).isDirectory()) fail('control runtime must be a directory');
  const controlFile = join(control, 'manifest.json');
  if (lstatSync(controlFile).size > MAX_MANIFEST) fail('control manifest exceeds size bound');
  const controlBytes = readFileSync(controlFile);
  const composed = composeManifest(
    JSON.parse(controlBytes.toString('utf8')),
    overlay,
    'https://next.facemorph.me',
  );
  const out = outputPath(options.out, control);
  const scratch = mkdtempSync(join(dirname(out), '.ort-acquisition-'));
  let staged = '';
  try {
    const bytes = await tarball(overlay.npm.url, options.fetch ?? fetch);
    if (`sha512-${digest(bytes, 'sha512', 'base64')}` !== overlay.npm.integrity)
      fail('npm tarball SHA512 integrity mismatch');
    const archive = join(scratch, 'package.tgz');
    writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
    const packageRoot = join(scratch, 'package');
    const dist = join(packageRoot, 'dist');
    mkdirSync(dist, { recursive: true });
    const packageBytes = member(archive, 'package/package.json', 128 * 1024);
    if (packageBytes.length > 128 * 1024) fail('package identity exceeds size bound');
    writeFileSync(join(packageRoot, 'package.json'), packageBytes, { flag: 'wx' });
    for (const file of overlay.files) {
      const body = member(archive, `package/dist/${file.file}`, file.size);
      if (body.length !== file.size || digest(body) !== file.sha256)
        fail(`${file.file} digest or size mismatch`);
      writeFileSync(join(dist, file.file), body, { flag: 'wx' });
    }
    verifyOverlay(dist, overlay);

    staged = mkdtempSync(join(dirname(out), '.ort-runtime-'));
    mkdirSync(join(staged, 'assets'));
    for (const name of readdirSync(control)) {
      if (name === 'manifest.json') continue;
      if (name === 'assets') {
        for (const asset of readdirSync(join(control, name))) {
          if (asset === overlay.bundleSha256) fail('overlay bundle already exists in control');
          symlinkSync(
            relative(join(out, 'assets'), join(control, name, asset)),
            join(staged, name, asset),
          );
        }
      } else symlinkSync(relative(out, join(control, name)), join(staged, name));
    }
    const bundle = join(staged, 'assets', overlay.bundleSha256);
    mkdirSync(bundle);
    for (const file of overlay.files)
      writeFileSync(join(bundle, file.file), readFileSync(join(dist, file.file)), { flag: 'wx' });
    const manifest = `${JSON.stringify(composed)}\n`;
    writeFileSync(join(staged, 'manifest.json'), manifest, { flag: 'wx' });
    // Recheck immediately before publication. The caller owns this output parent;
    // no other job/session may share an output name.
    if (
      existsSync(out) ||
      (() => {
        try {
          lstatSync(out);
          return true;
        } catch {
          return false;
        }
      })()
    )
      fail('output appeared during acquisition');
    renameSync(staged, out);
    staged = '';
    return {
      schema: 'facemorph.ort-acquisition/1',
      controlRuntime: control,
      controlManifestSha256: digest(controlBytes),
      runtimeDir: out,
      manifestSha256: digest(manifest),
      ortVersion: overlay.version,
      files: overlay.files.length,
      bytes: overlay.files.reduce((sum, file) => sum + file.size, 0),
    };
  } finally {
    if (staged) rmSync(staged, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'control-runtime': { type: 'string' },
      overlay: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values['control-runtime'] || !values.overlay || !values.out)
    throw new Error(
      'usage: apply-ort-mirror.ts --control-runtime <verified dir> --overlay <JSON> --out <new dir>',
    );
  console.log(
    JSON.stringify(
      await applyOrtMirror({
        controlRuntime: values['control-runtime'],
        overlay: JSON.parse(readFileSync(values.overlay, 'utf8')),
        out: values.out,
      }),
    ),
  );
}
