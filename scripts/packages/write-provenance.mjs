// Writes PROVENANCE.json at the root of the package being built (the working directory, as `npm run build -w`
// sets it) (fm-3osh, fm-oagi): the package name and version, the commit the build came from and whether the
// package's tree was clean. Read by the tarball content scan's required-file rule; ignored by Git.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.cwd();
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const head = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no', '--', '.');
const record = {
  schema: 'facemorph.package-provenance/1',
  name: pkg.name,
  version: pkg.version,
  sourceCommit: head.status === 0 ? head.stdout.trim() : null,
  sourceTreeClean: dirty.status === 0 ? dirty.stdout.trim() === '' : null,
};
writeFileSync(join(dir, 'PROVENANCE.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record));
