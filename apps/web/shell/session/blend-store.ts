// The blend view's slot list and weights (fm-2kse), kept with the tab's session: a reload in the same tab restores
// them, a new tab starts without. Like the typed words (session-words.ts) they live only in sessionStorage; a photo
// slot keeps its place, weight and file name, and its pixels stay in this tab's memory only. Storage that is absent
// or throws simply keeps nothing.
import {
  restoreSlots,
  storedSlots,
  type BlendSlot,
  type BlendState,
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
    s.setItem(BLEND_KEY, JSON.stringify(storedSlots(blend)));
  } catch {
    /* full or blocked: nothing kept */
  }
}
export function restoreBlend(scope?: { readonly sessionStorage?: Storage }): readonly BlendSlot[] {
  const s = storage(scope);
  if (!s) return [];
  try {
    const text = s.getItem(BLEND_KEY);
    return text ? restoreSlots(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}
