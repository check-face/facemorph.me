import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { globRegExp, matches, pinnedRuntime, untar } from './lib.mjs';
import { gitRepo } from './testing.mjs';

test('globs: ** crosses directories, * and ? stay in one segment, a trailing / means everything under it', () => {
  assert.ok(globRegExp('src/Next/').test('src/Next/browser/runtime.mjs'));
  assert.ok(globRegExp('src/**/*.fs').test('src/App.fs'));
  assert.ok(globRegExp('src/**/*.fs').test('src/Next/Assets/ModelAssets.fs'));
  assert.ok(!globRegExp('src/*.fs').test('src/Next/Product.fs'));
  assert.ok(!globRegExp('src/**/*.fs').test('src/Next/x.fs.js'));
  assert.ok(globRegExp('encoder-stream/*/part-???.onnx').test('encoder-stream/4178/part-012.onnx'));
  assert.ok(!globRegExp('assets/*/mapping.onnx').test('assets/a/b/mapping.onnx'));
  assert.ok(globRegExp('a+b(c).json').test('a+b(c).json'), 'regex metacharacters are literal');
  assert.ok(matches('Server/Index.fs', ['docs/', 'Server/']));
});

test('untar reads git archive output, including a path longer than 100 bytes and the commit comment', () => {
  const repo = gitRepo();
  const long = `${'deep/'.repeat(22)}file-with-a-long-name.txt`;
  assert.ok(long.length > 100);
  const commit = repo.commit({ 'a.txt': 'alpha\n', [long]: 'long\n', 'dir/b.bin': Buffer.from([0, 1, 2, 255]) }, 'one');
  const archive = spawnSync('git', ['-C', repo.dir, 'archive', '--format=tar', commit], { maxBuffer: 1 << 26 }).stdout;
  const { comment, files } = untar(archive);
  assert.equal(comment, commit);
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  assert.deepEqual([...byPath.keys()].sort(), ['a.txt', 'dir/b.bin', long].sort());
  assert.equal(byPath.get(long).toString(), 'long\n');
  assert.deepEqual([...byPath.get('dir/b.bin')], [0, 1, 2, 255]);
});

test('runtime pins follow mirror-runtime.py: manifest/worker pairs, chunks only for a chunked asset, relative files', () => {
  const sha = (c) => c.repeat(64);
  const manifest = {
    photo: { manifestUrl: 'https://o/runtime/photo/p/manifest.json', manifestSha256: sha('a'), workerUrl: 'https://o/runtime/photo/p/w.mjs', workerSha256: sha('b') },
    synthesis: { url: 'https://o/runtime/assets/s/synthesis.onnx', sha256: sha('c'), size: 32, chunks: [{ url: 'https://o/runtime/chunks/1.bin', sha256: sha('d'), size: 16 }, { url: 'https://o/runtime/chunks/2.bin', sha256: sha('e'), size: 16 }] },
    kernel: { file: 'src/Next/browser/k.mjs', sha256: sha('f'), url: 'https://o/runtime/assets/k/k.mjs' },
    nested: [{ file: 'part.onnx', sha256: sha('9'), size: 4 }],
  };
  const pins = pinnedRuntime(manifest, 'encoder-stream/x');
  assert.deepEqual(Object.keys(pins).sort(), ['chunks/1.bin', 'chunks/2.bin', 'encoder-stream/x/part.onnx', 'photo/p/manifest.json', 'photo/p/w.mjs']);
  assert.deepEqual(pins['chunks/1.bin'], { sha256: sha('d'), bytes: 16, of: 'assets/s/synthesis.onnx', of_sha256: sha('c') });
  assert.equal(pins['photo/p/manifest.json'].bytes, null);
  assert.throws(() => pinnedRuntime({ a: { url: 'https://o/elsewhere/x', sha256: sha('1'), size: 1 } }), /outside \/runtime\//);
});
