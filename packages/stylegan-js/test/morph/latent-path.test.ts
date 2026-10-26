// Morph latent geometry in the package (fm-suaa) against the app's latent-path-v1 (apps/web/src/Next/geometry),
// imported directly: byte-identical frames for 2-64 controls, no upper control cap, descriptor-driven shapes with
// per-layer rotation, typed shape rejections, and the app's infill order.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AFHQ_CAT_512_DESCRIPTOR,
  FFHQ_1024_DESCRIPTOR,
  type ModelDescriptor,
} from '../../src/contracts/descriptor.ts';
import { infillFrames, infillIndices } from '../../src/morph/infill.ts';
import {
  createLatentPath,
  GEOMETRY_VERSION,
  LIMITS,
  LatentShapeUnsupported,
  type LatentSpace,
  type LatentValues,
  type MorphKind,
  type MorphPathSpec,
} from '../../src/morph/latent-path.ts';

// The app modules are plain JS without declarations; a computed specifier keeps tsc from resolving them.
const APP = new URL('../../../../apps/web/src/Next/', import.meta.url);
interface AppPath {
  readonly segments: number;
  readonly totalFrames: number;
  readonly repairedTangents: number;
  sample(segment: number, u: number): Float64Array;
  frames(): Iterable<{
    index: number;
    segment: number;
    u: number;
    visitId: string | null;
    values: Float64Array;
  }>;
}
const appGeometry = (await import(new URL('geometry/latent-path.mjs', APP).href)) as {
  GEOMETRY_VERSION: string;
  createLatentPath(m: MorphPathSpec): AppPath;
};
// The app's infill.mjs re-exports this package's order since fm-ioap; the candidate's own module is the frozen control.
const CONTROL = new URL('../vectors/candidate-control/', import.meta.url);
const appInfill = (await import(new URL('infill.mjs', CONTROL).href)) as {
  infillIndices(total: number, perSegment: number): Iterable<number>;
  infillFrames(
    path: AppPath,
    morph: MorphPathSpec,
  ): Iterable<{
    index: number;
    segment: number;
    u: number;
    visitId: string | null;
    values: Float64Array;
  }>;
};

const KINDS: readonly MorphKind[] = [
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
];

/** Deterministic dense latents, distinct in every coordinate, layer and control. */
function latent(control: number, size: number, as: 'array' | 'f32' | 'f64'): LatentValues {
  const values = Array.from(
    { length: size },
    (_, d) =>
      Math.sin((control + 1) * (d + 1) * 0.017) +
      Math.cos((control + 3) * (d + 1) * 0.011) +
      control * 0.01,
  );
  return as === 'f32'
    ? Float32Array.from(values)
    : as === 'f64'
      ? Float64Array.from(values)
      : values;
}

interface Options {
  readonly controls: number;
  readonly space?: LatentSpace;
  readonly descriptor?: ModelDescriptor;
  readonly width?: number;
  readonly pinchCenter?: boolean;
  readonly closed?: boolean;
  readonly framesPerSegment?: number;
  readonly as?: 'array' | 'f32' | 'f64';
}
function spec(kind: MorphKind, o: Options): MorphPathSpec {
  const { latent: l } = o.descriptor ?? FFHQ_1024_DESCRIPTOR;
  const space = o.space ?? 'w-plus';
  const shape = space === 'w-plus' ? [l.layers, l.width] : [space === 'z' ? l.zLength : l.width];
  const size = shape.reduce((a, b) => a * b, 1);
  return {
    algorithmVersion: GEOMETRY_VERSION,
    kind,
    closed: o.closed ?? true,
    pinchCenter: o.pinchCenter ?? false,
    width: o.width ?? 0.2,
    framesPerSegment: o.framesPerSegment ?? 4,
    framesPerSecond: 24,
    controls: Array.from({ length: o.controls }, (_, i) => ({
      visitId: `visit-${i}`,
      latent: { space, shape, values: latent(i, size, o.as ?? 'array') },
    })),
  };
}

