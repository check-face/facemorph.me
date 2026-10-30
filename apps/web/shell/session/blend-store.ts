// The blend view's weights by face id (fm-2kse, fm-56e6), kept with the tab's session: a reload in the same tab
// restores them, a new tab starts without. The faces themselves are the morph session's (one shared list). Like the
// typed words (session-words.ts) they live only in sessionStorage; storage that is absent or throws keeps nothing.
// A version-1 record of separate blend slots migrates to the shared list (restoreWeights).
import {
  restoreWeights,
  storedWeights,
  type BlendState,
  type BlendWeights,
} from '../../src/controller/blend.ts';

export const BLEND_KEY = 'facemorph-blend-v1';

function storage(scope: { readonly sessionStorage?: Storage } = globalThis): Storage | null {
  try {
    return scope.sessionStorage ?? null;
  } catch {
    return null;
  }
}
export function rememberBlend(
  blend: BlendState | undefined,
  scope?: { readonly sessionStorage?: Storage },
): void {
  const s = storage(scope);
  if (!s || !blend) return;
  try {
    s.setItem(BLEND_KEY, JSON.stringify(storedWeights(blend)));
  } catch {
    /* full or blocked: nothing kept */
  }
}
export function restoreBlend(scope?: { readonly sessionStorage?: Storage }): BlendWeights {
  const s = storage(scope);
  if (!s) return {};
  try {
    const text = s.getItem(BLEND_KEY);
    return text ? restoreWeights(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}
