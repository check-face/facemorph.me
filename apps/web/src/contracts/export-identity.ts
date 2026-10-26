// Export identity (fm-s9n): what makes one exported file "the same file", and the filename derived
// from it. The digest is SHA-256 over the canonical JSON of everything that shapes the bytes; the
// name is a human label plus a short base-27 suffix read from that digest, so Save and Share of one
// prepared file always reuse one name and two different results do not silently share one.
//
// Filenames never authorise adding text or source names to recovery metadata or diagnostics: a label
// typed by a person, a seed or a source basename lives only in the name it produced, and no log,
// support bundle or recovery record may copy it on that account.
//
// There is no cross-device uniqueness claim: the suffix only separates names inside one session's
// known export set, and a different device may produce the same name for different results.

import type { ConfirmedCrop } from 'stylegan-js';

/** Container kinds that can leave the app. WebP and PNG of one result are distinct exports. */
export type ExportKind = 'webp' | 'png' | 'mp4';

export const EXPORT_KINDS: readonly ExportKind[] = ['webp', 'png', 'mp4'];

export const EXPORT_MIME: Readonly<Record<ExportKind, string>> = Object.freeze({
  webp: 'image/webp',
  png: 'image/png',
  mp4: 'video/mp4',
});

/** File extension (no dot) written for each kind; it always matches the actual bytes. */
export const EXPORT_EXTENSION: Readonly<Record<ExportKind, string>> = Object.freeze({
  webp: 'webp',
  png: 'png',
  mp4: 'mp4',
});

/** Plain JSON, so it can be hashed canonically. */
export type ExportJson =
  | string
  | number
  | boolean
  | null
  | readonly ExportJson[]
  | { readonly [key: string]: ExportJson };

export interface ExportMorph {
  /** e.g. `linear`, `figure8`. */
  readonly mode: string;
  readonly settings: ExportJson;
}

/** Everything that decides the exported bytes. The label is not part of it. */
export interface ExportIdentityInput {
  readonly kind: ExportKind;
  /** `confirmedCropId` of each crop, in the order the crops were confirmed. */
  readonly crops: readonly ConfirmedCrop['confirmedCropId'][];
  /** Ordered input identities (crop ids, seeds, uploaded-result ids) as the synthesis consumed them. */
  readonly orderedInputs: readonly string[];
  /** Absent for a still of a single face. */
  readonly morph?: ExportMorph;
  readonly modelIdentity: string;
  /** Container/codec description, e.g. `webp-lossless`. */
  readonly format: string;
  readonly encodingOptions: ExportJson;
}

/** Where a label came from. Only the text is used; the origin is for the caller's own rules. */
export interface ExportLabelSource {
  readonly origin: 'result-name' | 'entered-text' | 'seed' | 'source-basename';
  /** For `seed`, the seed number as text: it becomes `seed-<n>`. */
  readonly text: string;
}

export interface ExportIdentity {
  /** 64 lowercase hex characters: `exportIdentityDigest` of the input. */
  readonly digest: string;
  readonly kind: ExportKind;
  /** Sanitised label, possibly empty; empty means `fallbackLabel` is used. */
  readonly label: string;
  /** `face` or `morph`, used only when `label` is empty. */
  readonly fallbackLabel: 'face' | 'morph';
}

/** An export already named in this session. */
export interface KnownExport {
  readonly digest: string;
  readonly filename: string;
}

export const SUFFIX_ALPHABET = 'bcdfghjkmnpqrstvwxz23456789';
export const SUFFIX_LENGTH = 6;
export const SUFFIX_MAX_LENGTH = 16;
/** Longest basename (label, `-`, suffix) in characters (Unicode code points) before the extension. */
export const FILENAME_MAX_STEM = 64;

/** Thrown when even a SUFFIX_MAX_LENGTH suffix collides: never a silent overwrite, counter or timestamp. */
export class ExportNameCollision extends Error {
  readonly filename: string;
  constructor(filename: string) {
    super(`export name ${filename} collides with a different export even at the longest suffix`);
    this.name = 'ExportNameCollision';
    this.filename = filename;
  }
}

// ---------------------------------------------------------------------------------------------
// Digest

/** Canonical JSON: keys sorted by code unit, no whitespace, numbers as JSON.stringify writes them. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new RangeError('a non-finite number has no JSON form');
    return JSON.stringify(Object.is(value, -0) ? 0 : value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 over the canonical JSON (UTF-8) of the identity fields; `morph` is omitted when absent. */
