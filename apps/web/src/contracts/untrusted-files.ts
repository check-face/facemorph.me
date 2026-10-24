// Untrusted project and session files (fm-2o8q): one byte-size sanity bound per kind, checked before the
// file is read and again before it is parsed. It replaces classic's `MaxControls = 64` project check and
// the 64-face session-restore check: there is no face count, only the bytes. Every rejection is typed;
// field validation of the parsed object belongs to the project and session readers.

import { checkCeiling, lookupCeiling, type CeilingName } from './ceilings.ts';

export type UntrustedFileKind = 'project-file' | 'session-record';

export const UNTRUSTED_FILE_CEILING: { readonly [K in UntrustedFileKind]: CeilingName } = Object.freeze({
  'project-file': 'PROJECT_FILE_PARSE_BYTES',
  'session-record': 'SESSION_FILE_PARSE_BYTES',
});

export type UntrustedFileError =
  /** `bytes` is the size found: exact for a file size; for text, at least its UTF-16 length. */
  | { readonly code: 'too-large'; readonly kind: UntrustedFileKind; readonly bytes: number; readonly limit: number }
  | { readonly code: 'invalid-size'; readonly kind: UntrustedFileKind }
  | { readonly code: 'not-json'; readonly kind: UntrustedFileKind }
  | { readonly code: 'not-an-object'; readonly kind: UntrustedFileKind };

export type UntrustedFileResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: UntrustedFileError };

const limitOf = (kind: UntrustedFileKind): number => {
  const found = lookupCeiling(UNTRUSTED_FILE_CEILING[kind], { kind: 'all-routes' });
  if (!found.admitted) throw new Error(`no ceiling for ${kind}`);
  return found.ceiling.value;
};
const UNTRUSTED_FILE_LIMIT: { readonly [K in UntrustedFileKind]: number } = Object.freeze({
  'project-file': limitOf('project-file'),
  'session-record': limitOf('session-record'),
});

/** Checks a file's size (e.g. `Blob.size`) before any byte of it is read. */
export function admitUntrustedFileSize(kind: UntrustedFileKind, bytes: number): UntrustedFileResult<number> {
  const check = checkCeiling(UNTRUSTED_FILE_CEILING[kind], { kind: 'all-routes' }, bytes);
  if (check.ok) return { ok: true, value: bytes };
  if (check.reason === 'over-ceiling') return { ok: false, error: { code: 'too-large', kind, bytes, limit: check.limit } };
  return { ok: false, error: { code: 'invalid-size', kind } };
}

/** UTF-8 length of a string, without allocating its bytes (a lone surrogate counts as U+FFFD, 3 bytes). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Parses the text of an untrusted project or session file into a plain object, after checking its UTF-8
 * size against the same bound. Malformed or too-deep JSON is `not-json`; a top-level array or scalar is
 * `not-an-object`.
 */
export function parseUntrustedJson(kind: UntrustedFileKind, text: string): UntrustedFileResult<Readonly<Record<string, unknown>>> {
  // UTF-8 takes at least one and at most three bytes per UTF-16 unit, so only a text between limit/3 and
  // the limit needs counting.
  const limit = UNTRUSTED_FILE_LIMIT[kind];
  const bytes = text.length > limit ? text.length : text.length * 3 <= limit ? text.length : utf8Length(text);
  const size = admitUntrustedFileSize(kind, bytes);
  if (!size.ok) return size;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // SyntaxError, or RangeError from nesting deeper than the engine's stack.
    return { ok: false, error: { code: 'not-json', kind } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: { code: 'not-an-object', kind } };
  return { ok: true, value: value as Readonly<Record<string, unknown>> };
}
