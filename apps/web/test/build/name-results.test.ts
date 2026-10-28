// The picked-name result index (fm-ejwq): every selectable name has a published result in the shards the app ships,
// the shards name the release's own engine (runtime manifest and model) and generation identity, and the typed path
// never reads the catalogue, so a typed name and a picked name resolve to one face.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runtimeIdentity } from '../../build/runtime-identity.ts';
// The engine's own identity function (a plain .mjs module without declarations).
const { generationIdentity } = (await import(
  String(new URL('../../src/Next/browser/identity.mjs', import.meta.url))
)) as { generationIdentity: (manifest: unknown, kind: string) => unknown };

const app = new URL('../../', import.meta.url).pathname;
const repo = join(app, '../..');
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
type Shard = {
  schema: string;
  origin: string;
  resultSet: string;
  manifestSha256: string;
  identity: { manifestSha256: string; modelSha256: string; generationSha256: string };
  results: Record<string, [string, number]>;
};
const shards = [...'0123456789abcdef'].map(
  (h) =>
    [
      h,
      JSON.parse(readFileSync(join(app, `src/public/names-results/${h}.json`), 'utf8')) as Shard,
    ] as const,
);

test('every selectable name has exactly one published result in its own shard', () => {
  const catalogue = JSON.parse(
    readFileSync(join(repo, 'hosting/next-static/catalogue.json'), 'utf8'),
  ) as {
    names: { value: string; id: string }[];
  };
  for (const { value, id } of catalogue.names) {
    assert.equal(sha256(value), id, value);
    const entry = shards.find(([h]) => h === id[0])![1].results[id];
    assert.ok(
      entry && /^[a-f0-9]{64}$/.test(entry[0]) && entry[1] > 0 && entry[1] <= 4 << 20,
      value,
    );
  }
  const listed = shards.reduce((n, [, s]) => n + Object.keys(s.results).length, 0);
  assert.equal(listed, catalogue.names.length, 'no result for a name the picker does not list');
  for (const [h, s] of shards) for (const id of Object.keys(s.results)) assert.equal(id[0], h);
});

test('the shards name one result set made by this release engine and generation identity', () => {
  const heads = new Set(shards.map(([, s]) => JSON.stringify({ ...s, results: undefined })));
  assert.equal(heads.size, 1, 'one publication across all shards');
  const s = shards[0]![1];
  assert.equal(s.schema, 'facemorph.name-results/1');
  assert.equal(s.origin, 'https://facemorph-name-catalogue.cdilga.workers.dev');
  const release = runtimeIdentity(repo);
  assert.equal(s.identity.manifestSha256, release.runtimeSha256, 'the release runtime manifest');
  assert.equal(s.identity.modelSha256, release.modelSha256, 'the release model');
  const manifest = JSON.parse(
    readFileSync(
      join(repo, `import/runtime-manifests/control/${release.runtimeSha256}/manifest.json`),
      'utf8',
    ),
  );
  assert.equal(
    s.identity.generationSha256,
    sha256(JSON.stringify(generationIdentity(manifest, 'seed'))),
    'the generation identity typed input uses',
  );
});

test('the typed path never reads the catalogue: one canonical resolver', () => {
  const bridge = readFileSync(join(app, 'src/Next/product-bridge.mjs'), 'utf8');
  assert.doesNotMatch(bridge, /publicNameLatent|namedLatent/);
  const generate = bridge.match(/async function generateNameOrSeed\([^)]*\)\{[^\n]*\}/)?.[0] ?? '';
  assert.match(generate, /service\.generate\(\{mode:item\.mode,value:item\.value/);
  assert.doesNotMatch(generate, /catalogue|synthesize/);
});
