// The project schema (fm-7s3a), ported from classic src/Next/Contracts.fs (types, validate) and
// src/Next/ProjectJson.fs (limits, bounded JSON reader, bounds) with identical semantics: an untrusted dropped
// file is read by this bounded reader, never by JSON.parse, and admitted only if every field is present, known,
// typed and within its limits. Messages are classic's, in classic's order.

export const MAX_INPUT_CHARS = 16777216;
// Classic's limit, kept as-is for exact goldens; face.many (fm-id4c) replaces it later.
export const MAX_CONTROLS = 64;
export const MAX_LATENT_VALUES = 65536;

export const LATENT_SPACES = ['z', 'w', 'w-plus'] as const;
export type LatentSpace = (typeof LATENT_SPACES)[number];
export const PATH_KINDS = [
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
] as const;
export type PathKind = (typeof PATH_KINDS)[number];

export interface Bundle {
  readonly version: string;
  readonly manifestSha256: string;
}
export interface Latent {
  readonly space: LatentSpace;
  readonly shape: readonly number[];
  readonly values: readonly number[];
}
/** Visit IDs are unique; distinct visits may intentionally contain identical latents. */
export interface Control {
  readonly visitId: string;
  readonly latent: Latent;
}
export interface Morph {
  readonly algorithmVersion: string;
  readonly kind: PathKind;
  readonly controls: readonly Control[];
  readonly closed: boolean;
  readonly width: number;
  readonly pinchCenter: boolean;
  readonly framesPerSegment: number;
  readonly framesPerSecond: number;
}
export interface Project {
  readonly schemaVersion: number;
  readonly bundle: Bundle;
  readonly modelSha256: string;
  readonly noiseSha256: string;
  readonly truncationPsi: number;
  readonly truncationCutoff: number;
  readonly morph: Morph;
}

/** A value read by the bounded reader. */
export type Json =
  | { readonly type: 'object'; readonly fields: ReadonlyMap<string, Json> }
  | { readonly type: 'array'; readonly items: readonly Json[] }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'null' };

