# Latent geometry v1

`latent-path.mjs` is a dependency-free ES module for the browser and the same frontend in desktop packages. It evaluates the fixed morphs from the project wire contract; it is not a user-defined function engine. It does not perform inference or admit a runtime.

```js
import { createLatentPath, GEOMETRY_VERSION } from './latent-path.mjs';
// Assign GEOMETRY_VERSION when creating a new project. Never replace an imported
// version with the current version: createLatentPath rejects unknown algorithms.
const path = createLatentPath(project.morph);
for (const frame of path.frames()) {
  // Await synthesis before advancing. Do not materialize all frames/latents.
  await synthesize({ space: path.space, shape: path.shape, values: frame.values });
  // index, timeSeconds, segment, u and visitId identify exact face visits.
}
const values = path.sample(0, 0.5); // independent Float64Array, one pair midpoint
```

The adapter must explicitly convert to its admitted Float32 input when needed and validate rendered output against its selected bundle. Space labels are never converted implicitly. A valid path is not evidence of valid images, output quality or device admission.

## Versioned policy

`algorithmVersion: "latent-path-v1"` supports `linear`, `pairwise-ellipse`, `pairwise-figure8`, `full-smooth-ellipse`, and `full-smooth-figure8`.

- Z/W shape `[512]` rotates halves `J(a,b)=(-b,a)`. W+ shape `[18,512]` applies **the same rotation independently within each layer**, without mixing layers. All controls must have the same labelled space/shape. Other shapes are rejected, including the toy project fixture.
- Width is transverse amplitude, corresponding to the study's `state.amplitude`, bounded to0–1.2. The old study's `state.width` is an unrelated patch-support constant, not this product parameter. Polar centre correction support is fixed at0.24.
- Pairwise paths use the reviewed polar ellipse/figure-eight per pair, with the figure-eight centre acceleration correction. Pairwise joins with three or more visits do not promise C² continuity; that is the purpose of full-smooth mode. Closed two-face ellipses use opposite return transverse frames, figure eights the same frame; the return traverses the other half of the loop.
- Full-smooth two-face paths retain that pair loop. For three or more visits, use the reviewed periodic cubic/quintic tangent repair, exact midpoint correction, alternating figure-eight transverse term and optional full-deviation pinch. Tangent repair uses the direction of J before width scaling, so width zero does not disable repair. The repair threshold and magnitude use norms over the complete labelled latent, with a single consistent scalar per visit; W+ layers are not independently retimed. Nonadjacent equal faces remain separate visits.
- Pinched midpoint motion is forward along the pair chord. Face samples return exact copies of stored inputs. Figure-eight and pinched midpoint samples return exact arithmetic midpoints.
- Full-smooth paths require closed, equal-duration segments. Open linear/pairwise paths retain their terminal face; closed exports omit the repeated terminal face. Even frames per segment include face and midpoint samples. No arbitrary edited curve, open full-smooth or unequal-duration promise is made.

## Resource limits

Before copying or solving, validate2–64 controls, finite coordinates with absolute value at most10,000, adjacent chord norm at least1e-12, width0–1.2, even frames per segment and at most100,000 total frames, and integer fps1–120. Distinct visit IDs identify repeated positions. The input is snapshotted, and output arrays never expose internal state. Frame iteration is lazy; adapters must impose tighter device/video budgets and cancellation. These are numerical/resource guards, not a probability-distribution or global latent-norm quality guarantee. No general minimum playback speed or absence-of-self-intersection claim is made.

## Verification

From the workspace root:

```sh
python3 autoresearch/run.py --lane build --device local-mac --timeout 90 -- node facemorph.me/src/Next/geometry/verify.mjs
```

The independent reviewed HTML study supplies32 planar reference configurations (its planar surrogate equals actual512D rotation). Another32 configurations validate exact face visits, midpoint/pinch invariants and C² seams, including odd counts, repeated visits and W+. Dense fixtures exercise every coordinate and independent per-layer rotation; closed-form pair tests check return orientation. Validation also covers lazy frame schedules, bounded inputs, unknown versions, mutation isolation, zero-width tangent repair and64 visits.

16 September2026: passed under the shared lease, run `20260916T045925Z-08d2b51d` (~4seconds including harness). This is geometry evidence only. Generated1024 outputs, perception and actual MP4 exports must still be qualified through the integrated inference adapter; no deployment or inference qualification is implied.
