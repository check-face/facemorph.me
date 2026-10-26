// Morph latent geometry (latent-path-v1, fm-suaa), ported from the app's geometry/latent-path.mjs. No inference,
// random input or DOM. The latent shape comes from the model descriptor (default FFHQ); the per-layer rotation
// pairs dimension d with d + width/2 inside each layer and never mixes layers. For 2-64 controls the output is
// byte-identical to the app module; the 64-control cap is lifted (operator, 24 October 2026: no fixed face count).

import { FFHQ_1024_DESCRIPTOR, type ModelDescriptor } from '../contracts/descriptor.ts';

export const GEOMETRY_VERSION = 'latent-path-v1';
/** Sanity bounds. There is no upper control count; the frame budget bounds the path instead. */
export const LIMITS = Object.freeze({
  minControls: 2,
  width: 1.2,
  frames: 100000,
  absoluteInput: 10000,
  minFramesPerSecond: 1,
  maxFramesPerSecond: 120,
});

export type MorphKind =
  | 'linear'
  | 'pairwise-ellipse'
  | 'pairwise-figure8'
  | 'full-smooth-ellipse'
  | 'full-smooth-figure8';
export type LatentSpace = 'z' | 'w' | 'w-plus';
const KINDS: ReadonlySet<string> = new Set<MorphKind>([
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
]);

export type LatentValues = readonly number[] | Float32Array | Float64Array;
export interface MorphControl {
  readonly visitId: string;
  readonly latent: {
    readonly space: LatentSpace;
    readonly shape: readonly number[];
    readonly values: LatentValues;
  };
}
/** The Project v1 morph wire object. */
export interface MorphPathSpec {
  readonly algorithmVersion: string;
  readonly kind: MorphKind;
  readonly closed: boolean;
  readonly pinchCenter: boolean;
  readonly width: number;
  readonly framesPerSegment: number;
  readonly framesPerSecond: number;
  readonly controls: readonly MorphControl[];
}
export interface PathFrame {
  readonly index: number;
  readonly timeSeconds: number;
  readonly segment: number;
  readonly u: number;
  readonly visitId: string | null;
  readonly values: Float64Array;
}
export interface LatentPath {
  readonly algorithmVersion: typeof GEOMETRY_VERSION;
  readonly space: LatentSpace;
  readonly shape: readonly number[];
  readonly segments: number;
  readonly totalFrames: number;
  readonly repairedTangents: number;
  sample(segment: number, u: number): Float64Array;
  frames(): Generator<PathFrame, void, undefined>;
}

/** The latent shape cannot be morphed under this descriptor; `field` names what was refused. */
export class LatentShapeUnsupported extends RangeError {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'LatentShapeUnsupported';
    this.field = field;
  }
}

/** One latent layout the path accepts: `layers` independent rotation blocks of `layerWidth`. */
interface Layout {
  readonly shapeKey: string;
  readonly layers: number;
  readonly layerWidth: number;
}

const positiveInteger = (x: number): boolean => Number.isInteger(x) && x >= 1;

/** The Z, W and W+ layouts of a descriptor, or LatentShapeUnsupported for a shape the rotation cannot pair. */
function layouts(descriptor: ModelDescriptor): Record<LatentSpace, Layout> {
  const { zLength, layers, width } = descriptor.latent;
  const refuse = (field: string, message: string): never => {
    throw new LatentShapeUnsupported(field, message);
  };
  if (!positiveInteger(layers))
    refuse('latent.layers', `must be an integer of at least 1, got ${layers}`);
  if (!positiveInteger(width))
    refuse('latent.width', `must be an integer of at least 1, got ${width}`);
  if (width % 2)
    refuse('latent.width', `must be even so each layer pairs d with d + width/2, got ${width}`);
  if (!positiveInteger(zLength))
    refuse('latent.zLength', `must be an integer of at least 1, got ${zLength}`);
  if (zLength % 2)
    refuse('latent.zLength', `must be even so Z pairs d with d + zLength/2, got ${zLength}`);
  return {
    z: { shapeKey: `${zLength}`, layers: 1, layerWidth: zLength },
    w: { shapeKey: `${width}`, layers: 1, layerWidth: width },
    'w-plus': { shapeKey: `${layers},${width}`, layers, layerWidth: width },
  };
}

type Term = readonly [ArrayLike<number>, number];
// Same summation order as the app module (reduce from 0), so results are byte-identical.
function combine(...terms: Term[]): Float64Array {
  const first = terms[0]![0];
  const out = new Float64Array(first.length);
  for (let d = 0; d < out.length; d++) {
    let s = 0;
    for (const [v, k] of terms) s = s + v[d]! * k;
    out[d] = s;
  }
  return out;
}
const norm = (v: ArrayLike<number>): number => {
  let s = 0;
  for (let d = 0; d < v.length; d++) s = s + v[d]! * v[d]!;
  return Math.sqrt(s);
};
const difference = (a: ArrayLike<number>, b: ArrayLike<number>): Float64Array =>
  combine([a, 1], [b, -1]);

