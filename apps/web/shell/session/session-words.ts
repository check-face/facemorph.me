// Tab-scoped words (fm-udut, defect 9): the typed text or seed, or a sanitized photo file name, kept only in this
// tab's sessionStorage, keyed by the retained session record and face ID, so a reload in the same tab restores the
// words and a new tab does not. Never written to the IndexedDB session record (last-generated-session-v2 in
// checkface-originals-v1), exported metadata or diagnostics. Storage that is absent or throws falls back to the
// "Restored face" label; a restore that arrives after the person edited the face is abandoned.

export const WORDS_PREFIX = 'facemorph-words-v1:';
export const RESTORED_FACE_LABEL = 'Restored face';

export type FaceWords =
  | { readonly mode: 'text'; readonly value: string }
  | { readonly mode: 'seed'; readonly value: string }
  | { readonly mode: 'photo'; readonly value: string };

/** A photo file name with no directory, control or bidi characters, at most 128 characters. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Control (C0, DEL) and bidi-override characters are dropped by code point.
  const drop = (c: number) =>
    c < 0x20 ||
    c === 0x7f ||
    c === 0x200e ||
    c === 0x200f ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069);
  return [...base]
    .filter((ch) => !drop(ch.codePointAt(0) ?? 0))
    .join('')
    .trim()
    .slice(0, 128);
}

function storage(scope: { readonly sessionStorage?: Storage } = globalThis): Storage | null {
  try {
    const s = scope.sessionStorage;
    if (!s) return null;
    const probe = `${WORDS_PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const keyOf = (sessionKey: string, faceId: string) => `${WORDS_PREFIX}${sessionKey}:${faceId}`;

/** Keeps a face's words for this tab. Returns false when this tab has no usable sessionStorage. */
export function rememberWords(
  sessionKey: string,
  faceId: string,
  words: FaceWords,
  scope?: { readonly sessionStorage?: Storage },
): boolean {
  const s = storage(scope);
  if (!s) return false;
  const value = words.mode === 'photo' ? sanitizeFileName(words.value) : words.value;
  try {
    s.setItem(keyOf(sessionKey, faceId), JSON.stringify({ mode: words.mode, value }));
    return true;
  } catch {
    return false;
  }
}

export interface WordsRestore {
  readonly words: FaceWords | null;
  /** What the face is labelled: its words, or the fallback when there are none. */
  readonly label: string;
  readonly reason: 'restored' | 'none' | 'storage-unavailable' | 'edited';
}

/**
 * The words for a restored face. `unedited()` is asked last, when the restore lands: if the person has already
 * changed the face, the late restore is abandoned and their edit stands.
 */
export function restoreWords(
  sessionKey: string,
  faceId: string,
  unedited: () => boolean,
  scope?: { readonly sessionStorage?: Storage },
): WordsRestore {
  const s = storage(scope);
  if (!s) return { words: null, label: RESTORED_FACE_LABEL, reason: 'storage-unavailable' };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(s.getItem(keyOf(sessionKey, faceId)) ?? 'null');
  } catch {
    parsed = null;
  }
  const ok =
    typeof parsed === 'object' &&
    parsed !== null &&
    ['text', 'seed', 'photo'].includes((parsed as { mode?: unknown }).mode as string) &&
    typeof (parsed as { value?: unknown }).value === 'string';
  if (!ok) return { words: null, label: RESTORED_FACE_LABEL, reason: 'none' };
  if (!unedited()) return { words: null, label: RESTORED_FACE_LABEL, reason: 'edited' };
  const words = parsed as FaceWords;
  return { words, label: words.value || RESTORED_FACE_LABEL, reason: 'restored' };
}

/** Removes this tab's words (Clear). Returns how many entries went. */
export function clearWords(scope?: { readonly sessionStorage?: Storage }): number {
  const s = storage(scope);
  if (!s) return 0;
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(WORDS_PREFIX)) keys.push(k);
  }
  for (const k of keys) s.removeItem(k);
  return keys.length;
}

/** Bytes this tab's words occupy (UTF-16, as sessionStorage counts them). */
export function wordsBytes(scope?: { readonly sessionStorage?: Storage }): number {
  const s = storage(scope);
  if (!s) return 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(WORDS_PREFIX)) n += (k.length + (s.getItem(k)?.length ?? 0)) * 2;
  }
  return n;
}
