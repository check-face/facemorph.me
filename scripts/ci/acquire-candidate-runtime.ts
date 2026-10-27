// Compose one job-owned runtime beside the separately verified frozen control. No shared cache is mutated.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireSerialCompanion } from './acquire-serial-ort.ts';
import { applyOrtMirror } from './apply-ort-mirror.ts';
import { loadCandidateRuntime, type RuntimeAssetRow } from './candidate-runtime.ts';

export interface AcquireCandidateOptions {
  readonly repo: string;
  readonly controlRuntime: string;
  /** A nonexistent runtime directory under an existing, job-owned real parent directory. */
  readonly out: string;
  /** If supplied, must still name the canonical reviewed resource in repo. */
  readonly serialSourcePath?: string;
  readonly token?: string;
  /** Test transports only; both underlying helpers validate canonical source URLs first. */
  readonly npmRequest?: typeof fetch;
  readonly serialRequest?: typeof fetch;
}
export interface CandidateRuntimeReceipt {
  readonly controlRuntime: string;
  readonly runtimeDir: string;
  readonly manifestSha256: string;
}
const SOURCE = 'import/runtime-serial-source.json';
const fail = (message: string): never => {
  throw new Error(`Candidate acquisition: ${message}`);
};
const below = (path: string, root: string): boolean => {
  const part = relative(root, path);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
};
function regularDirectory(path: string): void {
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    fail('expected a real directory');
}
function output(input: string, control: string): string {
  if (input.split(/[\\/]/).includes('..')) fail('output must not contain traversal');
  const out = resolve(input);
  if (below(out, control) || below(control, out)) fail('output and control must be separate');
  try {
    lstatSync(out);
    fail('output already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (let parent = dirname(out); ; parent = dirname(parent)) {
    regularDirectory(parent);
    if (dirname(parent) === parent) break;
  }
  return out;
}
function tree(root: string, control?: string): void {
  regularDirectory(root);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!control || (!below(target, control) && !below(target, root)))
          fail('runtime link escapes the control and owned output');
      } else if (info.isDirectory()) walk(path);
      else if (!info.isFile()) fail('runtime contains a special file');
    }
  };
  walk(root);
}
async function verifyRows(
  root: string,
  rows: readonly RuntimeAssetRow[],
  control?: string,
): Promise<void> {
  if (!Array.isArray(rows) || !rows.length) fail('empty runtime inventory');
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.path !== 'string' ||
      !row.path ||
      isAbsolute(row.path) ||
      /^[a-z]:/i.test(row.path) ||
      Array.from(row.path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      row.path.includes('\\') ||
      row.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      seen.has(row.path) ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !(row.bytes === null || (Number.isSafeInteger(row.bytes) && row.bytes >= 0))
    )
      fail('invalid or duplicate runtime row');
    seen.add(row.path);
    const actual = realpathSync(join(root, row.path));
    if (!below(actual, root) && !(control && below(actual, control)))
      fail('runtime row escapes its roots');
    const info = lstatSync(actual);
    if (!info.isFile() || (row.bytes !== null && info.size !== row.bytes))
      fail(`${row.path}: file type or declared size mismatch`);
    const digest = createHash('sha256');
    for await (const part of createReadStream(actual)) digest.update(part);
    if (digest.digest('hex') !== row.sha256) fail(`${row.path}: digest mismatch`);
  }
}

/** Reverify actual bytes against reviewed repository metadata, never a manifest's self-reported digest. */
export async function verifyCandidateRuntime(options: {
  readonly repo: string;
  readonly controlRuntime: string;
  readonly runtimeDir: string;
}): Promise<CandidateRuntimeReceipt> {
  const expected = loadCandidateRuntime(realpathSync(options.repo));
  const control = realpathSync(options.controlRuntime);
  const runtime = realpathSync(options.runtimeDir);
  tree(control);
  await verifyRows(control, expected.controlBuildInputs.runtime.assets);
  if (expected.overlay === null) {
    if (runtime !== control) fail('without an overlay the runtime must be the frozen control');
  } else {
    if (below(runtime, control) || below(control, runtime))
      fail('output and control must be separate');
    tree(runtime, control);
    await verifyRows(runtime, expected.buildInputs.runtime.assets, control);
  }
  return { controlRuntime: control, runtimeDir: runtime, manifestSha256: expected.manifestSha256 };
}

