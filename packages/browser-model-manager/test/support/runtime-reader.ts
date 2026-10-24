// A VerifiedLocalReader over the acquired candidate runtime on disk (scripts/runtime/acquire.mjs; default
// ~/.cache/facemorph-runtime, FACEMORPH_RUNTIME_CACHE to override), asynchronously as in a browser: every read checks each chunk's and the whole
// asset's SHA-256 and size, a missing file is a cache miss and a wrong one is corrupt, and nothing is fetched. Tests
// that need the model report `untested` where the runtime has not been acquired (no weights live in Git).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ManagerError, Result } from '../../src/contracts/errors.ts';
import type { VerifiedLocalReader } from '../../src/contracts/lifecycle.ts';
import type { AssetDescriptor } from '../../src/contracts/manifest.ts';

export const RUNTIME =
  process.env['FACEMORPH_RUNTIME_CACHE'] ?? join(homedir(), '.cache/facemorph-runtime');
export const PINNED_MANIFEST_SHA256 =
  'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
// Reads hash with WebCrypto, off the main thread, as the browser's verified reads do.
const digest = async (b: Uint8Array) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>)).toString('hex');
// A hosted asset sits at its URL's path under /runtime/; an unpublished one names its file.
const pathOf = (at: { url?: string; file?: string }) =>
  at.url ? join(RUNTIME, at.url.split('/runtime/')[1] ?? '') : join(RUNTIME, at.file ?? '');

/** The acquired runtime's manifest when it is the pinned one, else null (the model tests are then untested). */
export function acquiredManifest(): { manifest: Record<string, unknown>; sha256: string } | null {
  const path = join(RUNTIME, 'manifest.json');
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (sha256(bytes) !== PINNED_MANIFEST_SHA256) return null;
  return { manifest: JSON.parse(bytes.toString('utf8')), sha256: PINNED_MANIFEST_SHA256 };
}

export function runtimeReader(reads: string[] = []): VerifiedLocalReader {
  const fail = (code: 'cache-miss' | 'corrupt', sha: string, message: string) =>
    ({ ok: false, error: { code, sha256: sha, message } }) as const;
  return {
    allowRepair: false,
    async read(asset: AssetDescriptor): Promise<Result<Uint8Array, ManagerError>> {
      reads.push(asset.sha256);
      const parts = asset.chunks?.length ? asset.chunks : [asset];
      const buffers: Uint8Array[] = [];
      for (const p of parts) {
        const file = pathOf(p);
        if (!existsSync(file))
          return fail('cache-miss', asset.sha256, `${p.sha256} is not on disk`);
        const b = new Uint8Array(await readFile(file));
        if (b.length !== p.size || (await digest(b)) !== p.sha256)
          return fail('corrupt', asset.sha256, `${p.sha256} failed verification`);
        buffers.push(b);
      }
      const whole =
        buffers.length === 1 ? (buffers[0] as Uint8Array) : new Uint8Array(Buffer.concat(buffers));
      if (whole.length !== asset.size || (await digest(whole)) !== asset.sha256)
        return fail('corrupt', asset.sha256, `${asset.sha256} failed verification`);
      return { ok: true, value: whole };
    },
  };
}
