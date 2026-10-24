// The artifact digest and the per-run origin binding (fm-48bj), as plain values.
import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactDigest, bindOrigins, classOf, type HostMap } from '../verify/artifact.ts';

const f = (path: string, sha256: string) => ({ path, sha256, bytes: 1 });

test('the artifact digest covers every deploy-next/ file, in any order, and nothing beside it', () => {
  const a = [f('deploy-next/index.html', 'a'.repeat(64)), f('deploy-next/app.js', 'b'.repeat(64))];
  const d = artifactDigest(a);
  assert.match(d, /^[0-9a-f]{64}$/);
  assert.equal(artifactDigest([...a].reverse()), d);
  assert.equal(artifactDigest([...a, f('next-site-source.txt', 'c'.repeat(64))]), d);
  assert.notEqual(artifactDigest([a[0]!, f('deploy-next/app.js', 'd'.repeat(64))]), d);
  assert.notEqual(artifactDigest(a.slice(1)), d);
});

test("the run's served origin is app, a bound model host is model-host, an unlisted origin is third-party", () => {
  const defaults: HostMap = { 'https://models.facemorph.me': 'model-host' };
  const map = bindOrigins(defaults, {
    app: ['http://127.0.0.1:41234/'],
    'model-host': ['http://127.0.0.1:41235'],
  });
  assert.equal(classOf(map, 'http://127.0.0.1:41234/index.html'), 'app');
  assert.equal(classOf(map, 'http://127.0.0.1:41235/runtime/x.onnx'), 'model-host');
  assert.equal(classOf(map, 'https://models.facemorph.me/m/1'), 'model-host');
  assert.equal(classOf(map, 'https://cdn.example.com/x.js'), 'third-party');
  assert.equal(
    classOf(map, 'http://127.0.0.1:9/'),
    'third-party',
    'another port is another origin',
  );
  assert.equal(classOf(map, 'data:image/png;base64,AAAA'), 'local');
  assert.equal(classOf(map, 'blob:http://127.0.0.1:41234/4b1c'), 'local');
  assert.deepEqual(
    defaults,
    { 'https://models.facemorph.me': 'model-host' },
    'the default map is not changed',
  );
});
