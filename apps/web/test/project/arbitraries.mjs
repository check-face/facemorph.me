// fast-check arbitraries for project-json (fm-7s3a): valid projects (every structural rule met: distinct visit
// IDs, matching shapes and spaces, distinct adjacent latents, closed full-smooth paths, even frame counts), and
// edits of their text.
import { KINDS } from './cases.mjs';

export function validProject(fc) {
  const sha = fc.stringMatching(/^[0-9a-f]{64}$/);
  const finite = (min) =>
    fc.double({ min, noNaN: true, noDefaultInfinity: true }).filter((v) => !Object.is(v, -0));
  return fc
    .record({
      version: fc.string({ minLength: 1, maxLength: 40 }).filter((v) => v.trim() !== ''),
      manifestSha256: sha,
      modelSha256: sha,
      noiseSha256: sha,
      truncationPsi: finite(0),
      truncationCutoff: fc.integer({ min: 0, max: 2147483647 }),
      algorithmVersion: fc.string({ minLength: 1, maxLength: 40 }).filter((v) => v.trim() !== ''),
      kind: fc.constantFrom(...KINDS),
      open: fc.boolean(),
      width: finite(0),
      pinchCenter: fc.boolean(),
      framesPerSegment: fc.integer({ min: 1, max: 50000 }).map((n) => n * 2),
      framesPerSecond: fc.integer({ min: 1, max: 240 }),
      space: fc.constantFrom('z', 'w', 'w-plus'),
      shape: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 3 }),
      count: fc.integer({ min: 2, max: 6 }),
      seed: fc.array(finite(-1e6), { minLength: 54, maxLength: 54 }),
    })
    .map((r) => {
      const size = r.shape.reduce((n, d) => n * d, 1);
      const controls = Array.from({ length: r.count }, (_, i) => ({
        visitId: `visit-${i}`,
        latent: {
          space: r.space,
          shape: r.shape,
          // The first value is the control's index, so adjacent latents always differ.
          values: Array.from({ length: size }, (_, j) =>
            j === 0 ? i : (r.seed[(i * size + j) % r.seed.length] ?? 0),
          ),
        },
      }));
      const fullSmooth = r.kind.startsWith('full-smooth');
      return {
        schemaVersion: 1,
        bundle: { version: r.version, manifestSha256: r.manifestSha256 },
        modelSha256: r.modelSha256,
        noiseSha256: r.noiseSha256,
        truncationPsi: r.truncationPsi,
        truncationCutoff: r.truncationCutoff,
        morph: {
          algorithmVersion: r.algorithmVersion,
          kind: r.kind,
          controls,
          closed: fullSmooth || !r.open,
          width: r.width,
          pinchCenter: r.pinchCenter,
          framesPerSegment: r.framesPerSegment,
          framesPerSecond: r.framesPerSecond,
        },
      };
    });
}

/** A valid project's text with one character inserted, deleted or replaced. */
export function editedText(fc) {
  return fc
    .tuple(
      validProject(fc),
      fc.nat(),
      fc.constantFrom('insert', 'delete', 'replace'),
      fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
    )
    .map(([p, at, op, c]) => {
      const t = JSON.stringify(p);
      const i = at % (t.length + 1);
      return op === 'insert'
        ? t.slice(0, i) + c + t.slice(i)
        : op === 'delete'
          ? t.slice(0, i) + t.slice(i + 1)
          : t.slice(0, i) + c + t.slice(i + 1);
    });
}
