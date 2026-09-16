/** Shared browser/desktop latent geometry. No inference, random input or DOM. */
export const GEOMETRY_VERSION = 'latent-path-v1';
export const LIMITS = Object.freeze({ controls: 64, width: 1.2, frames: 100000, absoluteInput: 10000 });
const kinds = new Set(['linear', 'pairwise-ellipse', 'pairwise-figure8', 'full-smooth-ellipse', 'full-smooth-figure8']);
const combine = (...terms) => Float64Array.from(terms[0][0], (_, d) => terms.reduce((s, [v, k]) => s + v[d] * k, 0));
const norm = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const difference = (a, b) => combine([a, 1], [b, -1]);
// W+ is eighteen independent 512D rotations, never a rotation across layers.
function rotate(v) {
  const out = new Float64Array(v.length);
  for (let layer = 0; layer < v.length; layer += 512)
    for (let d = 0; d < 256; d++) { out[layer + d] = -v[layer + 256 + d]; out[layer + 256 + d] = v[layer + d]; }
  return out;
}
function seconds(points) {
  const n = points.length;
  const matrix = points.map((_, i) => {
    const row = new Float64Array(n); row[i] = 4; row[(i + n - 1) % n] += 1; row[(i + 1) % n] += 1; return row;
  });
  const rhs = points.map((p, i) => combine([points[(i + n - 1) % n], 6], [p, -12], [points[(i + 1) % n], 6]));
  // Positive definite cyclic system; one factorization serves every latent component.
  for (let i = 0; i < n; i++) {
    const pivot = matrix[i][i];
    for (let j = i; j < n; j++) matrix[i][j] /= pivot;
    for (let d = 0; d < rhs[i].length; d++) rhs[i][d] /= pivot;
    for (let r = 0; r < n; r++) if (r !== i) {
      const factor = matrix[r][i];
      for (let j = i; j < n; j++) matrix[r][j] -= factor * matrix[i][j];
      for (let d = 0; d < rhs[i].length; d++) rhs[r][d] -= factor * rhs[i][d];
    }
  }
  return rhs;
}
function polar(u, figure8, pinch, side = 1) {
  let x, y, ddx, ddy, h;
  if (!figure8) {
    h = Math.PI; const s = Math.sin(h * u), c = Math.cos(h * u);
    x = c; y = pinch ? s * c * c : s;
    ddx = -c; ddy = pinch ? s * (9 * s * s - 7) : -s;
  } else {
    const left = u < .5 || (u === .5 && side < 0);
    const theta = left ? Math.PI * u / 2 : Math.PI * (1.5 - u / 2);
    h = left ? Math.PI / 2 : -Math.PI / 2;
    const c = Math.cos(theta), s = Math.sin(theta), r = Math.cos(2 * theta), q = Math.sin(2 * theta);
    x = r * c; y = pinch ? 4.7 * r * r * s : 3.5 * r * s;
    ddx = -5 * r * c + 4 * q * s;
    ddy = pinch ? 4.7 * ((8 * q * q - 9 * r * r) * s - 8 * r * q * c) : 3.5 * (-5 * r * s - 4 * q * c);
  }
  return { x, y, ax: ddx * h * h, ay: ddy * h * h };
}
function requireValid(m) {
  const fail = message => { throw new RangeError(message); };
  if (!m || m.algorithmVersion !== GEOMETRY_VERSION) fail('Unsupported latent geometry version');
  if (!kinds.has(m.kind) || typeof m.closed !== 'boolean' || typeof m.pinchCenter !== 'boolean') fail('Invalid morph kind or flags');
  if (!Number.isFinite(m.width) || m.width < 0 || m.width > LIMITS.width) fail('Width must be between 0 and 1.2');
  if (!Array.isArray(m.controls) || m.controls.length < 2 || m.controls.length > LIMITS.controls) fail('Expected 2–64 control visits');
  if (m.kind.startsWith('full-smooth') && !m.closed) fail('Full-smooth paths require closed equal-duration segments');
  const ids = new Set(); let space, shapeKey;
  for (const control of m.controls) {
    if (typeof control?.visitId !== 'string' || !control.visitId.trim() || control.visitId.length > 4096 || ids.has(control.visitId)) fail('Visits require unique nonempty IDs');
    ids.add(control.visitId);
    const l = control.latent;
    if (!l || !Array.isArray(l.shape) || !l.shape.every(Number.isInteger)) fail('Explicit latent space and shape required');
    const key = l.shape.join(',');
    if (!((['z', 'w'].includes(l.space) && key === '512') || (l.space === 'w-plus' && key === '18,512'))) fail('Only labelled 512D Z/W and 18×512 W+ are supported');
    if (space && (space !== l.space || shapeKey !== key)) fail('Mixed latent spaces or shapes are forbidden');
    space = l.space; shapeKey = key;
    const size = l.space === 'w-plus' ? 9216 : 512;
    if (!(Array.isArray(l.values) || l.values instanceof Float32Array || l.values instanceof Float64Array) || l.values.length !== size) fail('Invalid latent value count');
    for (const x of l.values) if (!Number.isFinite(x) || Math.abs(x) > LIMITS.absoluteInput) fail('Nonfinite or out-of-budget latent');
  }
  const segments = m.closed ? m.controls.length : m.controls.length - 1;
  if (!Number.isInteger(m.framesPerSegment) || m.framesPerSegment < 2 || m.framesPerSegment % 2 || segments * m.framesPerSegment + (m.closed ? 0 : 1) > LIMITS.frames) fail('Expected even frames per segment within total frame budget');
  if (!Number.isInteger(m.framesPerSecond) || m.framesPerSecond < 1 || m.framesPerSecond > 120) fail('Frame rate must be an integer from 1 to 120');
  for (let i = 0; i < segments; i++) {
    const a = m.controls[i].latent.values, b = m.controls[(i + 1) % m.controls.length].latent.values;
    if (Math.sqrt(a.reduce((sum, x, d) => sum + (x - b[d]) ** 2, 0)) < 1e-12) fail('Adjacent faces are identical or numerically indistinguishable');
  }
  return segments;
}
/** Consume the Project v1 morph wire object. Snapshots inputs; outputs never alias it. */
export function createLatentPath(morph) {
  const segments = requireValid(morph);
  const { kind, width, pinchCenter: pinch, closed, framesPerSegment, framesPerSecond } = morph;
  const points = morph.controls.map(c => Float64Array.from(c.latent.values));
  const visitIds = morph.controls.map(c => c.visitId);
  const n = points.length, figure8 = kind.endsWith('figure8'), smooth = kind.startsWith('full-smooth') && n > 2;
  const chords = Array.from({ length: segments }, (_, i) => difference(points[(i + 1) % n], points[i]));
  const transverse = chords.map(c => combine([rotate(c), -.5 * width]));
  if (n === 2 && closed && figure8) transverse[1] = transverse[0].slice();
  const midpoints = chords.map((_, i) => combine([points[i], .5], [points[(i + 1) % n], .5]));
  let coefficients, shifts, repairedTangents = 0;
  if (smooth) {
    const acceleration = seconds(points);
    const velocity = chords.map((d, i) => combine([d, 1], [acceleration[i], -1 / 3], [acceleration[(i + 1) % n], -1 / 6]));
    velocity.forEach((v, i) => {
      const scale = (norm(chords[(i + n - 1) % n]) + norm(chords[i])) / 2;
      if (norm(v) < .1 * scale) {
        // Derive direction before multiplying by width, including width=0.
        const direction = rotate(chords[i]);
        velocity[i] = combine([direction, -.9 * scale / norm(direction)]); repairedTangents++;
      }
    });
    coefficients = chords.map((d, i) => {
      const j = (i + 1) % n, v = velocity[i], w = velocity[j], a = acceleration[i], b = acceleration[j];
      return [points[i], v, combine([a, .5]), combine([d, 10], [v, -6], [w, -4], [a, -1.5], [b, .5]), combine([d, -15], [v, 8], [w, 7], [a, 1.5], [b, -1]), combine([d, 6], [v, -3], [w, -3], [a, -.5], [b, .5])];
    });
    shifts = midpoints.map((mid, i) => difference(mid, base(i, .5)));
  }
  function base(i, u) {
    const c = coefficients[i], out = c[5].slice();
    for (let degree = 4; degree >= 0; degree--) for (let d = 0; d < out.length; d++) out[d] = out[d] * u + c[degree][d];
    return out;
  }
  function sample(i, u) {
    if (!Number.isInteger(i) || i < 0 || i >= segments || !Number.isFinite(u) || u < 0 || u > 1) throw new RangeError('Sample outside path');
    if (u === 0) return points[i].slice();
    if (u === 1) return points[(i + 1) % n].slice();
    if (u === .5 && (figure8 || pinch)) return midpoints[i].slice();
    if (kind === 'linear') return combine([points[i], 1 - u], [points[(i + 1) % n], u]);
    if (smooth) {
      let p = base(i, u);
      const window = 64 * u ** 3 * (1 - u) ** 3;
      if (figure8) p = combine([p, 1], [shifts[i], window], [transverse[i], (i % 2 ? -1 : 1) * .35 * Math.sin(2 * Math.PI * u) ** 3]);
      else p = combine([p, 1], [transverse[i], .35 * Math.sin(Math.PI * u) ** 3]);
      if (pinch) {
        const line = combine([points[i], 1 - u], [points[(i + 1) % n], u]), c = Math.cos(Math.PI * u);
        const q = figure8 ? 4.7 / 3.5 * (Math.sqrt(c * c + .04 ** 2) - .04) / (Math.sqrt(1 + .04 ** 2) - .04) : c * c;
        const f = 1 + window * (q - 1);
        p = combine([line, 1 - f], [p, f]);
      }
      return p;
    }
    const jet = polar(u, figure8, pinch);
    let p = combine([midpoints[i], 1], [chords[i], -.5 * jet.x], [transverse[i], jet.y]);
    if (figure8 && Math.abs(u - .5) < .24) {
      const left = polar(.5, true, pinch, -1), right = polar(.5, true, pinch, 1), side = u < .5 ? left : right;
      const x = Math.abs(u - .5) / .24, weight = .24 ** 2 * .5 * x * x * (1 - x) ** 3;
      p = combine([p, 1], [chords[i], -.5 * weight * ((left.ax + right.ax) / 2 - side.ax)], [transverse[i], weight * ((left.ay + right.ay) / 2 - side.ay)]);
    }
    return p;
  }
  const totalFrames = segments * framesPerSegment + (closed ? 0 : 1);
  function* frames() {
    for (let index = 0; index < totalFrames; index++) {
      const end = index === segments * framesPerSegment;
      const segment = end ? segments - 1 : Math.floor(index / framesPerSegment), u = end ? 1 : index % framesPerSegment / framesPerSegment;
      yield { index, timeSeconds: index / framesPerSecond, segment, u, visitId: u === 0 ? visitIds[segment] : end ? visitIds[n - 1] : null, values: sample(segment, u) };
    }
  }
  return Object.freeze({ algorithmVersion: GEOMETRY_VERSION, space: morph.controls[0].latent.space, shape: Object.freeze([...morph.controls[0].latent.shape]), segments, totalFrames, repairedTangents, sample, frames });
}