const bytes = (v: Float64Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

function assertFinitePath(m: MorphPathSpec, descriptor?: ModelDescriptor): void {
  const path = createLatentPath(m, descriptor);
  const size = m.controls[0]!.latent.values.length;
  let count = 0;
  for (const frame of path.frames()) {
    assert.equal(frame.values.length, size);
    assert(frame.values.every(Number.isFinite), `${m.kind} frame ${frame.index} is not finite`);
    count++;
  }
  assert.equal(count, path.totalFrames);
  assert.equal(path.segments, m.closed ? m.controls.length : m.controls.length - 1);
}

test('latent-path.byte-identical: 2-64 controls equal the app latent-path-v1 bytes in all five modes', () => {
  assert.equal(GEOMETRY_VERSION, 'latent-path-v1');
  assert.equal(appGeometry.GEOMETRY_VERSION, GEOMETRY_VERSION);
  const cases: Options[] = [];
  for (const controls of [2, 3, 5])
    for (const width of [0, 0.2, 1.2])
      for (const pinchCenter of [false, true])
        for (const closed of [true, false])
          cases.push({
            controls,
            width,
            pinchCenter,
            closed,
            framesPerSegment: controls === 5 ? 6 : 2,
            as: 'f32',
          });
  // Odd custom counts (fm-36ag) agree with the app module too.
  for (const framesPerSegment of [2, 3, 7, 8, 16])
    cases.push({
      controls: 3,
      space: 'w',
      framesPerSegment,
      pinchCenter: framesPerSegment === 8,
      as: 'f64',
    });
  cases.push({ controls: 2, space: 'z', framesPerSegment: 10, width: 1.2 });
  for (const pinchCenter of [false, true]) {
    cases.push({
      controls: 64,
      space: 'w',
      framesPerSegment: 6,
      pinchCenter,
      width: 0.7,
      as: 'f64',
    });
    cases.push({ controls: 64, framesPerSegment: 2, pinchCenter, closed: !pinchCenter, as: 'f32' });
  }
  let frames = 0,
    paths = 0;
  for (const kind of KINDS)
    for (const o of cases) {
      if (kind.startsWith('full-smooth') && o.closed === false) continue;
      const m = spec(kind, o);
      const ours = createLatentPath(m),
        theirs = appGeometry.createLatentPath(m);
      assert.equal(ours.totalFrames, theirs.totalFrames);
      assert.equal(ours.repairedTangents, theirs.repairedTangents);
      const expected = [...theirs.frames()];
      let i = 0;
      for (const frame of ours.frames()) {
        const other = expected[i++]!;
        assert.deepEqual(
          {
            index: frame.index,
            segment: frame.segment,
            u: frame.u,
            visitId: frame.visitId,
            t: frame.timeSeconds,
          },
          {
            index: other.index,
            segment: other.segment,
            u: other.u,
            visitId: other.visitId,
            t: (other as { timeSeconds?: number }).timeSeconds,
          },
        );
        assert(
          bytes(frame.values).equals(bytes(other.values)),
          `${kind} ${JSON.stringify(o)} frame ${frame.index} differs`,
        );
        frames++;
      }
      assert.equal(i, expected.length);
      // Off-grid samples too, including the figure-eight blend window around u = 0.5.
      for (const u of [0.13, 0.37, 0.49, 0.5, 0.51, 0.74])
        assert(
          bytes(ours.sample(0, u)).equals(bytes(theirs.sample(0, u))),
          `${kind} sample(0, ${u}) differs`,
        );
      paths++;
    }
  assert(paths >= 180 && frames >= 7000, `${paths} paths, ${frames} frames compared`);
});

test('latent-path.repaired-tangents: width 0 repeated visits stay byte-identical', () => {
  const m = spec('full-smooth-figure8', { controls: 4, space: 'w', width: 0 });
  const values = m.controls.map((c) => c.latent.values);
  const repeated: MorphPathSpec = {
    ...m,
    controls: m.controls.map((c, i) => ({
      ...c,
      latent: { ...c.latent, values: values[i % 2 ? i : 0]! },
    })),
  };
  const ours = createLatentPath(repeated),
    theirs = appGeometry.createLatentPath(repeated);
  assert(ours.repairedTangents > 0);
  assert.equal(ours.repairedTangents, theirs.repairedTangents);
  for (const u of [0.1, 0.3, 0.6, 0.9])
    for (let s = 0; s < 4; s++) assert(bytes(ours.sample(s, u)).equals(bytes(theirs.sample(s, u))));
});

test('latent-path.no-control-cap: 65 and 150 controls give valid finite paths in all modes; 1 control is rejected', () => {
  for (const controls of [65, 150])
    for (const kind of KINDS) {
      assertFinitePath(spec(kind, { controls, framesPerSegment: 2 }));
      if (!kind.startsWith('full-smooth'))
        assertFinitePath(spec(kind, { controls, framesPerSegment: 2, closed: false, space: 'w' }));
    }
  for (const kind of KINDS)
    assert.throws(() => createLatentPath(spec(kind, { controls: 1 })), {
      name: 'RangeError',
      message: 'Expected at least 2 control visits',
    });
  // The frame budget, not a control count, bounds the path.
  const tiny: ModelDescriptor = {
    ...FFHQ_1024_DESCRIPTOR,
    latent: { zLength: 2, layers: 1, width: 2 },
  };
  assertFinitePath(
    spec('linear', {
      controls: 49999,
      space: 'w',
      descriptor: tiny,
      framesPerSegment: 2,
      closed: false,
    }),
    tiny,
  );
  assert.throws(
    () =>
      createLatentPath(
        spec('linear', { controls: 50001, space: 'w', descriptor: tiny, framesPerSegment: 2 }),
        tiny,
      ),
    {
      message: 'Expected at least 2 frames per segment within total frame budget',
    },
  );
});

test('latent-path.frames-per-segment: any integer of at least 2 within the 100,000-frame total (fm-36ag)', () => {
  const message = 'Expected at least 2 frames per segment within total frame budget';
  const closed = spec('pairwise-figure8', { controls: 3, space: 'w', pinchCenter: true });
  const open = spec('linear', { controls: 3, space: 'w', closed: false });
  for (const geometry of [{ createLatentPath }, appGeometry])
    for (const m of [closed, open]) {
      const segments = m.closed ? 3 : 2;
      const at = (framesPerSegment: unknown) =>
        geometry.createLatentPath({ ...m, framesPerSegment } as MorphPathSpec);
      for (const n of [2, 3, 7, 33])
        assert.equal(at(n).totalFrames, segments * n + (m.closed ? 0 : 1));
      // The largest count whose total stays within LIMITS.frames, and one more.
      const largest = Math.floor((LIMITS.frames - (m.closed ? 0 : 1)) / segments);
      assert.ok(segments * largest + (m.closed ? 0 : 1) <= LIMITS.frames);
      assert.equal(at(largest).totalFrames, segments * largest + (m.closed ? 0 : 1));
      for (const n of [0, 1, 1.5, '16', NaN, Infinity, -2, largest + 1])
        assert.throws(() => at(n), { name: 'RangeError', message }, String(n));
    }
  // An odd count samples u = k/n exactly; it never visits the midpoint and every frame is finite.
  for (const kind of KINDS) {
    const path = createLatentPath(spec(kind, { controls: 3, framesPerSegment: 7 }));
    const frames = [...path.frames()];
    assert.equal(frames.length, 21);
    assert.deepEqual(
      frames.filter((f) => f.visitId).map((f) => f.index),
      [0, 7, 14],
    );
    for (const f of frames)
      assert.deepEqual(
        bytes(f.values),
        bytes(path.sample(f.segment, (f.index % 7) / 7)),
        `${kind} frame ${f.index}`,
      );
  }
});

test('latent-path.sanity-bounds: frames, fps and the other validation messages are unchanged', () => {
  const m = spec('full-smooth-figure8', { controls: 3, space: 'w' });
  const both = (patch: Partial<MorphPathSpec>, message: string): void => {
    const bad = { ...m, ...patch } as MorphPathSpec;
    assert.throws(() => createLatentPath(bad), { name: 'RangeError', message });
    assert.throws(() => appGeometry.createLatentPath(bad), { name: 'RangeError', message });
  };
  both({ algorithmVersion: 'future' }, 'Unsupported latent geometry version');
  both({ width: 1.21 }, 'Width must be between 0 and 1.2');
  both({ framesPerSegment: 1 }, 'Expected at least 2 frames per segment within total frame budget');
  both(
    { framesPerSegment: 100000 },
    'Expected at least 2 frames per segment within total frame budget',
  );
  both({ framesPerSecond: 0 }, 'Frame rate must be an integer from 1 to 120');
  both({ framesPerSecond: 121 }, 'Frame rate must be an integer from 1 to 120');
  both({ closed: false }, 'Full-smooth paths require closed equal-duration segments');
  both({ kind: 'spiral' as MorphKind }, 'Invalid morph kind or flags');
  both({ controls: [m.controls[0]!, m.controls[0]!] }, 'Visits require unique nonempty IDs');
  both(
    { controls: [m.controls[0]!, { ...m.controls[0]!, visitId: 'x' }] },
    'Adjacent faces are identical or numerically indistinguishable',
  );
  const path = createLatentPath(m);
  assert.throws(() => path.sample(0, -1), { message: 'Sample outside path' });
  assert.throws(() => path.sample(3, 0), { message: 'Sample outside path' });
});

test('latent-path.descriptor: AFHQ 16x512 gives finite paths in all modes, rotating within each layer', () => {
  const afhq = AFHQ_CAT_512_DESCRIPTOR;
  const { layers, width } = afhq.latent;
  for (const kind of KINDS)
    for (const pinchCenter of [false, true]) {
      assertFinitePath(spec(kind, { controls: 3, descriptor: afhq, pinchCenter }), afhq);
      assertFinitePath(
        spec(kind, { controls: 2, descriptor: afhq, pinchCenter, width: 1.2 }),
        afhq,
      );
    }
  // FFHQ W+ is not this model's shape.
  assert.throws(
    () => createLatentPath(spec('linear', { controls: 2 }), afhq),
    LatentShapeUnsupported,
  );
  // Perturb one layer of one control: only that layer of every frame may change.
  const layer = 5;
  for (const kind of KINDS) {
    const m = spec(kind, {
      controls: 4,
      descriptor: afhq,
      pinchCenter: kind === 'full-smooth-figure8',
      framesPerSegment: 8,
    });
    const perturbed: MorphPathSpec = {
      ...m,
      controls: m.controls.map((c, i) =>
        i !== 1
          ? c
          : {
              ...c,
              latent: {
                ...c.latent,
                values: Array.from(c.latent.values, (x, d) =>
                  Math.floor(d / width) === layer ? x + 0.3 + (d % 7) * 0.05 : x,
                ),
              },
            },
      ),
    };
    const a = createLatentPath(m, afhq),
      b = createLatentPath(perturbed, afhq);
    assert.equal(a.repairedTangents, 0);
    assert.equal(b.repairedTangents, 0);
    const before = [...a.frames()];
    let changed = 0;
    for (const frame of b.frames()) {
      const old = before[frame.index]!.values;
      for (let l = 0; l < layers; l++) {
        const slice = (v: Float64Array): Buffer => bytes(v.subarray(l * width, (l + 1) * width));
        const same = slice(frame.values).equals(slice(old));
        if (l === layer) changed += same ? 0 : 1;
        else
          assert(
            same,
            `${kind} frame ${frame.index}: layer ${l} changed when only layer ${layer} was perturbed`,
          );
      }
    }
    assert(changed > 0, `${kind}: the perturbed layer never changed`);
    // The rotation pairs d with d + width/2 inside a layer: the pair ellipse midpoint, per coordinate.
    if (kind === 'pairwise-ellipse') {
      const sample = a.sample(0, 0.5),
        p = m.controls[0]!.latent.values,
        q = m.controls[1]!.latent.values;
      for (let d = 0; d < sample.length; d++) {
        const local = d % width,
          partner = d - local + ((local + width / 2) % width);
        const rotated = ((local < width / 2 ? -1 : 1) * (p[partner]! - q[partner]!)) / 2;
        assert(Math.abs(sample[d]! - ((p[d]! + q[d]!) / 2 + m.width * rotated)) < 1e-12);
      }
    }
  }
});

test('latent-path.unsupported-shape: typed errors name the field', () => {
  const afhq = AFHQ_CAT_512_DESCRIPTOR;
  const reshaped = (latent: Partial<ModelDescriptor['latent']>): ModelDescriptor => ({
    ...afhq,
    latent: { ...afhq.latent, ...latent },
  });
  const m = spec('pairwise-ellipse', { controls: 2, descriptor: afhq });
  const expectField = (fn: () => unknown, field: string): void => {
    assert.throws(fn, (error: unknown) => {
      assert(error instanceof LatentShapeUnsupported, String(error));
      assert(error instanceof RangeError);
      assert.equal(error.name, 'LatentShapeUnsupported');
      assert.equal(error.field, field);
      assert(error.message.startsWith(`${field}: `), error.message);
      return true;
    });
  };
  expectField(() => createLatentPath(m, reshaped({ width: 511 })), 'latent.width');
  expectField(() => createLatentPath(m, reshaped({ width: 0 })), 'latent.width');
  expectField(() => createLatentPath(m, reshaped({ layers: 0 })), 'latent.layers');
  expectField(() => createLatentPath(m, reshaped({ layers: 1.5 })), 'latent.layers');
  expectField(() => createLatentPath(m, reshaped({ zLength: 513 })), 'latent.zLength');
  const short: MorphPathSpec = {
    ...m,
    controls: m.controls.map((c, i) =>
      i ? { ...c, latent: { ...c.latent, values: Array.from(c.latent.values).slice(1) } } : c,
    ),
  };
  expectField(() => createLatentPath(short, afhq), 'controls[1].latent.values');
  const wrongShape: MorphPathSpec = {
    ...m,
    controls: m.controls.map((c) => ({
      ...c,
      latent: { ...c.latent, shape: [afhq.latent.layers * afhq.latent.width] },
    })),
  };
  expectField(() => createLatentPath(wrongShape, afhq), 'controls[0].latent.shape');
  expectField(
    () => createLatentPath(spec('linear', { controls: 2 }), afhq),
    'controls[0].latent.shape',
  );
  // FFHQ's own messages keep their text after the field.
  assert.throws(
    () =>
      createLatentPath({
        ...wrongShape,
        controls: spec('linear', { controls: 2 }).controls.map((c) => ({
          ...c,
          latent: { ...c.latent, shape: [9 * 1024] },
        })),
      }),
    {
      message:
        'controls[0].latent.shape: Only labelled 512D Z/W and 18×512 W+ are supported for stylegan2-ffhq-config-f',
    },
  );
});

test('infill: indices and frames match the candidate module (frozen control)', () => {
  for (const [total, per] of [
    [32, 16],
    [16, 8],
    [26, 8],
    [64, 8],
    [7, 2],
    [1, 2],
    [100, 6],
  ] as const)
    assert.deepEqual([...infillIndices(total, per)], [...appInfill.infillIndices(total, per)]);
  assert.deepEqual([...infillIndices(32, 16)].slice(0, 8), [0, 16, 8, 24, 4, 12, 20, 28]);
  for (const bad of [
    [0, 2],
    [4, 1],
    [1.5, 2],
  ] as const) {
    assert.throws(() => [...infillIndices(bad[0], bad[1])], {
      name: 'RangeError',
      message: 'Invalid morph frame counts',
    });
    assert.throws(() => [...appInfill.infillIndices(bad[0], bad[1])], { name: 'RangeError' });
  }
  for (const kind of KINDS) {
    const m = spec(kind, { controls: 3, framesPerSegment: 8 });
    const ours = [...infillFrames(createLatentPath(m), m)],
      theirs = [...appInfill.infillFrames(appGeometry.createLatentPath(m), m)];
    assert.equal(ours.length, theirs.length);
    ours.forEach((f, i) => {
      const t = theirs[i]!;
      assert.deepEqual([f.index, f.segment, f.u, f.visitId], [t.index, t.segment, t.u, t.visitId]);
      assert(bytes(f.values).equals(bytes(t.values)));
    });
  }
  // Open paths: the final frame is the last segment at u = 1 (the candidate module throws there).
  const open = spec('linear', { controls: 3, closed: false, space: 'w', framesPerSegment: 4 });
  const path = createLatentPath(open);
  const frames = [...infillFrames(path, open)];
  assert.equal(frames.length, path.totalFrames);
  assert.deepEqual(new Set(frames.map((f) => f.index)).size, path.totalFrames);
  const last = frames.find((f) => f.index === 8)!;
  assert.deepEqual([last.segment, last.u, last.visitId], [1, 1, 'visit-2']);
  assert(bytes(last.values).equals(bytes(Float64Array.from(open.controls[2]!.latent.values))));
  assert.throws(() => [...appInfill.infillFrames(appGeometry.createLatentPath(open), open)], {
    message: 'Sample outside path',
  });
});
