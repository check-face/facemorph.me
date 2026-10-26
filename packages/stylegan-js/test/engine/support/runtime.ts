// The acquired candidate runtime on disk (scripts/runtime/acquire.mjs; default ~/.cache/facemorph-runtime,
// FACEMORPH_RUNTIME_CACHE to override), read through a verifying local reader as the manager's verified reads do:
// each chunk's and the whole asset's size and SHA-256 are checked on every read, a missing file is a cache miss, a
// wrong one is corrupt, and nothing is fetched. `root` lets a test read a planted copy (a corrupted asset is an input
// file, not a fake). Where the default pinned runtime is not acquired, the model tests report untested.
// Staged qualification supplies FACEMORPH_RUNTIME_SHA256 with FACEMORPH_RUNTIME_CACHE; an explicitly requested
// runtime must match that digest or fail, so a broken candidate cannot silently turn into skipped model tests.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EngineAsset, LocalAssetReader } from '../../../src/engine/reader.ts';

export const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ?? join(homedir(), '.cache/facemorph-runtime');
export const PINNED_MANIFEST_SHA256 =
  'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
export const UNTESTED =
  'untested: the candidate runtime is not acquired here (scripts/runtime/acquire.mjs)';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The file an asset (or chunk) lives at under `root`. */
export const pathOf = (at: { url?: string; file?: string }, root = RUNTIME) =>
  at.url ? join(root, at.url.split('/runtime/')[1] ?? '') : join(root, at.file ?? '');

/** The runtime manifest as read; tests narrow it to the fields they use. */
export type RuntimeManifest = Record<string, unknown>;

export function acquiredManifest(
  root = RUNTIME,
  requestedSha256 = process.env['FACEMORPH_RUNTIME_SHA256'],
): { manifest: RuntimeManifest; sha256: string } | null {
  const expected = requestedSha256 ?? PINNED_MANIFEST_SHA256;
  if (!/^[a-f0-9]{64}$/.test(expected))
    throw Error('FACEMORPH_RUNTIME_SHA256 must be a lowercase SHA-256 digest');
  const path = join(root, 'manifest.json');
  if (!existsSync(path)) {
    if (requestedSha256 !== undefined)
      throw Error(`Requested runtime manifest is missing: ${path}`);
    return null;
  }
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (actual !== expected) {
    if (requestedSha256 !== undefined)
      throw Error(
        `Requested runtime manifest SHA-256 mismatch: expected ${expected}, got ${actual}`,
      );
    return null;
  }
  return { manifest: JSON.parse(bytes.toString('utf8')), sha256: actual };
}

export function runtimeReader(root = RUNTIME, reads: string[] = []): LocalAssetReader {
  const fail = (code: 'cache-miss' | 'corrupt', sha: string, message: string) =>
    ({ ok: false, error: { code, sha256: sha, message } }) as const;
  return {
    allowRepair: false,
    async read(asset: EngineAsset) {
      reads.push(asset.sha256);
      const parts = asset.chunks?.length ? asset.chunks : [asset];
      const buffers: Uint8Array[] = [];
      for (const p of parts) {
        const file = pathOf(p, root);
        if (!existsSync(file))
          return fail('cache-miss', asset.sha256, `${p.sha256} is not on disk`);
        const b = new Uint8Array(await readFile(file));
        if (b.length !== p.size || sha256(b) !== p.sha256)
          return fail('corrupt', asset.sha256, `${p.sha256} failed verification`);
        buffers.push(b);
      }
      const whole =
        buffers.length === 1 ? (buffers[0] as Uint8Array) : new Uint8Array(Buffer.concat(buffers));
      if (whole.length !== asset.size || sha256(whole) !== asset.sha256)
        return fail('corrupt', asset.sha256, `${asset.sha256} failed verification`);
      return { ok: true, value: whole } as const;
    },
  };
}
