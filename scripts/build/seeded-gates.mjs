#!/usr/bin/env node
// Proves each gate fails when it should (fm-fy2.4): plants one violation at a time in a real file of the tree, runs
// the real gate command, expects it to fail, and removes the file again, then checks the clean tree passes every
// gate and that nothing was left behind. Planted files are inputs, not fakes.
//   node scripts/build/seeded-gates.mjs        (CI runs it after the gates; locally it writes and removes
//                                               uniquely named files under the workspace sources)
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const tag = `seeded-${process.pid}`;
const npm = (args) => spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8' });

const CASES = [
  {
    name: 'a 101-column line fails format:check',
    file: `packages/cloudflare-model-host/src/${tag}.ts`,
    text: `export const line = '${'x'.repeat(101 - "export const line = '';".length)}';\n`,
    run: ['run', 'format:check'],
  },
  {
    name: 'a warning-level finding fails lint',
    file: `apps/web/shell/${tag}.tsx`,
    text: "import { useEffect, useState } from 'react';\n\nexport function Seeded() {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    setN(n + 1);\n  }, []);\n  return null;\n}\n",
    run: ['run', 'lint'],
  },
  ...[
    ['apps/web', 'shell'],
    ['packages/stylegan-js', 'src'],
    ['packages/browser-model-manager', 'src'],
    ['packages/cloudflare-model-host', 'src'],
  ].map(([w, dir]) => ({
    name: `a type error in ${w} fails typecheck`,
    file: `${w}/${dir}/${tag}.ts`,
    text: "export const n: number = 'not a number';\n",
    run: ['run', 'typecheck', '-w', w],
  })),
  {
    name: 'a window reference in a shared contract fails typecheck',
    file: `packages/stylegan-js/src/contracts/${tag}.ts`,
    text: 'export const width = window.innerWidth;\n',
    run: ['run', 'typecheck', '-w', 'packages/stylegan-js'],
  },
  {
    name: 'a process reference in a worker module fails typecheck',
    file: `packages/cloudflare-model-host/src/${tag}.ts`,
    text: 'export const mode = process.env.NODE_ENV;\n',
    run: ['run', 'typecheck', '-w', 'packages/cloudflare-model-host'],
  },
];

const results = [];
for (const c of CASES) {
  const path = join(ROOT, c.file);
  if (existsSync(path)) throw new Error(`${c.file} exists already`);
  writeFileSync(path, c.text);
  let r;
  try {
    r = npm(c.run);
  } finally {
    unlinkSync(path);
  }
  // The failure must be this file's: a gate that was already failing for another reason proves nothing.
  results.push({
    case: c.name,
    command: `npm ${c.run.join(' ')}`,
    failed: r.status !== 0 && `${r.stdout}${r.stderr}`.includes(tag),
  });
}
for (const gate of [
  ['run', 'format:check'],
  ['run', 'lint'],
  ['run', 'typecheck'],
]) {
  const r = npm(gate);
  results.push({
    case: `the clean tree passes npm ${gate.join(' ')}`,
    command: `npm ${gate.join(' ')}`,
    failed: r.status !== 0,
    expectPass: true,
  });
}
const left = CASES.filter((c) => existsSync(join(ROOT, c.file))).map((c) => c.file);
for (const r of results) console.log(JSON.stringify(r));
const wrong = results.filter((r) => (r.expectPass ? r.failed : !r.failed));
console.log(
  JSON.stringify({ summary: { cases: results.length, wrong: wrong.length, leftBehind: left } }),
);
process.exit(wrong.length || left.length ? 1 : 0);
