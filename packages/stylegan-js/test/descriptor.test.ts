// Model descriptor contracts (fm-6e4m): fixtures, per-union type tests, the developer journey as typed cases,
// dynamic-shape recovery through the real writers and readers, mixed-model morph rejection, and fuzzing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/index.ts';
import {
  AFHQ_CAT_512_DESCRIPTOR,
  FFHQ_1024_DESCRIPTOR,
  encodePng,
  latentFitsDescriptor,
  parseModelDescriptor,
  parseRecoveryMetadata,
  readRecovery,
  sameModelEndpoints,
  type CompatibilityRow,
  type DescriptorQualification,
  type DeveloperJourney,
  type DeveloperJourneyStep,
  type IdentifiedLatent,
  type ModelDescriptor,
} from '../src/index.ts';
import { mulberry32 } from './fuzz.ts';

const VALUES = [
  'FFHQ_1024_DESCRIPTOR',
  'AFHQ_CAT_512_DESCRIPTOR',
  'parseModelDescriptor',
  'latentFitsDescriptor',
  'sameModelEndpoints',
] as const satisfies readonly (keyof typeof api)[];
export type DescriptorTypes = [
  api.ModelDescriptor,
  api.DescriptorQualification,
  api.CompatibilityRow,
  api.NoisePlane,
  api.PhotoEncoderDescriptor,
  api.ComputeProvider,
  api.DescriptorError,
  api.DescriptorErrorCode,
  api.IdentifiedLatent,
  api.MorphEndpointError,
  api.DeveloperJourneyStep,
  api.DeveloperJourney,
  api.Result<1, 2>,
];

test('every descriptor value is exported from the entry point', () => {
  for (const name of VALUES) assert.ok(name in api, name);
});

test('both fixtures validate and state every field; the 512 px model has its own layer count', () => {
  for (const d of [FFHQ_1024_DESCRIPTOR, AFHQ_CAT_512_DESCRIPTOR])
    assert.equal(parseModelDescriptor(d).ok, true, d.identity.name);
  assert.deepEqual(
    [
      FFHQ_1024_DESCRIPTOR.latent.layers,
      FFHQ_1024_DESCRIPTOR.noise.planes.length,
      FFHQ_1024_DESCRIPTOR.output.shape[2],
    ],
    [18, 17, 1024],
  );
  assert.deepEqual(
    [
      AFHQ_CAT_512_DESCRIPTOR.latent.layers,
      AFHQ_CAT_512_DESCRIPTOR.noise.planes.length,
      AFHQ_CAT_512_DESCRIPTOR.output.shape[2],
    ],
    [16, 15, 512],
  );
  // The FFHQ fixture is the candidate runtime manifest's model (pinned d9e37e50...), not a guess.
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        '../../browser-model-manager/test/fixtures/candidate-runtime-manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(
    [
      fixture.modelSourceSha256,
      fixture.noiseSha256,
      fixture.synthesis.size,
      fixture.encoderStream.sourceEncoderSha256,
      fixture.landmarks.sha256,
    ],
    [
      FFHQ_1024_DESCRIPTOR.identity.modelSha256,
      FFHQ_1024_DESCRIPTOR.identity.noiseSha256,
      FFHQ_1024_DESCRIPTOR.resources.synthesisBytes,
      FFHQ_1024_DESCRIPTOR.photoEncoder?.sourceSha256,
      FFHQ_1024_DESCRIPTOR.photoEncoder?.detector.sha256,
    ],
  );
  assert.deepEqual(
    fixture.noise.map((n: { shape: number[] }) => n.shape),
    FFHQ_1024_DESCRIPTOR.noise.planes.map((p) => [...p.shape]),
  );
  // Non-face support stays unqualified with its blocker.
  assert.ok(
    AFHQ_CAT_512_DESCRIPTOR.providers.every(
      (p) => p.qualification.status === 'unqualified' && p.qualification.blocker.length > 0,
    ),
  );
});

// ---- Per-union type tests.
const never = (x: never): never => {
  throw new Error(String(x));
};
export function qualificationText(q: DescriptorQualification): string {
  switch (q.status) {
    case 'qualified':
      return q.evidence;
    case 'unqualified':
      return q.blocker;
    default:
      return never(q);
  }
}
export function encoderOf(d: ModelDescriptor): string {
  switch (d.subject) {
    case 'face':
      return d.photoEncoder?.sourceSha256 ?? 'none';
    case 'non-face':
      return 'never';
    default:
      return never(d);
  }
}
export function stepName(s: DeveloperJourneyStep): string {
  switch (s.kind) {
    case 'choose-checkpoint':
      return s.row.checkpoint.name;
    case 'convert':
      return s.container;
    case 'host':
      return s.manifestUrl;
    case 'install-and-load':
      return s.load;
    case 'export-reopen-morph':
      return s.formats.join();
    default:
      return never(s);
  }
}
const nonFaceWithEncoder = {
  ...AFHQ_CAT_512_DESCRIPTOR,
  photoEncoder: FFHQ_1024_DESCRIPTOR.photoEncoder,
};
// @ts-expect-error a non-face model never carries a photo encoder or face detector
export const noEncoderForCats: ModelDescriptor = nonFaceWithEncoder;
// @ts-expect-error qualified needs its evidence
export const noEvidence: DescriptorQualification = { status: 'qualified' };
// @ts-expect-error the output is NCHW with batch one
export const badShape: ModelDescriptor['output']['shape'] = [2, 3, 512, 512];