/** W+ is `layers` independent rotations of `layerWidth`, never a rotation across layers. */
function rotator(layerWidth: number): (v: Float64Array) => Float64Array {
  const half = layerWidth / 2;
  return (v) => {
    const out = new Float64Array(v.length);
    for (let layer = 0; layer < v.length; layer += layerWidth)
      for (let d = 0; d < half; d++) {
        out[layer + d] = -v[layer + half + d]!;
        out[layer + half + d] = v[layer + d]!;
      }
    return out;
  };
}

function seconds(points: readonly Float64Array[]): Float64Array[] {
  const n = points.length;
  const matrix = points.map((_, i) => {
    const row = new Float64Array(n);
    row[i] = 4;
    row[(i + n - 1) % n]! += 1;
    row[(i + 1) % n]! += 1;
    return row;
  });
  const rhs = points.map((p, i) =>
    combine([points[(i + n - 1) % n]!, 6], [p, -12], [points[(i + 1) % n]!, 6]),
  );
  // Positive definite cyclic system; one factorization serves every latent component.
  for (let i = 0; i < n; i++) {
    const mi = matrix[i]!,
      ri = rhs[i]!;
    const pivot = mi[i]!;
    for (let j = i; j < n; j++) mi[j]! /= pivot;
    for (let d = 0; d < ri.length; d++) ri[d]! /= pivot;
    for (let r = 0; r < n; r++)
      if (r !== i) {
        const mr = matrix[r]!,
          rr = rhs[r]!;
        const factor = mr[i]!;
        for (let j = i; j < n; j++) mr[j]! -= factor * mi[j]!;
        for (let d = 0; d < ri.length; d++) rr[d]! -= factor * ri[d]!;
      }
  }
  return rhs;
}

interface Jet {
  readonly x: number;
  readonly y: number;
  readonly ax: number;
  readonly ay: number;
}
function polar(u: number, figure8: boolean, pinch: boolean, side = 1): Jet {
  let x: number, y: number, ddx: number, ddy: number, h: number;
  if (!figure8) {
    h = Math.PI;
    const s = Math.sin(h * u),
      c = Math.cos(h * u);
    x = c;
    y = pinch ? s * c * c : s;
    ddx = -c;
    ddy = pinch ? s * (9 * s * s - 7) : -s;
  } else {
    const left = u < 0.5 || (u === 0.5 && side < 0);
    const theta = left ? (Math.PI * u) / 2 : Math.PI * (1.5 - u / 2);
    h = left ? Math.PI / 2 : -Math.PI / 2;
    const c = Math.cos(theta),
      s = Math.sin(theta),
      r = Math.cos(2 * theta),
      q = Math.sin(2 * theta);
    x = r * c;
    y = pinch ? 4.7 * r * r * s : 3.5 * r * s;
    ddx = -5 * r * c + 4 * q * s;
    ddy = pinch
      ? 4.7 * ((8 * q * q - 9 * r * r) * s - 8 * r * q * c)
      : 3.5 * (-5 * r * s - 4 * q * c);
  }
  return { x, y, ax: ddx * h * h, ay: ddy * h * h };
}

const isValues = (v: unknown): v is LatentValues =>
  Array.isArray(v) || v instanceof Float32Array || v instanceof Float64Array;