/** Thrown by the reader and the field accessors; decode turns it into its one malformed-input message. */
export class SchemaError extends Error {
  override readonly name = 'SchemaError';
}
const invalid = (message: string): never => {
  throw new SchemaError(message);
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Classic's bounded reader: 16 MiB input, depth 16, 1,000,000 values, 65,536 array items, 32 object
 * fields, 4,096-character strings, 128-character finite numbers, no duplicate fields, no trailing content. */
export function parseBounded(input: string): Json {
  if (typeof input !== 'string' || input.length > MAX_INPUT_CHARS)
    invalid('Project exceeds the input size limit.');
  let offset = 0;
  let nodes = 0;
  const peek = (): string => (offset < input.length ? (input[offset] ?? '\0') : '\0');
  const consume = (expected: string): void => {
    if (peek() !== expected) invalid('Malformed JSON.');
    offset++;
  };
  const whitespace = (): void => {
    while (
      offset < input.length &&
      (peek() === ' ' || peek() === '\n' || peek() === '\r' || peek() === '\t')
    )
      offset++;
  };
  const hex = (c: string): number => {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 97 + 10;
    if (c >= 'A' && c <= 'F') return c.charCodeAt(0) - 65 + 10;
    return invalid('Invalid JSON Unicode escape.');
  };
  const stringValue = (): string => {
    consume('"');
    let value = '';
    while (peek() !== '"') {
      if (offset >= input.length) invalid('Unterminated JSON string.');
      const c = peek();
      offset++;
      if (c === '\\') {
        const escaped = peek();
        offset++;
        switch (escaped) {
          case '"':
          case '\\':
          case '/':
            value += escaped;
            break;
          case 'b':
            value += '\b';
            break;
          case 'f':
            value += '\f';
            break;
          case 'n':
            value += '\n';
            break;
          case 'r':
            value += '\r';
            break;
          case 't':
            value += '\t';
            break;
          case 'u': {
            if (offset + 4 > input.length) invalid('Truncated JSON Unicode escape.');
            let code = 0;
            for (let i = 0; i < 4; i++) code = code * 16 + hex(input[offset + i] ?? '\0');
            offset += 4;
            value += String.fromCharCode(code);
            break;
          }
          default:
            invalid('Invalid JSON escape.');
        }
      } else if (c.charCodeAt(0) < 32) invalid('Unescaped control character.');
      else value += c;
      if (value.length > 4096) invalid('JSON string exceeds the limit.');
    }
    consume('"');
    return value;
  };
  const numberValue = (): Json => {
    const start = offset;
    if (peek() === '-') offset++;
    if (peek() === '0') offset++;
    else {
      if (!isDigit(peek())) invalid('Invalid JSON number.');
      while (isDigit(peek())) offset++;
    }
    if (peek() === '.') {
      offset++;
      if (!isDigit(peek())) invalid('Invalid JSON fraction.');
      while (isDigit(peek())) offset++;
    }
    if (peek() === 'e' || peek() === 'E') {
      offset++;
      if (peek() === '+' || peek() === '-') offset++;
      if (!isDigit(peek())) invalid('Invalid JSON exponent.');
      while (isDigit(peek())) offset++;
    }
    if (offset - start > 128) invalid('JSON number exceeds the limit.');
    const value = Number(input.slice(start, offset));
    if (!Number.isFinite(value)) invalid('JSON number must be finite.');
    return { type: 'number', value };
  };
  const literal = (word: string, value: Json): Json => {
    for (const c of word) consume(c);
    return value;
  };
  const read = (depth: number): Json => {
    if (depth > 16) invalid('Project exceeds the nesting limit.');
    nodes++;
    if (nodes > 1000000) invalid('Project exceeds the value count limit.');
    whitespace();
    const c = peek();
    switch (c) {
      case '"':
        return { type: 'text', value: stringValue() };
      case '[': {
        consume('[');
        whitespace();
        const items: Json[] = [];
        if (peek() !== ']') {
          items.push(read(depth + 1));
          whitespace();
          while (peek() === ',') {
            consume(',');
            if (items.length >= MAX_LATENT_VALUES) invalid('JSON array exceeds the limit.');
            items.push(read(depth + 1));
            whitespace();
          }
        }
        consume(']');
        return { type: 'array', items };
      }
      case '{': {
        consume('{');
        whitespace();
        const fields = new Map<string, Json>();
        const field = (): void => {
          whitespace();
          const key = stringValue();
          if (fields.has(key)) invalid('Duplicate JSON field.');
          whitespace();
          consume(':');
          fields.set(key, read(depth + 1));
          if (fields.size > 32) invalid('JSON object exceeds the field limit.');
          whitespace();
        };
        if (peek() !== '}') {
          field();
          while (peek() === ',') {
            consume(',');
            field();
          }
        }
        consume('}');
        return { type: 'object', fields };
      }
      case 't':
        return literal('true', { type: 'boolean', value: true });
      case 'f':
        return literal('false', { type: 'boolean', value: false });
      case 'n':
        return literal('null', { type: 'null' });
      default:
        if (c === '-' || isDigit(c)) return numberValue();
        return invalid('Malformed JSON value.');
    }
  };
  const result = read(0);
  whitespace();
  if (offset !== input.length) invalid('Trailing JSON content.');
  return result;
}

/** Exactly these fields, no more and no fewer. */
export function fieldsOf(expected: readonly string[], json: Json): ReadonlyMap<string, Json> {
  if (
    json.type === 'object' &&
    json.fields.size === new Set(expected).size &&
    expected.every((k) => json.fields.has(k))
  )
    return json.fields;
  return invalid('Missing or unknown project fields.');
}
export const field = (fields: ReadonlyMap<string, Json>, key: string): Json =>
  fields.get(key) ?? invalid('Missing or unknown project fields.');
export const text = (json: Json): string =>
  json.type === 'text' ? json.value : invalid('Expected string.');
export const number = (json: Json): number =>
  json.type === 'number' ? json.value : invalid('Expected number.');
export function integer(json: Json): number {
  const n = number(json);
  if (n < 0 || n > 2147483647 || Math.floor(n) !== n) invalid('Expected nonnegative integer.');
  return n | 0;
}
export const boolean = (json: Json): boolean =>
  json.type === 'boolean' ? json.value : invalid('Expected boolean.');
export const array = (json: Json): readonly Json[] =>
  json.type === 'array' ? json.items : invalid('Expected array.');
export const space = (name: string): LatentSpace =>
  (LATENT_SPACES as readonly string[]).includes(name)
    ? (name as LatentSpace)
    : invalid('Unknown latent space.');
export const kind = (name: string): PathKind =>
  (PATH_KINDS as readonly string[]).includes(name)
    ? (name as PathKind)
    : invalid('Unknown morph kind.');

const sha256 = (s: string): boolean => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
// String.IsNullOrWhiteSpace, as Fable compiles it.
const nonblank = (s: string): boolean => typeof s === 'string' && !/^\s*$/.test(s);
const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Structural admission only (Contracts.validate). Model shape support and algorithm qualification are adapter
 * gates. */
export function validate(project: Project): string[] {
  const morph = project.morph;
  const controls = morph.controls;
  const errors: string[] = [];
  if (project.schemaVersion !== 1) errors.push('Unsupported project schema.');
  if (!(nonblank(project.bundle.version) && sha256(project.bundle.manifestSha256)))
    errors.push('A versioned, checksummed runtime bundle is required.');
  if (!(sha256(project.modelSha256) && sha256(project.noiseSha256)))
    errors.push('Exact model and noise assets are required.');
  if (
    !Number.isFinite(project.truncationPsi) ||
    project.truncationPsi < 0 ||
    project.truncationCutoff < 0
  )
    errors.push('Invalid truncation settings.');
  if (!nonblank(morph.algorithmVersion)) errors.push('An algorithm version is required.');
  if (controls.length < 2) errors.push('At least two ordered controls are required.');
  if (controls.some((c) => !nonblank(c.visitId))) errors.push('Visit IDs must be nonempty.');
  if (new Set(controls.map((c) => c.visitId)).size !== controls.length)
    errors.push('Visit IDs must be unique; repeated latents can use distinct IDs.');
  if (!Number.isFinite(morph.width) || morph.width < 0)
    errors.push('Width must be finite and nonnegative.');
  if (morph.framesPerSegment < 2 || morph.framesPerSegment % 2 !== 0)
    errors.push('Use a positive even frame count per segment to include exact midpoint samples.');
  if (morph.framesPerSecond < 1 || morph.framesPerSecond > 240)
    errors.push('Frame rate must be 1–240.');
  if (!morph.closed && (morph.kind === 'full-smooth-ellipse' || morph.kind === 'full-smooth-figure8'))
    errors.push('Full-smooth open endpoints are not qualified; use a closed path.');
  if (
    controls.some(
      (c) =>
        c.latent.shape.length === 0 ||
        c.latent.shape.some((n) => n <= 0) ||
        c.latent.shape.reduce((n, d) => n * d, 1) !== c.latent.values.length ||
        c.latent.values.some((v) => !Number.isFinite(v)),
    )
  )
    errors.push('Control latents must have finite values matching positive dimensions.');
  const [first, ...rest] = controls;
  if (first && rest.some((c) => !sameNumbers(c.latent.shape, first.latent.shape)))
    errors.push('All control latent shapes must match.');
  if (first && rest.some((c) => c.latent.space !== first.latent.space))
    errors.push('All control latent spaces must match; implicit conversion is forbidden.');
  const pairs: [Control, Control][] = [];
  for (let i = 0; i + 1 < controls.length; i++) {
    const a = controls[i];
    const b = controls[i + 1];
    if (a && b) pairs.push([a, b]);
  }
  const last = controls[controls.length - 1];
  if (morph.closed && controls.length > 1 && first && last) pairs.push([last, first]);
  if (pairs.some(([a, b]) => sameNumbers(a.latent.values, b.latent.values)))
    errors.push('Adjacent identical faces create a degenerate direction; remove that visit.');
  return errors;
}

/** ProjectJson's size bounds, checked after validate on both decode and encode. */
export function bounds(project: Project): string[] {
  const controls = project.morph.controls;
  const errors: string[] = [];
  if (controls.length > MAX_CONTROLS) errors.push('Project exceeds 64 controls.');
  if (controls.reduce((n, c) => n + c.latent.values.length, 0) > 900000)
    errors.push('Project exceeds the total latent value limit.');
  if (
    controls.some(
      (c) => c.latent.values.length > MAX_LATENT_VALUES || c.latent.shape.length > 8,
    )
  )
    errors.push('Latent exceeds dimension/value limits.');
  if (project.morph.framesPerSegment > 100000) errors.push('Frame schedule exceeds the limit.');
  const strings = [
    project.bundle.version,
    project.morph.algorithmVersion,
    ...controls.map((c) => c.visitId),
  ];
  if (strings.some((s) => s != null && s.length > 4096)) errors.push('String exceeds the limit.');
  return errors;
}
