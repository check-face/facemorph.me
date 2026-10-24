// @facemorph/browser-model-manager: the manager contracts (fm-hwh) and the model cache, shard store and
// SHA-256 moved from the candidate (fm-eulc), and the acquisition primitives (fm-fr9s).
export const PACKAGE = '@facemorph/browser-model-manager' as const;
export * from './contracts/index.ts';
export * from './cache/index.ts';
export * from './handles/index.ts';
export * from './adapters/index.ts';
export * from './acquisition/index.ts';
