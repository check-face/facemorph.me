#!/usr/bin/env node
// External consumer check (fm-hwh): build and pack @facemorph/stylegan-js and
// @facemorph/browser-model-manager, install the tarballs into a fresh project outside the workspace
// graph (no path aliases, no workspace links), and compile tests/external-consumer/consumer against
// what the packages emit. Fails unless tsc succeeds and every @facemorph file it reads is a .d.ts.
//   node tests/external-consumer/run.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const packages = ['packages/stylegan-js', 'packages/browser-model-manager'];
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const work = mkdtempSync(join(tmpdir(), 'facemorph-consumer-'));
const packs = join(work, 'packs');
mkdirSync(packs);
for (const p of packages) {
  run('npm', ['run', 'build', '-w', p], root);
  run('npm', ['pack', '-w', p, '--pack-destination', packs], root);
}
const tarballs = readdirSync(packs).filter((f) => f.endsWith('.tgz')).map((f) => join(packs, f));
const project = join(work, 'consumer');
cpSync(join(here, 'consumer'), project, { recursive: true });
const typescript = JSON.parse(run('npm', ['pkg', 'get', 'devDependencies.typescript'], root)).replace(/^\^|~/, '');
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'external-consumer', private: true, type: 'module' }, null, 2));
run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...tarballs, `typescript@${typescript}`], project);
const files = run(join(project, 'node_modules/.bin/tsc'), ['-p', '.', '--listFilesOnly'], project).split('\n').filter(Boolean);
run(join(project, 'node_modules/.bin/tsc'), ['-p', '.'], project);
const ours = files.filter((f) => f.includes('/node_modules/@facemorph/'));
const sources = ours.filter((f) => !f.endsWith('.d.ts'));
console.log(JSON.stringify({ event: 'external-consumer', ok: sources.length === 0 && ours.length > 0, project, declarations: ours.length, sources }));
if (sources.length || ours.length === 0) process.exitCode = 1;