export function exportIdentityDigest(input: ExportIdentityInput): string {
  return sha256Hex(
    utf8Bytes(
      canonicalJson({
        kind: input.kind,
        crops: input.crops,
        orderedInputs: input.orderedInputs,
        morph: input.morph,
        modelIdentity: input.modelIdentity,
        format: input.format,
        encodingOptions: input.encodingOptions,
      }),
    ),
  );
}

/** Builds the identity; `labelSource` is the best available label, if the caller has one. */
export function exportIdentity(
  input: ExportIdentityInput,
  labelSource?: ExportLabelSource,
): ExportIdentity {
  return {
    digest: exportIdentityDigest(input),
    kind: input.kind,
    label: labelSource === undefined ? '' : labelFromSource(labelSource),
    fallbackLabel: input.morph !== undefined || input.kind === 'mp4' ? 'morph' : 'face',
  };
}

// ---------------------------------------------------------------------------------------------
// Sanitising

export interface SanitizeRule {
  readonly id: string;
  readonly description: string;
  readonly apply: (text: string) => string;
}

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/gu;
// C0 (U+0000-001F, U+007F), C1 (U+0080-009F), line/paragraph separators, byte-order mark.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/gu;
const RESERVED_CHARACTERS = /[<>:"/\\|?*]/gu;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const SOURCE_EXTENSIONS =
  /\.(?:jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?|jfif|mp4|mov|m4v|mkv|webm)$/u;

/** Applied in order; the result is a label (possibly empty), never a path. */
export const SANITIZE_RULES: readonly SanitizeRule[] = Object.freeze([
  { id: 'path-components', description: 'keep only the part after the last / or \\', apply: (t) => t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1) },
  { id: 'lowercase', description: 'lowercase', apply: (t) => t.toLowerCase() },
  { id: 'source-extension', description: 'drop a trailing image/video extension', apply: (t) => t.replace(SOURCE_EXTENSIONS, '') },
  { id: 'bidi-controls', description: 'remove U+202A-202E, U+2066-2069, U+200E/200F, U+061C', apply: (t) => t.replace(BIDI_CONTROLS, '') },
  { id: 'controls', description: 'remove C0/C1 controls, U+2028/2029 and U+FEFF', apply: (t) => t.replace(CONTROLS, '') },
  { id: 'reserved-characters', description: 'replace <>:"/\\|?* and dots with -', apply: (t) => t.replace(RESERVED_CHARACTERS, '-').replace(/\./gu, '-') },
  { id: 'separators', description: 'spaces and underscores become -', apply: (t) => t.replace(/[\s_]+/gu, '-') },
  { id: 'collapse-hyphens', description: 'collapse repeated - and trim - from both ends', apply: (t) => t.replace(/-{2,}/gu, '-').replace(/^-+|-+$/gu, '') },
  { id: 'reserved-names', description: 'a Windows reserved device name is no label', apply: (t) => (WINDOWS_RESERVED.test(t) ? '' : t) },
]);

/** Runs every rule over free text. Empty means the text carried no usable label. */
export function sanitizeLabel(text: string): string {
  return SANITIZE_RULES.reduce((acc, rule) => rule.apply(acc), text);
}

export function labelFromSource(source: ExportLabelSource): string {
  return sanitizeLabel(source.origin === 'seed' ? `seed-${source.text}` : source.text);
}

/**
 * The identity after a person edits the name. The edited text keeps the identity's `-<suffix>`: a
 * trailing run of suffix symbols that is a prefix of this digest's suffix is removed first, then the
 * suffix is appended again by `suggestFilename`.
 */
export function withEditedName(identity: ExportIdentity, editedName: string): ExportIdentity {
  let label = sanitizeLabel(stripExportExtension(editedName));
  const full = suffixOf(identity.digest, SUFFIX_MAX_LENGTH);
  for (let n = SUFFIX_MAX_LENGTH; n >= SUFFIX_LENGTH; n--) {
    const tail = `-${full.slice(0, n)}`;
    if (label.endsWith(tail)) {
      label = label.slice(0, label.length - tail.length).replace(/-+$/u, '');
      break;
    }
  }
  return { ...identity, label };
}

function stripExportExtension(text: string): string {
  return text.replace(/\.(?:webp|png|mp4)$/iu, '');
}

