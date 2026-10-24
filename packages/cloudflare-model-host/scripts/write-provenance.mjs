// Writes PROVENANCE.json at the package root after a build (fm-3osh): the package name and version, the commit the
// build came from and whether the tree was clean. Read by the tarball content scan's required-file rule.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no', '--', '.');
const record = {
  schema: 'facemorph.package-provenance/1',
  name: pkg.name,
  version: pkg.version,
  sourceCommit: head.status === 0 ? head.stdout.trim() : null,
  sourceTreeClean: dirty.status === 0 ? dirty.stdout.trim() === '' : null,
};
writeFileSync(
  new URL('../PROVENANCE.json', import.meta.url),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(JSON.stringify(record));
