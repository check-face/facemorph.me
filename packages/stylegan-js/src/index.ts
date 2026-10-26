// stylegan-js public entry point. Engine contracts so far (fm-z5wy); the engine follows.
export * from './contracts/capability.ts';
export * from './contracts/timing.ts';
export * from './contracts/operations.ts';
export * from './contracts/worker-messages.ts';
export * from './contracts/recovery-metadata.ts';
export * from './contracts/crop-policy.ts';
export * from './contracts/photo-admission.ts';
export * from './contracts/numerics.ts';
export {
  canonicalJson,
  CanonicalJsonError,
  type CanonicalValue,
} from './contracts/canonical-json.ts';
export * from './media/envelope.ts';
export * from './media/inspect-still.ts';
export * from './media/recovery-v3.ts';
export * from './media/mp4-project.ts';
export { encodeVp8lWebp, WEBP_LOSSLESS_MAX_EDGE } from './media/webp-lossless.ts';
export * from './contracts/descriptor.ts';
export * from './blend/blend.ts';
export * from './blend/recipe.ts';
// Morph orchestration (fm-suaa) and the descriptor-driven latent path, as the app's bridge consumes them (fm-ioap).
export * from './morph/latent-path.ts';
export * from './morph/infill.ts';
export {
  renderMorph,
  selectBranch,
  FRAME_WINDOW,
  SPARSE_ANCHORS,
  type MorphImage,
  type MorphFrame,
  type MorphPath,
  type MorphLatent,
  type MorphFrameSource,
  type MorphWriter,
  type MorphFrameStore,
  type MorphSettlement,
  type RenderMorphOptions,
} from './morph/render.ts';
