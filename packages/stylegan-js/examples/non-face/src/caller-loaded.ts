// Caller-loaded non-face variant: no model manager. The caller's own reader fetches each asset from the URL the
// manifest gives it and checks every chunk and the whole asset for size and SHA-256 on every read; the engine reads
// nothing else. This module imports nothing from @facemorph/browser-model-manager.
import type { LocalAssetReader } from '@facemorph/stylegan-js/engine';
import {
  createNonFaceExample,
  sha256,
  type ExampleOptions,
  type LocatedAsset,
  type Manifests,
} from './nonface.js';

/** A verifying reader over the manifests' URLs: 'cache-miss' for a missing file, 'corrupt' for a wrong one. */
export function createVerifyingReader(
  manifests: Manifests,
  signal: AbortSignal | undefined,
): LocalAssetReader {
  const urls = new Map<string, LocatedAsset>();
  for (const a of [
    ...manifests.runtime.assets,
    manifests.model.mapping,
    manifests.model.synthesis,
    manifests.model.average,
    ...manifests.model.noise,
  ])
    urls.set(a.sha256, a);
  const fail = (code: string, sha: string, message: string) =>
    ({ ok: false, error: { code, sha256: sha, message } }) as const;
  return {
    allowRepair: false,
    async read(asset) {
      const located = urls.get(asset.sha256);
      if (!located) return fail('cache-miss', asset.sha256, `${asset.sha256} is not in a manifest`);
      const parts = located.chunks?.length ? located.chunks : [located];
      const buffers: Uint8Array[] = [];
      for (const part of parts) {
        if (signal?.aborted) return fail('aborted', asset.sha256, 'The read was aborted.');
        let bytes: Uint8Array;
        try {
          const res = await fetch(part.url, signal ? { signal } : {});
          if (!res.ok) return fail('cache-miss', asset.sha256, `${part.url}: HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch (error) {
          return fail(signal?.aborted ? 'aborted' : 'cache-miss', asset.sha256, String(error));
        }
        if (bytes.length !== part.size || (await sha256(bytes)) !== part.sha256)
          return fail('corrupt', asset.sha256, `${part.url} failed verification`);
        buffers.push(bytes);
      }
      const whole = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0));
      let at = 0;
      for (const b of buffers) whole.set(b, (at += b.length) - b.length);
      if (whole.length !== asset.size || (await sha256(whole)) !== asset.sha256)
        return fail('corrupt', asset.sha256, `${asset.sha256} failed verification`);
      return { ok: true, value: whole } as const;
    },
  };
}

export function createCallerLoadedExample(options: ExampleOptions) {
  return createNonFaceExample('caller-loaded', options, async (manifests, signal) =>
    createVerifyingReader(manifests, signal),
  );
}
