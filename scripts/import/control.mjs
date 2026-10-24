// The control artifact: the live candidate build the port is checked against (fm-gpx). Its bytes live in a
// release asset of this repository (classic CI artifacts expire); import/control-artifact.json records its
// identity and the digest of every file. It is classic's build, never this repository's.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, readJson, sha256 } from '../inventory/lib.mjs';

export const CONTROL = join(REPO, 'import/control-artifact.json');
export const CONTROL_LABEL = 'control (classic candidate build; not built by this repository)';

// Every regular file under dir as {path (posix, relative), sha256, bytes}, sorted by path.
export function digestTree(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile())
        out.push({
          path: relative(dir, path).split('\\').join('/'),
          sha256: sha256(readFileSync(path)),
          bytes: st.size,
        });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// Compares an unpacked store with the recorded files: one finding per missing, extra or changed file.
export function storeFindings(dir, files) {
  const actual = new Map(digestTree(dir).map((f) => [f.path, f]));
  const out = [];
  for (const f of files) {
    const got = actual.get(f.path);
    if (!got) out.push({ path: f.path, problem: 'missing', expected: f.sha256 });
    else if (got.sha256 !== f.sha256 || got.bytes !== f.bytes)
      out.push({
        path: f.path,
        problem: 'mismatch',
        expected: f.sha256,
        actual: got.sha256,
        bytes: got.bytes,
      });
    actual.delete(f.path);
  }
  for (const f of actual.values()) out.push({ path: f.path, problem: 'extra', actual: f.sha256 });
  return out;
}

export function unzip(zip, dest) {
  const r = spawnSync('unzip', ['-q', '-o', zip, '-d', dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`unzip ${zip} failed: ${r.stderr.trim() || r.status}`);
}

export const readControl = () => readJson(CONTROL);