const row = (
  d: ModelDescriptor,
  serialization: CompatibilityRow['serialization'],
  conversion: DescriptorQualification,
): CompatibilityRow => ({
  checkpoint: {
    name: d.identity.name,
    sha256: d.identity.modelSha256,
    url: 'https://nvlabs-fi-cdn.nvidia.com/',
  },
  serialization,
  architecture: serialization === 'tf1-pickle' ? 'stylegan2' : 'stylegan2-ada',
  conditional: false,
  resolution: d.output.shape[2],
  channels: d.output.shape[1],
  zDim: d.latent.zLength,
  wDim: d.latent.width,
  wPlusLayers: d.latent.layers,
  precision: 'fp32',
  opset: 17,
  qualifiedProviders: [],
  unsupported: [{ cell: 'fp16', reason: 'not produced' }],
  conversion,
  terms: 'NVIDIA Source Code License-NC',
});

/** The five-step journey as typed cases; a step out of order fails compilation. */
function journey(d: ModelDescriptor, r: CompatibilityRow): DeveloperJourney {
  return [
    { step: 1, kind: 'choose-checkpoint', row: r },
    {
      step: 2,
      kind: 'convert',
      container: 'facemorph/model-conv',
      command: ['convert', '--model', d.identity.name],
      verifyReport: 'verify.json',
    },
    {
      step: 3,
      kind: 'host',
      hosting: 'https-static',
      manifestUrl: 'https://models.example.org/manifest.json',
    },
    {
      step: 4,
      kind: 'install-and-load',
      packages: ['@facemorph/stylegan-js', '@facemorph/browser-model-manager'],
      load: 'manager-grant',
      descriptor: d,
    },
    {
      step: 5,
      kind: 'export-reopen-morph',
      formats: ['png', 'webp-lossless'],
      reopen: 'exact-metadata',
      morphInputs: 3,
    },
  ];
}
const qualified: DescriptorQualification = { status: 'qualified', evidence: 'model-conv CI' };
const j = journey(FFHQ_1024_DESCRIPTOR, row(FFHQ_1024_DESCRIPTOR, 'tf1-pickle', qualified));
// @ts-expect-error the journey's steps come in order
export const swapped: DeveloperJourney = [j[1], j[0], j[2], j[3], j[4]];

test('the developer journey for FFHQ and for the non-face model', () => {
  const face = journey(
    FFHQ_1024_DESCRIPTOR,
    row(FFHQ_1024_DESCRIPTOR, 'tf1-pickle', { status: 'qualified', evidence: 'model-conv CI' }),
  );
  const cat = journey(
    AFHQ_CAT_512_DESCRIPTOR,
    row(AFHQ_CAT_512_DESCRIPTOR, 'pytorch-pickle', {
      status: 'qualified',
      evidence: 'model-conv CI',
    }),
  );
  assert.deepEqual(
    face.map((s) => s.step),
    [1, 2, 3, 4, 5],
  );
  const loaded = cat[3].descriptor;
  assert.equal(loaded.subject, 'non-face');
  assert.equal(loaded.photoEncoder, undefined); // non-face generation never loads a face detector or FFHQ e4e
  assert.equal(stepName(cat[0]), 'stylegan2-ada-afhqcat');
});

const latent = (layers: number, width: number, seed: number) => {
  const random = mulberry32(seed);
  return {
    space: 'w-plus' as const,
    shape: [layers, width] as const,
    values: Float32Array.from({ length: layers * width }, () => random() * 2 - 1),
  };
};