// ---------------------------------------------------------------------------------------------
// Suffix and names

/**
 * The first `length` symbols of the digest read as a big-endian fraction N / 2^256 in base 27, most
 * significant symbol first. Extending the length therefore only appends symbols.
 */
export function suffixOf(digest: string, length: number): string {
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new RangeError('digest must be 64 lowercase hex characters');
  let rest = BigInt(`0x${digest}`);
  const mask = (1n << 256n) - 1n;
  let out = '';
  for (let i = 0; i < length; i++) {
    rest *= 27n;
    out += SUFFIX_ALPHABET[Number(rest >> 256n)]!;
    rest &= mask;
  }
  return out;
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const codePoints = (text: string): number => Array.from(text).length;

/** Cuts at a grapheme boundary so that at most `maxCodePoints` remain. */
export function truncateAtGrapheme(text: string, maxCodePoints: number): string {
  let out = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = codePoints(segment);
    if (used + size > maxCodePoints) break;
    out += segment;
    used += size;
  }
  return out;
}

export interface ExportName {
  readonly filename: string;
  readonly stem: string;
  readonly suffix: string;
  readonly extension: string;
  readonly mime: string;
}

/** Stem for one suffix length: label (cut to fit), `-`, whole suffix. */
export function exportStem(label: string, fallback: string, suffix: string): string {
  const budget = FILENAME_MAX_STEM - 1 - suffix.length;
  const cut = truncateAtGrapheme(label === '' ? fallback : label, budget).replace(/-+$/u, '');
  return `${cut === '' ? fallback : cut}-${suffix}`;
}

/**
 * Names the identity inside `known`. The same digest already named there reuses that name. Otherwise
 * the six-symbol suffix is extended one symbol at a time while the name equals a different export's,
 * up to SUFFIX_MAX_LENGTH, then ExportNameCollision.
 */
export function suggestFilename(identity: ExportIdentity, known: readonly KnownExport[]): ExportName {
  const extension = EXPORT_EXTENSION[identity.kind];
  const mime = EXPORT_MIME[identity.kind];
  const same = known.find((k) => k.digest === identity.digest);
  if (same !== undefined) {
    const stem = same.filename.slice(0, same.filename.length - extension.length - 1);
    return { filename: same.filename, stem, suffix: stem.slice(stem.lastIndexOf('-') + 1), extension, mime };
  }
  const taken = new Set(known.map((k) => k.filename.toLowerCase()));
  let last = '';
  for (let length = SUFFIX_LENGTH; length <= SUFFIX_MAX_LENGTH; length++) {
    const suffix = suffixOf(identity.digest, length);
    const stem = exportStem(identity.label, identity.fallbackLabel, suffix);
    last = `${stem}.${extension}`;
    if (!taken.has(last.toLowerCase())) return { filename: last, stem, suffix, extension, mime };
  }
  throw new ExportNameCollision(last);
}

// ---------------------------------------------------------------------------------------------
// Writing

export type NoClobberMode =
  | 'browser-download'
  | 'file-picker-no-clobber'
  | 'file-picker-confirm-overwrite';

export type WriteDecision =
  | 'download'
  | 'write'
  | 'extend-name'
  | 'ask-overwrite'
  | 'overwrite';

/**
 * What to do with a name at write time. Ordinary downloads leave duplicates to the browser;
 * file-picker writes never replace silently: no-clobber asks for a longer name, the other mode
 * asks the person and overwrites only once they confirmed.
 */
export function decideWrite(
  mode: NoClobberMode,
  nameExists: boolean,
  overwriteConfirmed: boolean,
): WriteDecision {
  if (mode === 'browser-download') return 'download';
  if (!nameExists) return 'write';
  if (mode === 'file-picker-no-clobber') return 'extend-name';
  return overwriteConfirmed ? 'overwrite' : 'ask-overwrite';
}

// ---------------------------------------------------------------------------------------------
// SHA-256, copied from packages/stylegan-js/src/contracts/sha256.ts (not exported by that package),
// so that this module needs no platform globals and hashes identically in a page, a worker and Node.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Lowercase hex SHA-256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]!;
      const b = w[t - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let t = 0; t < 64; t++) {
      const t1 =
        (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) >>>
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** UTF-8 bytes of `text`. Hand-rolled because TextEncoder is a platform global outside ES2024. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return Uint8Array.from(out);
}
