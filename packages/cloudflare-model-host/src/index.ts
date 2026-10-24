// @facemorph/cloudflare-model-host: chunk staging, manifest rewriting, reconstruction verification and dry-run-first
// publication of verified model bytes to Cloudflare static hosting (fm-3osh); the mirror Worker, its deploy and its
// warm (fm-fy2.14).
export const PACKAGE = '@facemorph/cloudflare-model-host' as const;
export * from './limits.ts';
export * from './chunks.ts';
export * from './manifest.ts';
export * from './stage.ts';
export * from './verify.ts';
export * from './publish.ts';
export * from './mirror/deploy.ts';
export * from './mirror/warm.ts';
export { mirrored, prefixes, type MirrorBucket, type MirrorEnv } from './mirror/worker.ts';