export async function acquireCandidateRuntime(
  options: AcquireCandidateOptions,
): Promise<CandidateRuntimeReceipt> {
  const repo = realpathSync(options.repo);
  const expected = loadCandidateRuntime(repo);
  const control = realpathSync(options.controlRuntime);
  tree(control);
  await verifyRows(control, expected.controlBuildInputs.runtime.assets);
  if (expected.overlay === null)
    return {
      controlRuntime: control,
      runtimeDir: control,
      manifestSha256: expected.manifestSha256,
    };
  const out = output(options.out, control);
  let serialRoot: string | undefined;
  let owned: { dev: number; ino: number } | undefined;
  try {
    let serialDist: string | undefined;
    if (expected.overlay.schema === 'facemorph.ort-mirror/2') {
      const source = join(repo, SOURCE);
      if (resolve(repo, options.serialSourcePath ?? SOURCE) !== source)
        fail('serial source must be the canonical reviewed repository resource');
      if (!lstatSync(source).isFile() || realpathSync(source) !== source)
        fail('serial source must be a real reviewed file');
      const authority: unknown = JSON.parse(readFileSync(source, 'utf8'));
      serialRoot = mkdtempSync(join(dirname(out), '.candidate-serial-'));
      serialDist = (
        await acquireSerialCompanion({
          companion: expected.overlay.serial,
          source: authority,
          out: join(serialRoot, 'dist'),
          ...(options.token === undefined ? {} : { token: options.token }),
          ...(options.serialRequest === undefined ? {} : { request: options.serialRequest }),
        })
      ).dist;
    }
    await applyOrtMirror({
      controlRuntime: control,
      overlay: expected.overlay,
      out,
      ...(serialDist === undefined ? {} : { serialDist }),
      ...(options.npmRequest === undefined ? {} : { fetch: options.npmRequest }),
    });
    const info = lstatSync(out);
    owned = { dev: info.dev, ino: info.ino };
    tree(out, control);
    await verifyRows(out, expected.buildInputs.runtime.assets, control);
    // The candidate owns its replacement root; also recheck the separately retained original root.
    await verifyRows(
      control,
      expected.controlBuildInputs.runtime.assets.filter((row) => row.path === 'manifest.json'),
    );
    return { controlRuntime: control, runtimeDir: out, manifestSha256: expected.manifestSha256 };
  } catch (error) {
    if (owned) {
      try {
        const current = lstatSync(out);
        if (current.isDirectory() && current.dev === owned.dev && current.ino === owned.ino)
          rmSync(out, { recursive: true });
      } catch (cleanup) {
        if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanup;
      }
    }
    throw error;
  } finally {
    if (serialRoot) rmSync(serialRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: '.' },
      'control-runtime': { type: 'string' },
      out: { type: 'string' },
      'serial-source': { type: 'string' },
    },
  });
  if (!values['control-runtime'] || !values.out)
    fail(
      'usage: acquire-candidate-runtime.ts [--repo <repository>] --control-runtime <verified dir> --out <new runtime>',
    );
  console.log(
    JSON.stringify(
      await acquireCandidateRuntime({
        repo: values.repo!,
        controlRuntime: values['control-runtime']!,
        out: values.out!,
        ...(values['serial-source'] === undefined
          ? {}
          : { serialSourcePath: values['serial-source'] }),
        ...(process.env['GH_TOKEN'] === undefined ? {} : { token: process.env['GH_TOKEN'] }),
      }),
    ),
  );
}
