import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { BUILD_FILES, BUILD_PATHS, packBuild, restoreBuild } from './workspace-build.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workspace-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, '.gitignore'),
    '**/dist\n**/PROVENANCE.json\n.cache/\nnext-site-identity.json\n',
  );
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'source.js'), 'export const source = true;\n');
  git(root, 'init', '--quiet');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  const commit = git(root, 'rev-parse', 'HEAD');
  writeFileSync(
    join(root, 'next-site-identity.json'),
    JSON.stringify({
      deploySource: {
        repository: 'facemorph-me/facemorph.me',
        commit,
        buildId: commit,
        sourceTreeClean: true,
        sourceTreeSha256: '1'.repeat(64),
      },
    }),
  );
  for (const path of BUILD_PATHS) {
    mkdirSync(join(root, path, '.vite'), { recursive: true });
    writeFileSync(join(root, path, 'output.bin'), Buffer.from([0, 1, 2, 255]));
    writeFileSync(join(root, path, '.vite', 'manifest.json'), JSON.stringify({ path }));
  }
  for (const path of BUILD_FILES)
    writeFileSync(join(root, path), JSON.stringify({ sourceCommit: commit, path }));
  return { root, commit, out: '.cache/workspace-build', from: '.cache/workspace-build' };
}

function changeReceipt(f, update) {
  const path = join(f.root, f.from, 'workspace-build.json');
  const receipt = JSON.parse(readFileSync(path));
  update(receipt);
  writeFileSync(path, JSON.stringify(receipt));
}

function changeArchive(f, update) {
  const path = join(f.root, f.from, 'workspace-build.tar');
  const bytes = update(readFileSync(path));
  writeFileSync(path, bytes);
  changeReceipt(f, (receipt) => {
    receipt.archiveSha256 = hash(bytes);
  });
}

test('real USTAR roundtrip restores four trees, package provenance and hidden Vite metadata', (t) => {
  const f = fixture(t);
  const packed = packBuild(f);
  assert.equal(packed.fileCount, 11);
  assert.equal(packed.sourceIdentity.commit, f.commit);
  assert.equal(packed.lockSha256, hash(readFileSync(join(f.root, 'package-lock.json'))));
  assert.deepEqual(readdirSync(join(f.root, f.out)).sort(), [
    'workspace-build.json',
    'workspace-build.tar',
  ]);
  for (const path of BUILD_PATHS) {
    rmSync(join(f.root, path), { recursive: true });
    mkdirSync(join(f.root, path));
    writeFileSync(join(f.root, path, 'stale'), 'replace me');
  }
  for (const path of BUILD_FILES) writeFileSync(join(f.root, path), 'stale provenance');
  const restored = restoreBuild(f);
  assert.equal(restored.archiveSha256, packed.archiveSha256);
  for (const path of BUILD_PATHS) {
    assert.deepEqual(readFileSync(join(f.root, path, 'output.bin')), Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, path, '.vite', 'manifest.json'))), {
      path,
    });
    assert.equal(existsSync(join(f.root, path, 'stale')), false);
  }
  for (const path of BUILD_FILES)
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, path))), {
      sourceCommit: f.commit,
      path,
    });
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
  assert.equal(
    readdirSync(f.root).some((name) => name.startsWith('.workspace-build-')),
    false,
  );
});

test('missing producer provenance and symlinked destination provenance are refused', (t) => {
  const f = fixture(t);
  packBuild(f);
  const path = join(f.root, BUILD_FILES[0]);
  rmSync(path);
  assert.throws(() => packBuild(f), /ENOENT/);
  symlinkSync(join(f.root, 'source.js'), path);
  assert.throws(() => restoreBuild(f), /destination contains a link or non-file/);
  assert.throws(() => packBuild(f), /regular file/);
  assert.equal(readFileSync(join(f.root, 'source.js'), 'utf8'), 'export const source = true;\n');
});

