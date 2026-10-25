#!/usr/bin/env node
// Install into the Agent Mail chain without replacing its guard or unrelated hooks.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2]
  ? resolve(process.argv[2])
  : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const setting = spawnSync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], {
  encoding: 'utf8',
});
if (setting.status !== 0 && setting.status !== 1) throw new Error(setting.stderr);
const config = setting.stdout.trim();
if (config)
  throw new Error(
    `core.hooksPath=${config}: install into the existing hook chain explicitly instead of replacing it`,
  );
const hooks = resolve(
  root,
  execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'hooks'], {
    encoding: 'utf8',
  }).trim(),
);
const checker = join(dirname(fileURLToPath(import.meta.url)), 'check.mjs');
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
for (const name of ['pre-commit', 'pre-push']) {
  const hook = join(hooks, name);
  if (
    existsSync(hook) &&
    !/mcp-agent-mail chain-runner|facemorph hook chain/.test(readFileSync(hook, 'utf8'))
  )
    throw new Error(`${hook} is a custom hook; preserve and chain it explicitly`);
  const dir = join(hooks, 'hooks.d', name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(hook)) {
    writeFileSync(
      hook,
      `#!/usr/bin/env python3\n# facemorph hook chain\nimport pathlib, subprocess, sys\ndata = ${name === 'pre-push' ? 'sys.stdin.buffer.read()' : "b''"}\nfor hook in sorted((pathlib.Path(__file__).parent / 'hooks.d' / '${name}').iterdir()):\n    if hook.is_file() and hook.stat().st_mode & 0o111:\n        result = subprocess.run([str(hook)], input=data)\n        if result.returncode: sys.exit(result.returncode)\n`,
    );
    chmodSync(hook, 0o755);
  }
  const plugin = join(dir, '60-fast-gates');
  const body = `#!/usr/bin/env bash\n# Versioned FaceMorph cheap gates; install.mjs owns this plugin.\nexec node ${quote(checker)} ${quote(name)}\n`;
  if (
    existsSync(plugin) &&
    !readFileSync(plugin, 'utf8').includes('install.mjs owns this plugin')
  ) {
    const backup = join(hooks, `${name}-60-fast-gates.before-versioned`);
    if (!existsSync(backup)) writeFileSync(backup, readFileSync(plugin));
  }
  writeFileSync(plugin, body);
  chmodSync(plugin, 0o755);
  console.log(`installed ${plugin}`);
}
