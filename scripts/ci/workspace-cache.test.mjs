import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./workspace-cache.sh', import.meta.url));
const realCp = spawnSync('sh', ['-c', 'command -v cp'], { encoding: 'utf8' }).stdout.trim();

function exercise(destinationBase, crossDevice) {
  const root = mkdtempSync(join(tmpdir(), 'fm-workspace-cache-'));
  const workspace = mkdtempSync(join(destinationBase, 'fm-workspace-restore-'));
  try {
    const cache = join(root, 'cache');
    const lock = '{"lockfileVersion":3}\n';
    writeFileSync(join(workspace, 'package-lock.json'), lock);
    const hash = createHash('sha256').update(lock).digest('hex');
    const machine = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim();
    const key = `node${process.versions.node.split('.')[0]}-${machine}-${hash}`;
    const store = join(cache, 'root', key);
    mkdirSync(join(store, 'node_modules', 'dependency'), { recursive: true });
    mkdirSync(join(store, 'packages', 'fixture', 'node_modules', 'nested'), { recursive: true });
    writeFileSync(join(store, '.dirs'), 'node_modules\npackages/fixture/node_modules\n');
    const cached = join(store, 'node_modules', 'dependency', 'index.js');
    const bytes = 'module.exports = 42;\n';
    writeFileSync(cached, bytes);
    chmodSync(cached, 0o444);
    writeFileSync(join(store, 'packages/fixture/node_modules/nested/index.js'), bytes);
    symlinkSync('../packages/fixture', join(store, 'node_modules', 'fixture'));
    mkdirSync(join(workspace, 'packages', 'fixture'), { recursive: true });
    writeFileSync(join(workspace, 'packages/fixture/index.js'), 'module.exports = 7;\n');
    // Observe real cp invocations without replacing their filesystem behavior.
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'cp.jsonl');
    writeFileSync(
      join(bin, 'cp'),
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.CP_LOG, JSON.stringify(process.argv.slice(2))+'\\n');
const result=require('node:child_process').spawnSync(process.env.REAL_CP,process.argv.slice(2),{stdio:'inherit'});
if(result.error) throw result.error;
process.exit(result.status ?? 1);
`,
      { mode: 0o755 },
    );
    const result = spawnSync('bash', [script], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
        FACEMORPH_NODE_MODULES_CACHE: cache,
        CP_LOG: log,
        REAL_CP: realCp,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.result, 'hit');
    assert.equal(receipt.key, key);
    const restored = join(workspace, 'node_modules/dependency/index.js');
    assert.equal(readFileSync(restored, 'utf8'), bytes);
    assert.equal(readFileSync(cached, 'utf8'), bytes);
    assert.equal(statSync(restored).mode & 0o222, 0);
    assert.equal(
      realpathSync(join(workspace, 'node_modules/fixture')),
      join(workspace, 'packages/fixture'),
    );
    assert.equal(
      readFileSync(join(workspace, 'packages/fixture/node_modules/nested/index.js'), 'utf8'),
      bytes,
    );
    assert.deepEqual(readdirSync(workspace).sort(), [
      'node_modules',
      'package-lock.json',
      'packages',
    ]);
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (crossDevice) {
      assert.equal(receipt.how, 'copy');
      assert(
        !calls.some(
          (args) => args.includes('--reflink=always') && args.includes(join(store, 'node_modules')),
        ),
        'unsupported reflink must be discovered before traversing the real dependency tree',
      );
    } else if (receipt.how === 'hardlink')
      assert.equal(statSync(restored).ino, statSync(cached).ino);
    else assert.equal(receipt.how, 'reflink');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('a real cache hit preserves installed bytes, readonly modes and local workspace links', () =>
  exercise(tmpdir(), false));
test(
  'cross-filesystem restore copies directly after a tiny unsupported reflink probe',
  { skip: !existsSync('/dev/shm') || statSync('/dev/shm').dev === statSync(tmpdir()).dev },
  () => exercise('/dev/shm', true),
);
