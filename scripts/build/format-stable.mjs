#!/usr/bin/env node
// `format` is stable and leaves frozen paths alone (fm-fy2.4): digests every tracked file, runs `npm run format`
// twice, and fails if the second run changed anything or if any tracked file under the scope's ignore list
// (frozen imports, generated, vendored) differs from its digest before the first run. It rewrites the tree, so it
// refuses to run on a tree with uncommitted changes: CI runs it on a clean checkout.
//   node scripts/build/format-stable.mjs
// One JSON line; exit 1 on any change it should not have made.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** The paths whose digests differ between two digest maps. */
export function changed(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((p) => before.get(p) !== after.get(p))
    .sort();
}

const digests = (files) =>
  new Map(
    files.map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(join(ROOT, f)))
        .digest('hex'),
    ]),
  );

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim())
    throw new Error('format-stable rewrites the tree: run it on a clean checkout');
  const { ignore } = JSON.parse(readFileSync(join(ROOT, 'scripts/build/oxc-scope.json'), 'utf8'));
  const tracked = run('git', ['ls-files', '-z']).split('\0').filter(Boolean);
  const frozen = tracked.filter((f) => ignore.some((g) => matchesGlob(f, g)));
  const start = digests(tracked);
  run('npm', ['run', 'format']);
  const once = digests(tracked);
  run('npm', ['run', 'format']);
  const twice = digests(tracked);
  const frozenStart = new Map(frozen.map((f) => [f, start.get(f)]));
  const frozenEnd = new Map(frozen.map((f) => [f, twice.get(f)]));
  const result = {
    tracked: tracked.length,
    frozen: frozen.length,
    firstRunChanged: changed(start, once),
    secondRunChanged: changed(once, twice),
    frozenChanged: changed(frozenStart, frozenEnd),
  };
  console.log(JSON.stringify(result));
  process.exit(result.secondRunChanged.length || result.frozenChanged.length ? 1 : 0);
}