function requireValid(
  m: MorphPathSpec,
  descriptor: ModelDescriptor,
): { segments: number; layout: Layout } {
  const fail = (message: string): never => {
    throw new RangeError(message);
  };
  const refuse = (field: string, message: string): never => {
    throw new LatentShapeUnsupported(field, message);
  };
  const spaces = layouts(descriptor);
  const { zLength, layers, width } = descriptor.latent;
  const labels =
    zLength === width
      ? `${width}D Z/W and ${layers}×${width} W+`
      : `${zLength}D Z, ${width}D W and ${layers}×${width} W+`;
  if (!m || m.algorithmVersion !== GEOMETRY_VERSION) fail('Unsupported latent geometry version');
  if (!KINDS.has(m.kind) || typeof m.closed !== 'boolean' || typeof m.pinchCenter !== 'boolean')
    fail('Invalid morph kind or flags');
  if (!Number.isFinite(m.width) || m.width < 0 || m.width > LIMITS.width)
    fail('Width must be between 0 and 1.2');
  if (!Array.isArray(m.controls) || m.controls.length < LIMITS.minControls)
    fail('Expected at least 2 control visits');
  if (m.kind.startsWith('full-smooth') && !m.closed)
    fail('Full-smooth paths require closed equal-duration segments');
  const ids = new Set<string>();
  let space: LatentSpace | undefined, shapeKey: string | undefined, layout: Layout | undefined;
  m.controls.forEach((control: MorphControl | undefined, i) => {
    const field = `controls[${i}].latent`;
    if (
      typeof control?.visitId !== 'string' ||
      !control.visitId.trim() ||
      control.visitId.length > 4096 ||
      ids.has(control.visitId)
    )
      fail('Visits require unique nonempty IDs');
    ids.add(control!.visitId);
    const l = control!.latent as MorphControl['latent'] | undefined;
    if (!l || !Array.isArray(l.shape) || !l.shape.every(Number.isInteger))
      fail('Explicit latent space and shape required');
    const key = l!.shape.join(',');
    const accepted = Object.hasOwn(spaces, l!.space) ? spaces[l!.space] : undefined;
    if (!accepted || accepted.shapeKey !== key)
      refuse(
        `${field}.shape`,
        `Only labelled ${labels} are supported for ${descriptor.identity.name}`,
      );
    if (space && (space !== l!.space || shapeKey !== key))
      fail('Mixed latent spaces or shapes are forbidden');
    space = l!.space;
    shapeKey = key;
    layout = accepted!;
    const size = accepted!.layers * accepted!.layerWidth;
    if (!isValues(l!.values) || l!.values.length !== size)
      refuse(`${field}.values`, `Invalid latent value count: expected ${size} (${key})`);
    for (const x of l!.values)
      if (!Number.isFinite(x) || Math.abs(x) > LIMITS.absoluteInput)
        fail('Nonfinite or out-of-budget latent');
  });
  const segments = m.closed ? m.controls.length : m.controls.length - 1;
  if (
    !Number.isInteger(m.framesPerSegment) ||
    m.framesPerSegment < 2 ||
    m.framesPerSegment % 2 ||
    segments * m.framesPerSegment + (m.closed ? 0 : 1) > LIMITS.frames
  )
    fail('Expected even frames per segment within total frame budget');
  if (
    !Number.isInteger(m.framesPerSecond) ||
    m.framesPerSecond < LIMITS.minFramesPerSecond ||
    m.framesPerSecond > LIMITS.maxFramesPerSecond
  )
    fail('Frame rate must be an integer from 1 to 120');
  for (let i = 0; i < segments; i++) {
    const a = m.controls[i]!.latent.values,
      b = m.controls[(i + 1) % m.controls.length]!.latent.values;
    let sum = 0;
    for (let d = 0; d < a.length; d++) sum = sum + (a[d]! - b[d]!) ** 2;
    if (Math.sqrt(sum) < 1e-12)
      fail('Adjacent faces are identical or numerically indistinguishable');
  }
  return { segments, layout: layout! };
}

/**
 * Consume the Project v1 morph wire object for a model (default FFHQ). Snapshots inputs; outputs never alias
 * them. Throws RangeError for an invalid path, LatentShapeUnsupported (a RangeError with `field`) for a latent
 * shape the descriptor does not declare or cannot rotate.
 */
