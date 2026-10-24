// Shared helpers for the import-input inventory (fm-fy2.1). Everything reads classic's Git objects at a
// named commit, never its working tree, which holds other sessions' uncommitted edits.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ALLOWLIST = join(REPO, 'import/allowlist.json');
export const BUILD_INPUTS = join(REPO, 'import/build-inputs.json');
export const LICENCES = join(REPO, 'import/licences.json');

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const line = (value) => process.stdout.write(JSON.stringify(value) + '\n');

// `--name value` options; a bare `--flag` is `true`. Positional arguments are ignored.
export function options(argv, defaults = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)$/);
    if (!m) continue;
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = true;
  }
  return out;
}

// Classic's checkout: --classic, then $CLASSIC_DIR, then the sibling directory the workspace guide names.
export function classicDir(opts) {
  const dir = resolve(
    opts.classic ?? process.env.CLASSIC_DIR ?? join(REPO, '../facemorph.me-classic'),
  );
  if (!existsSync(join(dir, '.git')))
    throw new Error(`No classic Git checkout at ${dir} (pass --classic or set CLASSIC_DIR)`);
  return dir;
}

export function git(dir, args, { encoding = 'utf8', input } = {}) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding, input, maxBuffer: 1 << 30 });
  if (r.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr?.toString().trim()}`);
  return r.stdout;
}

export const trackedFiles = (dir, commit) =>
  git(dir, ['ls-tree', '-r', '-z', '--name-only', commit]).split('\0').filter(Boolean);
export const blob = (dir, commit, path) =>
  git(dir, ['cat-file', 'blob', `${commit}:${path}`], { encoding: 'buffer' });

// A ustar/pax reader for `git archive --format=tar` output: returns the pax global comment (git writes
// the commit id there) and every regular file as {path, bytes}.
export function untar(buffer) {
  const files = [];
  let comment = null;
  let pending = null;
  const text = (off, len) => buffer.toString('utf8', off, off + len).replace(/\0.*$/s, '');
  const pax = (body) => {
    const out = {};
    let i = 0;
    while (i < body.length) {
      const space = body.indexOf(0x20, i);
      const len = Number(body.toString('utf8', i, space));
      const [key, ...rest] = body.toString('utf8', space + 1, i + len - 1).split('=');
      out[key] = rest.join('=');
      i += len;
    }
    return out;
  };
  for (let off = 0; off + 512 <= buffer.length;) {
    if (buffer.subarray(off, off + 512).every((b) => b === 0)) break;
    const size = parseInt(text(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buffer[off + 156] || 0x30);
    const body = buffer.subarray(off + 512, off + 512 + size);
    const prefix = text(off + 345, 155);
    const name = prefix ? `${prefix}/${text(off, 100)}` : text(off, 100);
    if (type === 'g') comment = pax(body).comment ?? comment;
    else if (type === 'x') pending = pax(body);
    else {
      if (type === '0') files.push({ path: pending?.path ?? name, bytes: Buffer.from(body) });
      pending = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return { comment, files };
}

// Glob over repository-relative paths: `**` crosses directories, `*` and `?` stay inside one segment, and
// a pattern ending in `/` matches everything under that directory.
export function globRegExp(pattern) {
  const p = pattern.endsWith('/') ? `${pattern}**` : pattern;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const matches = (path, patterns) => patterns.some((p) => globRegExp(p).test(path));

// The runtime files a manifest pins, as {path: {sha256, bytes, of?}} with paths relative to runtime/ —
// the same walk as classic's hosting/next-static/mirror-runtime.py `pinned()` (which also refuses a URL
// on another origin; here any URL under /runtime/ is taken): a manifestUrl/workerUrl
// pair, then any node with a sha256 and an integer size (a chunked asset contributes its chunks only,
// each marked `of` its asset with the asset's digest as `of_sha256`; `file` entries resolve against the
// manifest's own directory).
export function pinnedRuntime(node, base = '', out = {}, of = undefined) {
  const rel = (url) => {
    const at = url.indexOf('/runtime/');
    if (at < 0) throw new Error(`Runtime URL outside /runtime/: ${url}`);
    return url.slice(at + '/runtime/'.length);
  };
  const add = (path, sha256, bytes) => {
    out[path] = { sha256, bytes, ...(of ? of : {}) };
  };
  if (Array.isArray(node)) {
    for (const v of node) pinnedRuntime(v, base, out, of);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (typeof node.manifestUrl === 'string' && node.manifestSha256) {
    add(rel(node.manifestUrl), node.manifestSha256, null);
    if (node.workerUrl) add(rel(node.workerUrl), node.workerSha256, null);
  }
  if (typeof node.sha256 === 'string' && node.sha256.length === 64 && Number.isInteger(node.size)) {
    const self =
      typeof node.url === 'string'
        ? rel(node.url)
        : typeof node.file === 'string' && !node.file.includes('/')
          ? base
            ? `${base}/${node.file}`
            : node.file
          : null;
    if (node.chunks?.length)
      return pinnedRuntime(
        node.chunks,
        base,
        out,
        self ? { of: self, of_sha256: node.sha256 } : of,
      );
    if (self) {
      add(self, node.sha256, node.size);
      return out;
    }
  }
  for (const v of Object.values(node)) pinnedRuntime(v, base, out, of);
  return out;
}

// Every commit after `from` up to `to` (oldest first), with the paths it changed.
export function delta(dir, from, to) {
  const out = git(dir, [
    'log',
    '--reverse',
    '--format=%x01%H%x09%cI%x09%s',
    '--name-status',
    '--no-renames',
    `${from}..${to}`,
  ]);
  return out
    .split('\x01')
    .filter(Boolean)
    .map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      const [commit, date, subject] = head.split('\t');
      const paths = rest.filter(Boolean).map((l) => {
        const [status, path] = l.split('\t');
        return { status, path };
      });
      return { commit, date, subject, paths };
    });
}
