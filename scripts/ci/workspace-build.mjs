// Share the compiled outputs of build:next within one main run; dependencies remain in workspace-cache.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD_PATHS = [
  'apps/web/dist',
  'packages/stylegan-js/dist',
  'packages/browser-model-manager/dist',
  'packages/cloudflare-model-host/dist',
];
const ARCHIVE = 'workspace-build.tar';
const RECEIPT = 'workspace-build.json';
const SCHEMA = 'facemorph.workspace-build/1';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

function checkout(root, commit) {
  const head = git(root, 'rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || head !== commit)
    throw Error('workspace-build commit does not match the current checkout');
  return { commit, lockSha256: sha256(readFileSync(join(root, 'package-lock.json'))) };
}

function clean(root) {
  if (git(root, 'status', '--porcelain', '--untracked-files=normal'))
    throw Error('workspace-build requires a clean source checkout');
}

function sourceIdentity(identity, commit) {
  if (
    identity?.repository !== 'facemorph-me/facemorph.me' ||
    identity.commit !== commit ||
    identity.buildId !== commit ||
    identity.sourceTreeClean !== true ||
    !/^[a-f0-9]{64}$/.test(identity.sourceTreeSha256 ?? '')
  )
    throw Error('workspace-build source identity must name the clean current commit');
}

function regularFile(path) {
  if (!lstatSync(path).isFile()) throw Error(`workspace-build requires a regular file: ${path}`);
  return readFileSync(path);
}

function validateTree(path) {
  const stat = lstatSync(path);
  if (stat.isFile()) return 1;
  if (!stat.isDirectory()) throw Error(`workspace-build refuses links or special files: ${path}`);
  return readdirSync(path).reduce((count, name) => count + validateTree(join(path, name)), 0);
}

// Accept only our fixed-path USTAR format. Validate every header before writing anything, and extract regular
// files ourselves: tar links, PAX overrides, special files, duplicate paths and traversal are never interpreted.
function entries(bytes) {
  const result = [];
  const seen = new Set();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (bytes.length - offset < 1024 || bytes.subarray(offset).some((byte) => byte !== 0))
        throw Error('workspace-build invalid tar trailer');
      for (const path of BUILD_PATHS)
        if (!result.some((entry) => entry.path === path && entry.directory))
          throw Error(`workspace-build archive is missing ${path}`);
      return result;
    }
    const text = (start, length) => {
      const value = header.subarray(start, start + length);
      const end = value.indexOf(0);
      return new TextDecoder('utf-8', { fatal: true }).decode(
        end < 0 ? value : value.subarray(0, end),
      );
    };
    const number = (start, length) => {
      const value = text(start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw Error('workspace-build invalid tar number');
      const parsed = Number.parseInt(value, 8);
      if (!Number.isSafeInteger(parsed)) throw Error('workspace-build oversized tar entry');
      return parsed;
    };
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (number(148, 8) !== checksum || text(257, 6) !== 'ustar')
      throw Error('workspace-build invalid USTAR header');
    const prefix = text(345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${text(0, 100)}`;
    const directory = header[156] === 53;
    const path = directory && name.endsWith('/') ? name.slice(0, -1) : name;
    if (
      !path ||
      path.includes('\\') ||
      Array.from(path, (character) => character.charCodeAt(0)).some(
        (code) => code < 32 || code === 127,
      ) ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !BUILD_PATHS.some((base) => path === base || path.startsWith(`${base}/`))
    )
      throw Error(`workspace-build unsafe archive path: ${JSON.stringify(path)}`);
    if ((!directory && header[156] !== 48 && header[156] !== 0) || text(157, 100))
      throw Error('workspace-build archive contains a link or unsupported entry');
    if (seen.has(path)) throw Error(`workspace-build duplicate archive path: ${path}`);
    seen.add(path);
    const size = number(124, 12);
    const end = offset + 512 + size;
    if ((directory && size !== 0) || end > bytes.length)
      throw Error('workspace-build truncated or invalid tar entry');
    result.push({
      path,
      directory,
      mode: number(100, 8) & 0o777,
      data: bytes.subarray(offset + 512, end),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw Error('workspace-build truncated tar archive');
}

export function packBuild({ root = '.', out = '.cache/workspace-build', commit } = {}) {
  root = realpathSync(root);
  const identity = checkout(root, commit);
  clean(root);
  const sourceBytes = regularFile(join(root, 'next-site-identity.json'));
  const source = JSON.parse(sourceBytes).deploySource;
  sourceIdentity(source, commit);
  const artifactDir = resolve(root, out);
  if (
    BUILD_PATHS.some((path) => {
      const rel = relative(join(root, path), artifactDir);
      return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/');
    })
  )
    throw Error('workspace-build artifact directory must be outside compiled outputs');
  for (const path of BUILD_PATHS)
    if (!lstatSync(join(root, path)).isDirectory() || !validateTree(join(root, path)))
      throw Error(`workspace-build missing or empty compiled directory: ${path}`);
  mkdirSync(artifactDir, { recursive: true });
  execFileSync('tar', [
    '--format=ustar',
    '--hard-dereference',
    '--create',
    '--file',
    join(artifactDir, ARCHIVE),
    '--directory',
    root,
    '--',
    ...BUILD_PATHS,
  ]);
  const archive = regularFile(join(artifactDir, ARCHIVE));
  const fileCount = entries(archive).filter((entry) => !entry.directory).length;
  const receipt = {
    schema: SCHEMA,
    ...identity,
    archiveSha256: sha256(archive),
    paths: BUILD_PATHS,
    sourceIdentity: { ...source, identitySha256: sha256(sourceBytes) },
  };
  writeFileSync(join(artifactDir, RECEIPT), JSON.stringify(receipt, null, 2) + '\n');
  return { artifactDir, ...receipt, fileCount };
}

function safeParents(root, path) {
  let parent = root;
  for (const part of path.split('/')) {
    parent = join(parent, part);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory())
      throw Error(`workspace-build destination contains a link or non-directory: ${parent}`);
  }
}

export function restoreBuild({ root = '.', from = '.cache/workspace-build', commit } = {}) {
  root = realpathSync(root);
  const identity = checkout(root, commit);
  const artifactDir = resolve(root, from);
  const receipt = JSON.parse(regularFile(join(artifactDir, RECEIPT)));
  if (receipt.schema !== SCHEMA || receipt.commit !== identity.commit)
    throw Error('workspace-build receipt commit/schema mismatch');
  if (receipt.lockSha256 !== identity.lockSha256) throw Error('workspace-build lockfile mismatch');
  if (JSON.stringify(receipt.paths) !== JSON.stringify(BUILD_PATHS))
    throw Error('workspace-build receipt paths mismatch');
  sourceIdentity(receipt.sourceIdentity, commit);
  if (!/^[a-f0-9]{64}$/.test(receipt.sourceIdentity.identitySha256 ?? ''))
    throw Error('workspace-build missing source identity digest');
  clean(root);
  const archive = regularFile(join(artifactDir, ARCHIVE));
  if (sha256(archive) !== receipt.archiveSha256)
    throw Error('workspace-build archive digest mismatch');
  const files = entries(archive);
  for (const path of BUILD_PATHS) safeParents(root, path);
  const stage = mkdtempSync(join(root, '.workspace-build-'));
  try {
    for (const entry of files) {
      const target = join(stage, entry.path);
      if (entry.directory) mkdirSync(target, { recursive: true });
      else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, entry.data, { flag: 'wx', mode: entry.mode });
      }
    }
    for (const path of BUILD_PATHS) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { recursive: true, force: true });
      renameSync(join(stage, path), target);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return { ...receipt, fileCount: files.filter((entry) => !entry.directory).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--root', '--out', '--from', '--commit'].includes(name) || !args[index + 1])
      throw Error(
        'usage: workspace-build.mjs pack --out DIR --commit SHA | restore --from DIR --commit SHA',
      );
    options[name.slice(2)] = args[index + 1];
  }
  if (!['pack', 'restore'].includes(command))
    throw Error('workspace-build requires pack or restore');
  console.log(JSON.stringify(command === 'pack' ? packBuild(options) : restoreBuild(options)));
}