test('recovery schema: candidate fixtures parse unchanged; a 512 px, 16-layer still round-trips', async () => {
  for (const name of ['stills/recovery-v2.png', 'stills/recovery-v2.webp']) {
    const r = parseRecoveryMetadata(
      new Uint8Array(readFileSync(new URL(`./vectors/${name}`, import.meta.url))),
    );
    assert.equal(r.kind, 'parsed', name);
  }
  // Schema 1 is the media reader's (readRecovery, built on the contract reader).
  assert.equal(
    readRecovery(
      new Uint8Array(readFileSync(new URL('./vectors/stills/recovery-v1.png', import.meta.url))),
    ).kind,
    'parsed',
  );
  const cat = latent(16, 512, 5);
  const png = await encodePng(
    { width: 512, height: 512, rgba: new Uint8Array(512 * 512 * 4).fill(200) },
    {
      generationKind: 'seed',
      generationSha256: 'b'.repeat(64),
      provenance: {
        modelSha256: AFHQ_CAT_512_DESCRIPTOR.identity.modelSha256,
        noiseSha256: AFHQ_CAT_512_DESCRIPTOR.identity.noiseSha256,
      },
      latent: cat,
    },
  );
  const r = readRecovery(png);
  assert.equal(r.kind, 'parsed');
  if (r.kind === 'parsed') {
    assert.deepEqual([r.recovered.width, r.recovered.latent.shape[0]], [512, 16]);
    assert.deepEqual(r.recovered.latent.values, cat.values);
    assert.equal(latentFitsDescriptor(r.recovered.latent, AFHQ_CAT_512_DESCRIPTOR), true);
    assert.equal(latentFitsDescriptor(r.recovered.latent, FFHQ_1024_DESCRIPTOR), false);
  }
});

test('a morph mixing equal-shaped latents from two model identities is rejected', () => {
  const ffhq = FFHQ_1024_DESCRIPTOR as ModelDescriptor & {
    identity: { modelSha256: 'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d' };
  };
  const mine = (
    seed: number,
  ): IdentifiedLatent<'adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d'> => ({
    ...latent(18, 512, seed),
    modelSha256: ffhq.identity.modelSha256,
    noiseSha256: ffhq.identity.noiseSha256,
  });
  const otherModel: IdentifiedLatent<'9999999999999999999999999999999999999999999999999999999999999999'> =
    {
      ...latent(18, 512, 3),
      modelSha256: '9'.repeat(
        64,
      ) as '9999999999999999999999999999999999999999999999999999999999999999',
      noiseSha256: ffhq.identity.noiseSha256,
    };
  assert.equal(sameModelEndpoints(ffhq, [mine(1), mine(2)]).ok, true);
  const mixed = sameModelEndpoints(ffhq, [
    mine(1),
    otherModel as unknown as IdentifiedLatent<typeof ffhq.identity.modelSha256>,
  ]);
  assert.deepEqual(mixed.ok ? null : [mixed.error.code, mixed.error.index], [
    'mixed-model-identity',
    1,
  ]);
  const short = sameModelEndpoints(ffhq, [mine(1)]);
  assert.equal(short.ok ? null : short.error.code, 'too-few-endpoints');
  const wrongShape = sameModelEndpoints(ffhq, [
    mine(1),
    {
      ...latent(16, 512, 4),
      modelSha256: ffhq.identity.modelSha256,
      noiseSha256: ffhq.identity.noiseSha256,
    },
  ]);
  assert.equal(wrongShape.ok ? null : wrongShape.error.code, 'shape-mismatch');
  void otherModel;
});
type OnlyA = ModelDescriptor & { identity: { modelSha256: 'a' } };
type FromA = IdentifiedLatent<'a'>;
type FromB = IdentifiedLatent<'b'>;
// @ts-expect-error equal-shaped latents from another model are not this model's morph endpoints
export const mixedTypes = (d: OnlyA, x: FromA, y: FromB) => sameModelEndpoints(d, [x, y]);

function mutate(value: unknown, random: () => number, odd: unknown[], depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 5 || random() < 0.12)
    return odd[Math.floor(random() * odd.length)];
  const copy: Record<string, unknown> = Array.isArray(value)
    ? ([...value] as unknown as Record<string, unknown>)
    : { ...(value as Record<string, unknown>) };
  const keys = Object.keys(copy);
  if (keys.length === 0) return odd[Math.floor(random() * odd.length)];
  const key = keys[Math.floor(random() * keys.length)]!;
  if (random() < 0.1) delete copy[key];
  else copy[key] = mutate(copy[key], random, odd, depth + 1);
  return copy;
}

test('descriptor fuzz (seed 6464, 3000 cases): every mutation is accepted or a typed rejection', () => {
  const random = mulberry32(6464);
  const odd: unknown[] = [
    null,
    -1,
    0,
    0.5,
    2,
    15,
    16,
    17,
    18,
    512,
    1024,
    '',
    'face',
    'non-face',
    [],
    {},
    true,
    2 ** 53,
    'a'.repeat(64),
  ];
  const counts: Record<string, number> = {};
  const cases = 3000;
  for (let i = 0; i < cases; i++) {
    const r = parseModelDescriptor(
      mutate(i % 2 ? AFHQ_CAT_512_DESCRIPTOR : FFHQ_1024_DESCRIPTOR, random, odd),
    );
    const k = r.ok ? 'accepted' : r.error.code;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b),
    cases,
  );
  assert.ok(
    (counts['invalid-field'] ?? 0) + (counts.inconsistent ?? 0) > cases / 3,
    'the fuzz reaches the field checks',
  );
  console.log(`descriptor fuzz: ${cases} cases`, counts);
});