test('pack and restore CLI use the same receipt and fail when a required commit is omitted', (t) => {
  const f = fixture(t);
  const helper = new URL('./workspace-build.mjs', import.meta.url);
  for (const command of ['pack', 'restore']) {
    const output = execFileSync(
      process.execPath,
      [
        helper.pathname,
        command,
        '--root',
        f.root,
        command === 'pack' ? '--out' : '--from',
        f.out,
        '--commit',
        f.commit,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(JSON.parse(output).commit, f.commit);
  }
  assert.throws(
    () =>
      execFileSync(process.execPath, [helper.pathname, 'pack', '--root', f.root], {
        stdio: 'pipe',
      }),
    /Command failed/,
  );
});

test('changed checkout commit is refused before restoring anything', (t) => {
  const f = fixture(t);
  packBuild(f);
  git(
    f.root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '--quiet',
    '-m',
    'different source',
  );
  assert.throws(() => restoreBuild(f), /commit/);
  assert.throws(
    () => restoreBuild({ ...f, commit: git(f.root, 'rev-parse', 'HEAD') }),
    /receipt commit/,
  );
});

test('changed lockfile and dirty source are refused', (t) => {
  const f = fixture(t);
  packBuild(f);
  writeFileSync(join(f.root, 'package-lock.json'), '{}');
  assert.throws(() => restoreBuild(f), /lockfile mismatch/);
  git(f.root, 'restore', 'package-lock.json');
  writeFileSync(join(f.root, 'source.js'), 'changed source');
  assert.throws(() => restoreBuild(f), /clean source checkout/);
  assert.throws(() => packBuild(f), /clean source checkout/);
});

test('archive corruption is refused and existing output bytes survive', (t) => {
  const f = fixture(t);
  packBuild(f);
  const archive = join(f.root, f.out, 'workspace-build.tar');
  const bytes = readFileSync(archive);
  bytes[520] ^= 1;
  writeFileSync(archive, bytes);
  assert.throws(() => restoreBuild(f), /archive digest mismatch/);
  assert.deepEqual(
    readFileSync(join(f.root, BUILD_PATHS[0], 'output.bin')),
    Buffer.from([0, 1, 2, 255]),
  );
});

test('receipt paths and dirty or different source identities are refused', (t) => {
  const f = fixture(t);
  for (const update of [
    (receipt) => {
      receipt.paths.push('node_modules');
    },
    (receipt) => {
      receipt.sourceIdentity.commit = 'f'.repeat(40);
    },
    (receipt) => {
      receipt.sourceIdentity.sourceTreeClean = false;
    },
    (receipt) => {
      receipt.sourceIdentity.sourceTreeSha256 = null;
    },
  ]) {
    packBuild(f);
    changeReceipt(f, update);
    assert.throws(() => restoreBuild(f), /receipt paths|source identity/);
  }
  const path = join(f.root, 'next-site-identity.json');
  const identity = JSON.parse(readFileSync(path));
  identity.deploySource.sourceTreeClean = false;
  writeFileSync(path, JSON.stringify(identity));
  assert.throws(() => packBuild(f), /source identity/);
});

test('a correctly rehashed traversal archive is refused before any destination write', (t) => {
  const f = fixture(t);
  packBuild(f);
  changeArchive(f, (bytes) => {
    const header = bytes.subarray(0, 512);
    header.fill(0, 0, 100);
    header.write('../escaped/');
    header.fill(32, 148, 156);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return bytes;
  });
  assert.throws(() => restoreBuild(f), /unsafe archive path/);
  assert.equal(existsSync(join(dirname(f.root), 'escaped')), false);
  assert.deepEqual(
    readFileSync(join(f.root, BUILD_PATHS[0], 'output.bin')),
    Buffer.from([0, 1, 2, 255]),
  );
});

test('links are refused in producer trees, incoming tar and destination parents', (t) => {
  const f = fixture(t);
  packBuild(f);
  const link = join(f.root, BUILD_PATHS[0], 'linked');
  symlinkSync('/tmp', link);
  assert.throws(() => packBuild(f), /links or special files/);
  execFileSync('tar', [
    '--format=ustar',
    '--create',
    '--file',
    join(f.root, f.out, 'workspace-build.tar'),
    '--directory',
    f.root,
    '--',
    ...BUILD_PATHS,
  ]);
  changeArchive(f, (bytes) => bytes);
  assert.throws(() => restoreBuild(f), /link or unsupported/);
  rmSync(link);
  packBuild(f);
  rmSync(join(f.root, BUILD_PATHS[0]), { recursive: true });
  symlinkSync('/tmp', join(f.root, BUILD_PATHS[0]));
  assert.throws(() => restoreBuild(f), /destination contains a link/);
});

test('missing or empty compiled trees and output inside a compiled tree are refused', (t) => {
  const f = fixture(t);
  assert.throws(() => packBuild({ ...f, out: `${BUILD_PATHS[0]}/artifact` }), /outside compiled/);
  rmSync(join(f.root, BUILD_PATHS[1]), { recursive: true });
  mkdirSync(join(f.root, BUILD_PATHS[1]));
  assert.throws(() => packBuild(f), /empty compiled directory/);
});
