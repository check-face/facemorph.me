#!/usr/bin/env node
// Split the live npm-test inventory, rather than maintaining a second list of tests.
// Unknown shell syntax, lifecycle hooks or runners fail closed: update this adapter when npm test changes.
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeInventory } from './scaffold-scopes.mjs';

export const SHARDS = 6;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function tokens(command) {
  const words = command.match(/'[^']*'|"[^"]*"|[^\s]+/g) ?? [];
  return words.map((word) => {
    const value = /^(['"])(.*)\1$/.exec(word)?.[2] ?? word;
    if (!/^[\w./*=-]+$/.test(value)) throw Error(`Unsupported npm test argument: ${word}`);
    return value;
  });
}

export function inventory(root = ROOT) {
  const pkg = (cwd) => {
    const value = JSON.parse(readFileSync(resolve(root, cwd, 'package.json'), 'utf8'));
    for (const hook of ['pretest', 'posttest']) {
      if (value.scripts?.[hook]) throw Error(`Unadapted ${cwd || 'root'} ${hook}`);
    }
    return value;
  };
  const top = pkg('');
  const commands = top.scripts.test.split(/\s*&&\s*/);
  if (commands.shift() !== 'npm test --workspaces --if-present')
    throw Error('Unadapted root workspace test invocation');
  const suites = top.workspaces.flatMap((cwd) => {
    const script = pkg(cwd).scripts?.test;
    return script ? [{ cwd, command: script }] : [];
  });
  suites.push(...commands.map((command) => ({ cwd: '', command })));
  return suites.map(({ cwd, command }) => {
    const args = tokens(command);
    let prefix;
    if (args[0] === 'node' && args[1] === '--test') prefix = args.splice(0, 2);
    else if (
      cwd === 'packages/browser-model-manager' &&
      args[0] === 'node' &&
      args[1] === 'test/run.mjs'
    )
      prefix = args.splice(0, 2);
    else if (args[0] === 'python3' && args.length === 2 && args[1].endsWith('.py'))
      prefix = args.splice(0, 1);
    else throw Error(`Unadapted npm test command: ${cwd}: ${command}`);
    const files = args.flatMap((pattern) => {
      if (pattern.startsWith('-')) throw Error(`Unadapted test option: ${pattern}`);
      const found = globSync(pattern, { cwd: resolve(root, cwd) }).sort();
      if (!found.length) throw Error(`Empty npm test pattern: ${cwd}: ${pattern}`);
      return found;
    });
    if (new Set(files).size !== files.length) throw Error(`Overlapping npm test globs: ${cwd}`);
    return { cwd, prefix, files };
  });
}

export function shardInventory(suites, shard, count = SHARDS) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(shard) ||
    shard < 1 ||
    shard > count
  )
    throw Error('Expected an integer shard in 1..count');
  let offset = 0;
  return suites.flatMap((suite) => {
    const files = suite.files.filter(() => offset++ % count === shard - 1);
    return files.length ? [{ ...suite, files }] : [];
  });
}

export function workspaceInventory(suites, cwd) {
  const selected = suites.filter((suite) => suite.cwd === cwd);
  if (!cwd || selected.length !== 1) throw Error('Expected one known npm-test workspace');
  return selected;
}

// Measured multi-minute inference journeys belong to mandatory pre-deploy qualification.
// Full remains the default. Exact paths keep every other live npm-test file in quick mode.
const PRE_DEPLOY_ONLY = new Set([
  'packages/stylegan-js/test/full31/full31.test.ts',
  'packages/stylegan-js/test/engine/browsers.test.ts',
  'packages/stylegan-js/test/engine/caller-loaded-example.test.ts',
  'packages/stylegan-js/test/engine/cpu.test.ts',
]);

export function partitionInventory(suites, quick = false) {
  const select = (deferred) =>
    suites.flatMap((suite) => {
      const files = suite.files.filter((file) => {
        const path = suite.cwd ? `${suite.cwd}/${file}` : file;
        return (quick && PRE_DEPLOY_ONLY.has(path)) === deferred;
      });
      return files.length ? [{ ...suite, files }] : [];
    });
  return { run: select(false), deferred: select(true) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [mode, value, flag] = args;
  const suites = inventory();
  if (mode === '--list' && args.length === 1) console.log(JSON.stringify(suites, null, 2));
  else if (
    ((mode === '--shard' && /^\d+$/.test(value ?? '')) || mode === '--workspace') &&
    (args.length === 2 || (args.length === 3 && flag === '--quick'))
  ) {
    const quick = flag === '--quick';
    const selected = partitionInventory(
      mode === '--workspace'
        ? workspaceInventory(suites, value)
        : shardInventory(suites, Number(value)),
      quick,
    );
    const scoped = scopeInventory(
      selected.run,
      quick ? JSON.parse(process.env.FACEMORPH_CHANGED_FILES || 'null') : null,
    );
    if (scoped.deferred.length)
      console.log(
        JSON.stringify({
          event: 'unaffected-package-tests',
          reason:
            'Audited CI orchestration changes retain root and app topology tests; full qualification runs all',
          files: scoped.deferred.flatMap(({ cwd, files }) => files.map((file) => `${cwd}/${file}`)),
        }),
      );
    if (selected.deferred.length)
      console.log(
        JSON.stringify({
          event: 'deferred-pre-deploy-tests',
          reason:
            'Measured engine inference journeys run in mandatory full pre-deploy qualification',
          files: selected.deferred.flatMap(({ cwd, files }) =>
            files.map((file) => `${cwd}/${file}`),
          ),
        }),
      );
    for (const { cwd, prefix, files } of scoped.run) {
      console.log(JSON.stringify({ cwd: cwd || '.', command: [...prefix, ...files] }));
      const [executable, ...args] = [...prefix, ...files];
      const result = spawnSync(executable === 'node' ? process.execPath : executable, args, {
        cwd: resolve(ROOT, cwd),
        stdio: 'inherit',
        env: process.env,
      });
      if (result.error) console.error(result.error);
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  } else
    throw Error(
      'Usage: scaffold-test-shards.mjs --list | --shard N [--quick] | --workspace PATH [--quick]',
    );
}