export function createLatentPath(
  morph: MorphPathSpec,
  descriptor: ModelDescriptor = FFHQ_1024_DESCRIPTOR,
): LatentPath {
  const { segments, layout } = requireValid(morph, descriptor);
  const rotate = rotator(layout.layerWidth);
  const { kind, width, pinchCenter: pinch, closed, framesPerSegment, framesPerSecond } = morph;
  const points = morph.controls.map((c) => Float64Array.from(c.latent.values));
  const visitIds = morph.controls.map((c) => c.visitId);
  const n = points.length,
    figure8 = kind.endsWith('figure8'),
    smooth = kind.startsWith('full-smooth') && n > 2;
  const at = (i: number): Float64Array => points[i % n]!;
  const chords = Array.from({ length: segments }, (_, i) => difference(at(i + 1), at(i)));
  const transverse = chords.map((c) => combine([rotate(c), -0.5 * width]));
  if (n === 2 && closed && figure8) transverse[1] = transverse[0]!.slice();
  const midpoints = chords.map((_, i) => combine([at(i), 0.5], [at(i + 1), 0.5]));
  let coefficients: Float64Array[][] = [],
    shifts: Float64Array[] = [],
    repairedTangents = 0;
  function base(i: number, u: number): Float64Array {
    const c = coefficients[i]!,
      out = c[5]!.slice();
    for (let degree = 4; degree >= 0; degree--) {
      const cd = c[degree]!;
      for (let d = 0; d < out.length; d++) out[d] = out[d]! * u + cd[d]!;
    }
    return out;
  }
  if (smooth) {
    const acceleration = seconds(points);
    const velocity = chords.map((d, i) =>
      combine([d, 1], [acceleration[i]!, -1 / 3], [acceleration[(i + 1) % n]!, -1 / 6]),
    );
    velocity.forEach((v, i) => {
      const scale = (norm(chords[(i + n - 1) % n]!) + norm(chords[i]!)) / 2;
      if (norm(v) < 0.1 * scale) {
        // Derive direction before multiplying by width, including width=0.
        const direction = rotate(chords[i]!);
        velocity[i] = combine([direction, (-0.9 * scale) / norm(direction)]);
        repairedTangents++;
      }
    });
    coefficients = chords.map((d, i) => {
      const j = (i + 1) % n,
        v = velocity[i]!,
        w = velocity[j]!,
        a = acceleration[i]!,
        b = acceleration[j]!;
      return [
        points[i]!,
        v,
        combine([a, 0.5]),
        combine([d, 10], [v, -6], [w, -4], [a, -1.5], [b, 0.5]),
        combine([d, -15], [v, 8], [w, 7], [a, 1.5], [b, -1]),
        combine([d, 6], [v, -3], [w, -3], [a, -0.5], [b, 0.5]),
      ];
    });
    shifts = midpoints.map((mid, i) => difference(mid, base(i, 0.5)));
  }
  function sample(i: number, u: number): Float64Array {
    if (!Number.isInteger(i) || i < 0 || i >= segments || !Number.isFinite(u) || u < 0 || u > 1)
      throw new RangeError('Sample outside path');
    const from = at(i),
      to = at(i + 1);
    if (u === 0) return from.slice();
    if (u === 1) return to.slice();
    if (u === 0.5 && (figure8 || pinch)) return midpoints[i]!.slice();
    if (kind === 'linear') return combine([from, 1 - u], [to, u]);
    const chord = chords[i]!,
      across = transverse[i]!;
    if (smooth) {
      let p = base(i, u);
      const window = 64 * u ** 3 * (1 - u) ** 3;
      if (figure8)
        p = combine(
          [p, 1],
          [shifts[i]!, window],
          [across, (i % 2 ? -1 : 1) * 0.35 * Math.sin(2 * Math.PI * u) ** 3],
        );
      else p = combine([p, 1], [across, 0.35 * Math.sin(Math.PI * u) ** 3]);
      if (pinch) {
        const line = combine([from, 1 - u], [to, u]),
          c = Math.cos(Math.PI * u);
        const q = figure8
          ? ((4.7 / 3.5) * (Math.sqrt(c * c + 0.04 ** 2) - 0.04)) /
            (Math.sqrt(1 + 0.04 ** 2) - 0.04)
          : c * c;
        const f = 1 + window * (q - 1);
        p = combine([line, 1 - f], [p, f]);
      }
      return p;
    }
    const jet = polar(u, figure8, pinch);
    let p = combine([midpoints[i]!, 1], [chord, -0.5 * jet.x], [across, jet.y]);
    if (figure8 && Math.abs(u - 0.5) < 0.24) {
      const left = polar(0.5, true, pinch, -1),
        right = polar(0.5, true, pinch, 1),
        side = u < 0.5 ? left : right;
      const x = Math.abs(u - 0.5) / 0.24,
        weight = 0.24 ** 2 * 0.5 * x * x * (1 - x) ** 3;
      p = combine(
        [p, 1],
        [chord, -0.5 * weight * ((left.ax + right.ax) / 2 - side.ax)],
        [across, weight * ((left.ay + right.ay) / 2 - side.ay)],
      );
    }
    return p;
  }
  const totalFrames = segments * framesPerSegment + (closed ? 0 : 1);
  function* frames(): Generator<PathFrame, void, undefined> {
    for (let index = 0; index < totalFrames; index++) {
      const end = index === segments * framesPerSegment;
      const segment = end ? segments - 1 : Math.floor(index / framesPerSegment),
        u = end ? 1 : (index % framesPerSegment) / framesPerSegment;
      yield {
        index,
        timeSeconds: index / framesPerSecond,
        segment,
        u,
        visitId: u === 0 ? visitIds[segment]! : end ? visitIds[n - 1]! : null,
        values: sample(segment, u),
      };
    }
  }
  const first = morph.controls[0]!.latent;
  return Object.freeze({
    algorithmVersion: GEOMETRY_VERSION,
    space: first.space,
    shape: Object.freeze([...first.shape]),
    segments,
    totalFrames,
    repairedTangents,
    sample,
    frames,
  });
}
