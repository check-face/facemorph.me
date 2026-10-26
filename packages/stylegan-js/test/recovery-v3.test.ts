// Recovery schema 3 (fm-fzzd): dynamic-shape round trips for FFHQ (on the candidate's real saved still) and the
// non-face AFHQ cat 512 descriptor, earlier-schema fixtures, typed rejection of other versions and mismatches,
// the copied-hash rule, cross-checkpoint combination refusal and the blend recipe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AFHQ_CAT_512_DESCRIPTOR,
  FFHQ_1024_DESCRIPTOR,
  blendExportInputs,
  blendRecipeDigest,
  blendWithRecipe,
  checkCombinable,
  embedRecovery,
  embedRecoveryV3,
  encodeLosslessWebp,
  encodePng,
  latentDigest,
  readRecovery,
  recipeSlotsFor,
  type LatentTensor,
  type ModelDescriptor,
  type RecoveryMetadataV3,
  type StillRecoveryResult,
} from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const vector = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./vectors/${name}`, import.meta.url)));

function latentFor(d: ModelDescriptor, seed = 1): LatentTensor {
  const random = mulberry32(seed);
  const n = d.latent.layers * d.latent.width;
  const values = Float32Array.from(
    { length: n },
    () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random()),
  );
  return { space: 'w-plus', shape: [d.latent.layers, d.latent.width], values };
}

const meta = (d: ModelDescriptor, over: Partial<RecoveryMetadataV3> = {}): RecoveryMetadataV3 => ({
  descriptor: d,
  generationKind: 'seed',
  generationSha256: 'a'.repeat(64),
  provenance: {
    modelSha256: d.identity.modelSha256,
    noiseSha256: d.identity.noiseSha256,
    bundleVersion: 'test',
    route: 'cpu',
  },
  latent: latentFor(d),
  seed: 42,
  ...over,
});

const pixels = (size: number) => {
  const random = mulberry32(size);
  return {
    width: size,
    height: size,
    rgba: Uint8ClampedArray.from({ length: size * size * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : Math.floor(random() * 256),
    ),
  };
};

function parsed(r: StillRecoveryResult) {
  assert.equal(r.kind, 'parsed', JSON.stringify(r.kind === 'damaged' ? r : r.kind));
  if (r.kind !== 'parsed') throw new Error('unreachable');
  return r.recovered;
}

const bytesOf = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

/** The candidate's real saved FFHQ still (schema 2 PNG, 1024 x 1024) without its envelope. */
const ffhqBase = () => parsed(readRecovery(vector('stills/recovery-v2.png'))).baseImage;

test('schema 3 round trip: FFHQ on a real saved still, PNG and WebP, exact latent and model identity', () => {
  const m = meta(FFHQ_1024_DESCRIPTOR);
  for (const image of [
    ffhqBase(),
    parsed(readRecovery(vector('stills/recovery-v2.webp'))).baseImage,
  ]) {
    const saved = embedRecoveryV3(image, m);
    const r = parsed(readRecovery(saved));
    assert.equal(r.schemaVersion, 3);
    assert.deepEqual(r.latent.shape, [18, 512]);
    assert.ok(bytesOf(r.latent.values).equals(bytesOf(m.latent.values)), 'latent bytes exact');
    assert.deepEqual(r.model, {
      name: 'stylegan2-ffhq-config-f',
      architecture: 'stylegan2',
      subject: 'face',
      modelSha256: FFHQ_1024_DESCRIPTOR.identity.modelSha256,
      noiseSha256: FFHQ_1024_DESCRIPTOR.identity.noiseSha256,
      latent: { space: 'w-plus', layers: 18, width: 512 },
      output: { width: 1024, height: 1024 },
    });
    assert.equal(r.provenance.modelSha256, FFHQ_1024_DESCRIPTOR.identity.modelSha256);
    assert.equal(r.seed, 42);
    assert.ok(
      Buffer.from(r.baseImage).equals(Buffer.from(image)),
      'the image payload is untouched',
    );
  }
});

test('a photo face, whose provenance holds null mapping provider and truncation, saves a record that reads back', () => {
  // The runtime's photo provenance as product faces carry it (runtime.mjs cachedGenerate): fields that do not
  // apply are null. Both writers leave them out, so the still reopens instead of reading as damaged.
  const provenance = {
    ...meta(FFHQ_1024_DESCRIPTOR).provenance,
    provider: 'wasm',
    mappingProvider: null,
    truncationPsi: null,
    truncationCutoff: null,
  } as unknown as RecoveryMetadataV3['provenance'];
  const { seed: _seed, ...seedless } = meta(FFHQ_1024_DESCRIPTOR);
  const photo: RecoveryMetadataV3 = { ...seedless, generationKind: 'photo', provenance };
  const v3 = parsed(readRecovery(embedRecoveryV3(ffhqBase(), photo)));
  assert.equal(v3.generationKind, 'photo');
  assert.deepEqual(
    ['mappingProvider', 'truncationPsi', 'truncationCutoff'].filter((k) => k in v3.provenance),
    [],
  );
  assert.equal(v3.provenance.provider, 'wasm');
  const back = parsed(
    readRecovery(
      embedRecovery(ffhqBase(), {
        generationKind: 'photo',
        generationSha256: photo.generationSha256,
        provenance,
        latent: photo.latent,
      }),
    ),
  );
  assert.equal(back.generationKind, 'photo');
  assert.ok(!('mappingProvider' in back.provenance));
});

test('schema 3 round trip: non-face AFHQ cat 512 (16 x 512) through encodePng and encodeLosslessWebp', async () => {
  const d = AFHQ_CAT_512_DESCRIPTOR;
  const { seed: _drop, ...noSeed } = meta(d, { generationKind: 'latent' });
  const m = noSeed;
  for (const saved of [
    await encodePng(pixels(512), noSeed),
    encodeLosslessWebp(pixels(512), noSeed),
  ]) {
    const r = parsed(readRecovery(saved));
    assert.equal(r.schemaVersion, 3);
    assert.deepEqual(r.latent.shape, [16, 512]);
    assert.ok(bytesOf(r.latent.values).equals(bytesOf(m.latent.values)));
    assert.equal(r.model?.subject, 'non-face');
    assert.equal(r.model?.modelSha256, d.identity.modelSha256);
    assert.deepEqual(r.model?.output, { width: 512, height: 512 });
    assert.equal(r.seed, undefined);
  }
});

test('earlier schema fixtures still read: schema 1 PNG, schema 2 PNG and WebP', () => {
  const v1 = parsed(readRecovery(vector('stills/recovery-v1.png')));
  assert.equal(v1.schemaVersion, 1);
  assert.deepEqual(v1.latent.shape, [18, 512]);
  for (const name of ['stills/recovery-v2.png', 'stills/recovery-v2.webp']) {
    const v2 = parsed(readRecovery(vector(name)));
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.model, undefined);
    assert.ok(
      bytesOf(v2.latent.values).equals(bytesOf(v1.latent.values)),
      `${name}: same seed-42 latent`,
    );
  }
});

/** Rewrites one field of a still's record (keeping a valid CRC/container, so only the record is wrong). */
function rewrite(saved: Uint8Array, edit: (record: Record<string, unknown>) => void): Uint8Array {
  const r = parsed(readRecovery(saved));
  const at = Buffer.from(saved).indexOf('FaceMorph\0') + 10;
  const end = Buffer.from(saved).indexOf('IEND') - 8;
  const record = JSON.parse(Buffer.from(saved.subarray(at, end)).toString('utf8'));
  edit(record);
  const json = Buffer.from(JSON.stringify(record));
  const data = Buffer.concat([Buffer.from('FaceMorph\0'), json]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4);
  data.copy(chunk, 8);
  let n = 0xffffffff;
  for (const b of chunk.subarray(4, chunk.length - 4)) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  chunk.writeUInt32BE((n ^ 0xffffffff) >>> 0, chunk.length - 4);
  const base = Buffer.from(r.baseImage);
  return new Uint8Array(
    Buffer.concat([base.subarray(0, base.length - 12), chunk, base.subarray(base.length - 12)]),
  );
}

test('schema 1 seed written as the bridge held it (decimal text) reads as the number; other text is damage', () => {
  // The candidate's bridge passed the seed field's text to decorateImage (face.source.value), so a schema-1
  // still carries "seed":"42" as often as 42 (fm-fy2.7).
  const v1 = vector('stills/recovery-v1.png');
  const exact = parsed(readRecovery(v1));
  const text = parsed(readRecovery(rewrite(v1, (rec) => (rec.seed = '42'))));
  assert.equal(text.seed, 42);
  assert.ok(bytesOf(text.latent.values).equals(bytesOf(exact.latent.values)));
  for (const bad of ['042', '-1', '4294967296', '1e3', ' 42', 'x'])
    assert.equal(readRecovery(rewrite(v1, (rec) => (rec.seed = bad))).kind, 'damaged', bad);
});

test('unsupported versions are a typed incompatible-schema result carrying the claimed version', () => {
  const saved = embedRecoveryV3(ffhqBase(), meta(FFHQ_1024_DESCRIPTOR));
  for (const version of [4, 9, 0, '3', null]) {
    const r = readRecovery(rewrite(saved, (rec) => (rec.schema = version)));
    assert.deepEqual(r, { kind: 'incompatible-schema', schemaVersion: version });
  }
});

test('schema 3 mismatches are typed damage, never a parsed latent', () => {
  const saved = embedRecoveryV3(ffhqBase(), meta(FFHQ_1024_DESCRIPTOR));
  const cases: [string, (r: Record<string, unknown>) => void, string][] = [
    [
      'shape differs from the model record',
      (r) => ((r.latent as { shape: number[] }).shape = [16, 512]),
      'invalid-fields',
    ],
    [
      'model layers differ from the latent',
      (r) => ((r.model as { latent: { layers: number } }).latent.layers = 16),
      'invalid-fields',
    ],
    [
      'provenance names another checkpoint',
      (r) => ((r.provenance as { modelSha256: string }).modelSha256 = '9'.repeat(64)),
      'invalid-fields',
    ],
    [
      'image is not the model frame',
      (r) => ((r.model as { output: { width: number } }).output.width = 512),
      'dimensions',
    ],
    ['unknown field', (r) => (r.sourceName = 'holiday.jpg'), 'invalid-fields'],
    ['seed on a photo', (r) => (r.generationKind = 'photo'), 'invalid-fields'],
    [
      'blend without a recipe',
      (r) => ((r.generationKind = 'blend'), delete r.seed),
      'invalid-fields',
    ],
    ['copied obsolete image hash', (r) => (r.imageSha256 = 'f'.repeat(64)), 'integrity'],
  ];
  for (const [what, edit, reason] of cases) {
    const r = readRecovery(rewrite(saved, edit));
    assert.equal(r.kind, 'damaged', what);
    assert.equal(r.kind === 'damaged' && r.reason, reason, what);
  }
});

test('a recovery chunk copied onto other pixels fails its integrity check; re-embedding regenerates it', () => {
  const saved = embedRecoveryV3(ffhqBase(), meta(FFHQ_1024_DESCRIPTOR));
  const other = pixels(1024);
  const at = Buffer.from(saved).indexOf('FaceMorph\0') - 8;
  const chunk = Buffer.from(saved.subarray(at, saved.length - 12));
  return encodePng(other, meta(FFHQ_1024_DESCRIPTOR)).then((fresh) => {
    const freshBase = parsed(readRecovery(fresh)).baseImage;
    const copied = new Uint8Array(
      Buffer.concat([
        Buffer.from(freshBase.subarray(0, freshBase.length - 12)),
        chunk,
        Buffer.from(freshBase.subarray(freshBase.length - 12)),
      ]),
    );
    const r = readRecovery(copied);
    assert.equal(r.kind, 'damaged');
    assert.equal(r.kind === 'damaged' && r.reason, 'integrity');
    // The writer replaces an existing envelope and hashes the payload it actually carries.
    const again = parsed(readRecovery(embedRecoveryV3(fresh, meta(FFHQ_1024_DESCRIPTOR))));
    assert.equal(again.imageSha256, parsed(readRecovery(fresh)).imageSha256);
  });
});

test('the schema 3 writer refuses a latent, frame or provenance that is not the descriptor’s', () => {
  const base = ffhqBase();
  assert.throws(
    () =>
      embedRecoveryV3(
        base,
        meta(FFHQ_1024_DESCRIPTOR, { latent: latentFor(AFHQ_CAT_512_DESCRIPTOR) }),
      ),
    /18 x 512/,
  );
  assert.throws(() => embedRecoveryV3(base, meta(AFHQ_CAT_512_DESCRIPTOR)), /full model frame/);
  assert.throws(
    () =>
      embedRecoveryV3(base, {
        ...meta(FFHQ_1024_DESCRIPTOR),
        provenance: {
          modelSha256: '9'.repeat(64),
          noiseSha256: FFHQ_1024_DESCRIPTOR.identity.noiseSha256,
        },
      }),
    /provenance/,
  );
  assert.throws(
    () => embedRecoveryV3(base, meta(FFHQ_1024_DESCRIPTOR, { generationKind: 'photo' })),
    /seed/,
  );
});

test('mixed-identity morph inputs are refused, equal shapes included', () => {
  const d = FFHQ_1024_DESCRIPTOR;
  const own = { modelSha256: d.identity.modelSha256, noiseSha256: d.identity.noiseSha256 };
  const a = { ...own, latent: latentFor(d, 1) };
  const b = { ...own, latent: latentFor(d, 2) };
  assert.deepEqual(checkCombinable(d, [a, b]), { ok: true, value: true });
  const otherCheckpoint = {
    modelSha256: '9'.repeat(64),
    noiseSha256: own.noiseSha256,
    latent: latentFor(d, 3),
  };
  const r = checkCombinable(d, [a, otherCheckpoint, b]);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.code, 'mixed-model');
  assert.equal(!r.ok && r.error.index, 1);
  const cat = { ...own, latent: latentFor(AFHQ_CAT_512_DESCRIPTOR) };
  const s = checkCombinable(d, [a, cat]);
  assert.equal(!s.ok && s.error.code, 'shape-mismatch');
  const t = checkCombinable(d, [a]);
  assert.equal(!t.ok && t.error.code, 'too-few');
  // Recovered stills feed it directly: a v3 AFHQ still is refused by the FFHQ morph.
  const afhq = parsed(
    readRecovery(encodeLosslessWebp(pixels(512), { ...meta(AFHQ_CAT_512_DESCRIPTOR), seed: 1 })),
  );
  const u = checkCombinable(d, [a, { ...afhq.provenance, latent: afhq.latent }]);
  assert.equal(!u.ok && u.error.code, 'mixed-model');
});

// ------------------------------------------------------------------------------------------------------------
// Blend recipe

const TYPED = ['emma', 'noah', '2718281828', 'holiday-photo', '.jpg'];

function blendOf(weights: number[]) {
  const d = FFHQ_1024_DESCRIPTOR;
  const r = blendWithRecipe(
    d,
    [
      { kind: 'word', latent: latentFor(d, 11) },
      { kind: 'seed', latent: latentFor(d, 12) },
      { kind: 'name', latent: latentFor(d, 13) },
      { kind: 'photo', latent: latentFor(d, 14) },
    ],
    weights,
  );
  assert.ok(r.ok);
  if (!r.ok) throw new Error('unreachable');
  return r.value;
}

const blendMeta = (b: ReturnType<typeof blendOf>): RecoveryMetadataV3 => {
  const { seed: _s, ...m } = meta(FFHQ_1024_DESCRIPTOR);
  return {
    ...m,
    generationKind: 'blend',
    generationSha256: b.generationSha256,
    latent: b.result.latent,
    blend: b.recipe,
  };
};

test('blend recipe round trip: WebP and PNG decode the exact blended latent and the recipe', async () => {
  const b = blendOf([0.25, 0.25, 0.3, 0.2]);
  assert.equal(b.generationSha256, b.result.cacheKey, 'the recipe digest is blend()’s cache key');
  const webpBase = parsed(readRecovery(vector('stills/recovery-v2.webp'))).baseImage;
  for (const saved of [
    embedRecoveryV3(webpBase, blendMeta(b)),
    embedRecoveryV3(ffhqBase(), blendMeta(b)),
    await encodePng(pixels(1024), blendMeta(b)),
  ]) {
    const r = parsed(readRecovery(saved));
    assert.equal(r.generationKind, 'blend');
    assert.ok(
      bytesOf(r.latent.values).equals(bytesOf(b.result.latent.values)),
      'exact blended latent',
    );
    assert.deepEqual(r.blend, b.recipe);
    assert.deepEqual(
      r.blend?.slots.map((s) => s.kind),
      ['word', 'seed', 'name', 'photo'],
    );
    assert.deepEqual(
      r.blend?.slots.map((s) => s.latentSha256),
      [11, 12, 13, 14].map((k) => latentDigest(latentFor(FFHQ_1024_DESCRIPTOR, k))),
    );
    assert.deepEqual(
      r.blend?.slots.map((s) => s.weight),
      [0.25, 0.25, 0.3, 0.2],
    );
    assert.equal(r.seed, undefined);
    const text = Buffer.from(saved).toString('latin1');
    for (const word of TYPED)
      assert.ok(!text.includes(word), `no typed input "${word}" in the file`);
    assert.ok(!text.includes('"seed":'), 'a blend carries no seed field');
    // The blend view restores the weight of a slot whose latent matches.
    assert.deepEqual(recipeSlotsFor(r.blend!, latentFor(FFHQ_1024_DESCRIPTOR, 13)), [2]);
  }
});

test('two blends differing only in one weight get different identities and export inputs', () => {
  const a = blendOf([0.25, 0.25, 0.25, 0.25]);
  const b = blendOf([0.25, 0.25, 0.25, 0.3]);
  assert.notEqual(a.generationSha256, b.generationSha256);
  assert.notDeepEqual(
    blendExportInputs(a.recipe).orderedInputs,
    blendExportInputs(b.recipe).orderedInputs,
  );
  assert.equal(blendExportInputs(a.recipe).label, 'blend-4-faces');
  assert.equal(
    blendRecipeDigest(FFHQ_1024_DESCRIPTOR.identity.modelSha256, a.recipe),
    a.generationSha256,
  );
});

test('a blend whose recipe was edited after saving fails its generation identity', () => {
  const b = blendOf([0.25, 0.25, 0.25, 0.25]);
  const saved = embedRecoveryV3(ffhqBase(), blendMeta(b));
  const r = readRecovery(
    rewrite(
      saved,
      (rec) => ((rec.blend as { slots: { weight: number }[] }).slots[0]!.weight = 0.5),
    ),
  );
  assert.equal(r.kind === 'damaged' && r.reason, 'integrity');
  assert.throws(
    () => embedRecoveryV3(ffhqBase(), { ...blendMeta(b), generationSha256: 'a'.repeat(64) }),
    /recipe digest/,
  );
});

test('schema 2 writer is unchanged (compatibility)', () => {
  const r = parsed(
    readRecovery(
      embedRecovery(ffhqBase(), {
        generationKind: 'seed',
        generationSha256: 'a'.repeat(64),
        provenance: { modelSha256: '2'.repeat(64), noiseSha256: '3'.repeat(64) },
        latent: latentFor(FFHQ_1024_DESCRIPTOR),
      }),
    ),
  );
  assert.equal(r.schemaVersion, 2);
});
