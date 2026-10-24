// Canonical JSON for contract identities: object keys sorted by UTF-16 code unit, no whitespace,
// numbers as JSON.stringify writes them (integers exactly as written), UTF-8 encoded for hashing.
// Only plain JSON values are canonical; anything else is rejected rather than coerced.

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalJsonError extends Error {
  readonly code: 'non-finite-number' | 'unsupported-value' | 'lone-surrogate';
  constructor(code: CanonicalJsonError['code'], message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
    this.code = code;
  }
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('non-finite-number', `${value} has no JSON form`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) throw new CanonicalJsonError('lone-surrogate', 'a string has no UTF-8 form');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${canonicalJson(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new CanonicalJsonError('unsupported-value', `${typeof value} is not a plain JSON value`);
}
