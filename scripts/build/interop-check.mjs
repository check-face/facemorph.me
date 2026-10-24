#!/usr/bin/env node
// fm-fy2.4 interop checks for the JS-closure boundary.
//   node scripts/build/interop-check.mjs [--base <git-ref>]
// 1. Every adapter - a package source file that imports the candidate closure's .mjs
//    modules - must declare its test: `// adapter-test: <path to an existing test file>`.
// 2. With --base, a rename-only .mjs -> .ts change inside package/app sources (git
//    detects it as R100) fails: interop goes through narrow adapters, never mechanical
//    renames. Prints one JSON line per violation; exit 1 on any.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ADAPTER_TEST_MARKER = /(?:^|\n)\s*\/\/\s*adapter-test:\s*(\S+)/;

export function findAdapters(sources) {
  // sources: Map<path, content>. An adapter imports a .mjs module from outside its own
  // package sources (the candidate closure ships as .mjs).
  const adapters = [];
  for (const [path, content] of sources) {
    if (!path.endsWith('.ts') && !path.endsWith('.tsx')) continue;
    const closureImport = /from\s+['"][^'"]*\.mjs['"]/.test(content);
    if (closureImport) adapters.push(path);
  }
  return adapters;
}

// `exists` answers whether a declared test file exists: the filesystem in a real run, a plain set in unit tests.
export function judgeAdapters(sources, exists = existsSync) {
  const violations = [];
  for (const path of findAdapters(sources)) {
    const match = sources.get(path).match(ADAPTER_TEST_MARKER);
    if (!match) {
      violations.push({
        path,
        rule: 'adapter-test-missing',
        detail: 'declares `// adapter-test: <file>` next to the closure import',
      });
      continue;
    }
    if (!exists(match[1])) {
      violations.push({ path, rule: 'adapter-test-file-missing', detail: match[1] });
    }
  }
  return violations;
}

export function judgeRenames(nameStatusPairs) {
  // pairs: [status, oldPath, newPath?] - R100 .mjs -> .ts inside app/package sources is a
  // mechanical rename; everything else is fine.
  const violations = [];
  for (const pair of nameStatusPairs) {
    const [status, oldPath, newPath] = pair;
    if (status === 'R100' && oldPath.endsWith('.mjs') && newPath && /\.tsx?$/.test(newPath)) {
      violations.push({
        rule: 'rename-only-interop',
        detail: `${oldPath} -> ${newPath} changed only the extension`,
      });
    }
  }
  return violations;
}

function gitNameStatus(base, root) {
  const out = execFileSync(
    'git',
    ['-C', root, 'diff', '--name-status', '-M100%', `${base}..HEAD`],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

function main() {
  const args = process.argv.slice(2);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  let violations = [];

  const sources = new Map();
  const packagesRoot = `${root}packages`;
  if (existsSync(packagesRoot)) {
    for (const pkg of readdirSync(packagesRoot)) {
      const src = `${packagesRoot}/${pkg}/src`;
      if (!existsSync(src)) continue;
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = `${dir}/${entry.name}`;
          if (entry.isDirectory()) walk(p);
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
            sources.set(p, readFileSync(p, 'utf8'));
        }
      };
      walk(src);
    }
  }
  violations.push(...judgeAdapters(sources));

  const baseIndex = args.indexOf('--base');
  if (baseIndex >= 0) violations.push(...judgeRenames(gitNameStatus(args[baseIndex + 1], root)));

  for (const v of violations) console.log(JSON.stringify(v));
  if (violations.length > 0) {
    console.error(`interop: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.error('interop: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
