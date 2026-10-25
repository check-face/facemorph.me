// Face inputs: what a tile is generated from. Typing or changing a source makes a new revision, which
// invalidates any prepared file or morph built from the old one immediately.

/** Seeds are unsigned 32-bit integers (browser/identity.mjs). */
export const SEED_RANGE = Object.freeze({ min: 0, max: 4294967295 });
/** Longest accepted words input, in UTF-8 bytes (browser/identity.mjs). */
export const WORDS_MAX_UTF8_BYTES = 512;

export type InputMode = 'words' | 'seed' | 'selected-name' | 'photo' | 'restored-still';

/** Monotonic per tile; every edit or source change increments it. */
export type InputRevision = number & { readonly __inputRevision: true };

export type WordsValidation =
  | { readonly valid: true; readonly words: string }
  | { readonly valid: false; readonly reason: 'empty' | 'whitespace-only' | 'too-long' };

/** Exact string semantics: the words are used as typed, never trimmed or case-folded. */
export function validateWords(text: string): WordsValidation {
  if (text.length === 0) return { valid: false, reason: 'empty' };
  if (text.trim().length === 0) return { valid: false, reason: 'whitespace-only' };
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes > WORDS_MAX_UTF8_BYTES ? { valid: false, reason: 'too-long' } : { valid: true, words: text };
}

export function validSeed(value: number): boolean {
  return Number.isSafeInteger(value) && value >= SEED_RANGE.min && value <= SEED_RANGE.max;
}

/** Validate the literal field value before converting it; never repair a different seed. */
export function validateSeedText(value: string): boolean {
  return /^[0-9]+$/.test(value) && validSeed(Number(value));
}

export type FaceInput =
  | { readonly mode: 'words'; readonly revision: InputRevision; readonly words: string }
  | { readonly mode: 'seed'; readonly revision: InputRevision; readonly seed: number }
  | { readonly mode: 'selected-name'; readonly revision: InputRevision; readonly name: string }
  | { readonly mode: 'photo'; readonly revision: InputRevision; readonly confirmedCropId: string }
  | { readonly mode: 'restored-still'; readonly revision: InputRevision; readonly imageSha256: string };

export function nextRevision(r: InputRevision): InputRevision {
  return (r + 1) as InputRevision;
}
