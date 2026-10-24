// Vector files validate against their types (fm-2o8q): downstream tests read ceilings.vectors.json and
// export-identity.vectors.json as `unknown`, so each has a runtime validator that returns the typed value
// or a typed rejection naming the first bad path. No casts of unchecked JSON outside this module.

import {
  CEILINGS,
  DECODE_LANES,
  DECODE_ROUTES,
  scopeKey,
  type CeilingName,
  type CeilingScope,
  type CeilingUnit,
  type OverCeilingAction,
} from './ceilings.ts';
import {
  EXPORT_KINDS,
  type ExportIdentityInput,
  type ExportJson,
  type ExportKind,
  type ExportLabelSource,
} from './export-identity.ts';

export interface VectorFileError {
  readonly code: 'invalid-vector-file';
  readonly path: string;
  readonly expected: string;
}

export type VectorFileResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: VectorFileError };

class Invalid extends Error {
  readonly path: string;
  readonly expected: string;
  constructor(path: string, expected: string) {
    super(`${path}: ${expected}`);
    this.path = path;
    this.expected = expected;
  }
}

type Json = Readonly<Record<string, unknown>>;
const obj = (v: unknown, path: string): Json => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Invalid(path, 'an object');
  return v as Json;
};
const arr = (v: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(v)) throw new Invalid(path, 'an array');
  return v;
};
const str = (v: unknown, path: string): string => {
  if (typeof v !== 'string') throw new Invalid(path, 'a string');
  return v;
};
const hex64 = (v: unknown, path: string): string => {
  const s = str(v, path);
  if (!/^[0-9a-f]{64}$/u.test(s)) throw new Invalid(path, '64 lowercase hex characters');
  return s;
};
const count = (v: unknown, path: string): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Invalid(path, 'a non-negative integer');
  return v as number;
};
const oneOf = <T extends string>(v: unknown, options: readonly T[], path: string): T => {
  if (!(options as readonly unknown[]).includes(v)) throw new Invalid(path, `one of ${options.join(', ')}`);
  return v as T;
};
const exact = (v: unknown, value: unknown, path: string): void => {
  if (v !== value) throw new Invalid(path, JSON.stringify(value));
};

function run<T>(read: () => T): VectorFileResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: { code: 'invalid-vector-file', path: error.path, expected: error.expected } };
    throw error;
  }
}

// ---- ceilings.vectors.json

export interface CeilingVector {
  readonly name: CeilingName;
  readonly scope: CeilingScope;
  readonly unit: CeilingUnit;
  readonly value: number;
  readonly atBoundary: { readonly requested: number; readonly ok: true; readonly remaining: 0 };
  readonly oneOver: { readonly requested: number; readonly ok: false; readonly action: OverCeilingAction };
}

/** A request that has no ceiling, so it is refused as not measured. `scope` is a scope key (`scopeKey`). */
export interface NotAdmittedVector {
  readonly name: CeilingName;
  readonly scope: string;
}

export interface CeilingVectors {
  readonly contract: string;
  readonly classicCommit: string;
  readonly ceilings: readonly CeilingVector[];
  readonly notAdmitted: readonly NotAdmittedVector[];
}

const NAMES: readonly CeilingName[] = [...new Set(CEILINGS.map((c) => c.name))];
const UNITS: readonly CeilingUnit[] = ['bytes', 'frames', 'sessions', 'ms'];
const ACTIONS: readonly OverCeilingAction[] = ['choose-smaller-photo', 'reduce-selection', 'remove-retry-input', 'shorten-morph', 'refuse-file', 'not-retained', 'wait'];

/** Reads a scope key (`scopeKey`) back; a decode route must be a measured lane and route. */
function readScope(v: unknown, path: string): CeilingScope {
  const s = str(v, path);
  const [kind, a, b, ...rest] = s.split(':');
  let scope: CeilingScope | undefined;
  if (s === 'all-routes') scope = { kind: 'all-routes' };
  else if (kind === 'compute-route' && b === undefined) scope = { kind: 'compute-route', route: oneOf(a, ['cpu', 'webgpu'], path) };
  else if (kind === 'memory-class' && b === undefined) scope = { kind: 'memory-class', memory: oneOf(a, ['constrained-or-unknown', 'ample'], path) };
  else if (kind === 'decode-route' && rest.length === 0) scope = { kind: 'decode-route', lane: oneOf(a, DECODE_LANES, path), route: oneOf(b, DECODE_ROUTES, path) };
  if (!scope || scopeKey(scope) !== s) throw new Invalid(path, 'a scope key');
  return scope;
}

export function parseCeilingVectors(value: unknown): VectorFileResult<CeilingVectors> {
  return run(() => {
    const v = obj(value, '$');
    const ceilings = arr(v.ceilings, '$.ceilings').map((item, i): CeilingVector => {
      const p = `$.ceilings[${i}]`;
      const c = obj(item, p);
      const scope = readScope(c.scope, `${p}.scope`);
      const val = count(c.value, `${p}.value`);
      const at = obj(c.atBoundary, `${p}.atBoundary`);
      exact(at.requested, val, `${p}.atBoundary.requested`);
      exact(at.ok, true, `${p}.atBoundary.ok`);
      exact(at.remaining, 0, `${p}.atBoundary.remaining`);
      const over = obj(c.oneOver, `${p}.oneOver`);
      exact(over.requested, val + 1, `${p}.oneOver.requested`);
      exact(over.ok, false, `${p}.oneOver.ok`);
      return {
        name: oneOf(c.name, NAMES, `${p}.name`),
        scope,
        unit: oneOf(c.unit, UNITS, `${p}.unit`),
        value: val,
        atBoundary: { requested: val, ok: true, remaining: 0 },
        oneOver: { requested: val + 1, ok: false, action: oneOf(over.action, ACTIONS, `${p}.oneOver.action`) },
      };
    });
    const seen = new Set<string>();
    ceilings.forEach((c, i) => {
      const key = `${c.name} ${scopeKey(c.scope)}`;
      if (seen.has(key)) throw new Invalid(`$.ceilings[${i}]`, 'a (name, scope) pair not already listed');
      seen.add(key);
    });
    const notAdmitted = arr(v.notAdmitted, '$.notAdmitted').map((item, i): NotAdmittedVector => {
      const n = obj(item, `$.notAdmitted[${i}]`);
      const scope = str(n.scope, `$.notAdmitted[${i}].scope`);
      if (!/^decode-route:[a-z0-9-]+:[a-z0-9-]+$/u.test(scope)) throw new Invalid(`$.notAdmitted[${i}].scope`, 'a decode-route scope key');
      return { name: oneOf(n.name, NAMES, `$.notAdmitted[${i}].name`), scope };
    });
    return { contract: str(v.contract, '$.contract'), classicCommit: str(v.classicCommit, '$.classicCommit'), ceilings, notAdmitted };
  });
}

// ---- export-identity.vectors.json

export interface ExportFilenameExpectation {
  readonly filename: string;
  readonly stem: string;
  readonly suffix: string;
}

export interface ExportIdentityVectors {
  readonly suffixAlphabet: string;
  readonly golden: { readonly input: ExportIdentityInput; readonly digest: string };
  readonly suffixVectors: readonly { readonly digest: string; readonly suffix16: string }[];
  readonly sanitize: readonly { readonly name: string; readonly input: string; readonly expected: string }[];
  readonly truncation: readonly { readonly name: string; readonly label: string; readonly digest: string; readonly expected: ExportFilenameExpectation }[];
  readonly shapes: readonly {
    readonly name: string;
    readonly input: ExportIdentityInput;
    /** Null when the result has no label: the name falls back to face or morph. */
    readonly labelSource: ExportLabelSource | null;
    readonly digest: string;
    readonly expected: { readonly filename: string; readonly mime: string };
  }[];
  readonly webpVsPng: {
    readonly webp: ExportIdentityInput;
    readonly png: ExportIdentityInput;
    readonly labelSource: ExportLabelSource;
    readonly expected: { readonly webp: string; readonly png: string };
  };
  readonly forcedCollision: {
    readonly digests: readonly [string, string];
    readonly label: string;
    readonly kind: ExportKind;
    readonly first: string;
    readonly secondWithFirstKnown: string;
    readonly secondAlone: string;
  };
  readonly realCollision: {
    readonly inputA: ExportIdentityInput;
    readonly inputB: ExportIdentityInput;
    readonly tries: number;
    readonly seedA: string;
    readonly seedB: string;
    readonly digestA: string;
    readonly digestB: string;
    readonly sharedPrefix6: string;
    readonly nameA: string;
    readonly nameBWithAKnown: string;
  };
  readonly exhaustion: {
    readonly digest: string;
    readonly label: string;
    readonly kind: ExportKind;
    readonly known: readonly { readonly digest: string; readonly filename: string }[];
    readonly occupiedLengths: number;
    readonly expectedError: 'ExportNameCollision';
    readonly oneFewerKnown: string;
  };
}

function exportJson(v: unknown, path: string, depth = 0): ExportJson {
  if (depth > 32) throw new Invalid(path, 'JSON nested at most 32 deep');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Invalid(path, 'a finite number');
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => exportJson(x, `${path}[${i}]`, depth + 1));
  const o = obj(v, path);
  const out: Record<string, ExportJson> = {};
  for (const [k, x] of Object.entries(o)) out[k] = exportJson(x, `${path}.${k}`, depth + 1);
  return out;
}

const INPUT_KEYS = new Set(['kind', 'crops', 'orderedInputs', 'morph', 'modelIdentity', 'format', 'encodingOptions']);

/** Validates an ExportIdentityInput read from JSON. */
export function readExportIdentityInput(v: unknown, path: string): ExportIdentityInput {
  const o = obj(v, path);
  for (const k of Object.keys(o)) if (!INPUT_KEYS.has(k)) throw new Invalid(`${path}.${k}`, 'no such field');
  const base = {
    kind: oneOf(o.kind, EXPORT_KINDS, `${path}.kind`),
    crops: arr(o.crops, `${path}.crops`).map((c, i) => hex64(c, `${path}.crops[${i}]`)),
    orderedInputs: arr(o.orderedInputs, `${path}.orderedInputs`).map((c, i) => str(c, `${path}.orderedInputs[${i}]`)),
    modelIdentity: str(o.modelIdentity, `${path}.modelIdentity`),
    format: str(o.format, `${path}.format`),
    encodingOptions: exportJson(o.encodingOptions, `${path}.encodingOptions`),
  };
  if (o.morph === undefined) return base;
  const m = obj(o.morph, `${path}.morph`);
  return { ...base, morph: { mode: str(m.mode, `${path}.morph.mode`), settings: exportJson(m.settings, `${path}.morph.settings`) } };
}

const ORIGINS: readonly ExportLabelSource['origin'][] = ['result-name', 'entered-text', 'seed', 'source-basename'];
const labelSource = (v: unknown, path: string): ExportLabelSource => {
  const o = obj(v, path);
  return { origin: oneOf(o.origin, ORIGINS, `${path}.origin`), text: str(o.text, `${path}.text`) };
};

export function parseExportIdentityVectors(value: unknown): VectorFileResult<ExportIdentityVectors> {
  return run(() => {
    const v = obj(value, '$');
    const golden = obj(v.golden, '$.golden');
    const wp = obj(v.webpVsPng, '$.webpVsPng');
    const wpe = obj(wp.expected, '$.webpVsPng.expected');
    const fc = obj(v.forcedCollision, '$.forcedCollision');
    const fcd = arr(fc.digests, '$.forcedCollision.digests');
    if (fcd.length !== 2) throw new Invalid('$.forcedCollision.digests', 'two digests');
    const rc = obj(v.realCollision, '$.realCollision');
    const ex = obj(v.exhaustion, '$.exhaustion');
    exact(ex.expectedError, 'ExportNameCollision', '$.exhaustion.expectedError');
    return {
      suffixAlphabet: str(v.suffixAlphabet, '$.suffixAlphabet'),
      golden: { input: readExportIdentityInput(golden.input, '$.golden.input'), digest: hex64(golden.digest, '$.golden.digest') },
      suffixVectors: arr(v.suffixVectors, '$.suffixVectors').map((x, i) => {
        const o = obj(x, `$.suffixVectors[${i}]`);
        return { digest: hex64(o.digest, `$.suffixVectors[${i}].digest`), suffix16: str(o.suffix16, `$.suffixVectors[${i}].suffix16`) };
      }),
      sanitize: arr(v.sanitize, '$.sanitize').map((x, i) => {
        const p = `$.sanitize[${i}]`;
        const o = obj(x, p);
        return { name: str(o.name, `${p}.name`), input: str(o.input, `${p}.input`), expected: str(o.expected, `${p}.expected`) };
      }),
      truncation: arr(v.truncation, '$.truncation').map((x, i) => {
        const p = `$.truncation[${i}]`;
        const o = obj(x, p);
        const e = obj(o.expected, `${p}.expected`);
        return {
          name: str(o.name, `${p}.name`),
          label: str(o.label, `${p}.label`),
          digest: hex64(o.digest, `${p}.digest`),
          expected: { filename: str(e.filename, `${p}.expected.filename`), stem: str(e.stem, `${p}.expected.stem`), suffix: str(e.suffix, `${p}.expected.suffix`) },
        };
      }),
      shapes: arr(v.shapes, '$.shapes').map((x, i) => {
        const p = `$.shapes[${i}]`;
        const o = obj(x, p);
        const e = obj(o.expected, `${p}.expected`);
        return {
          name: str(o.name, `${p}.name`),
          input: readExportIdentityInput(o.input, `${p}.input`),
          labelSource: o.labelSource === null ? null : labelSource(o.labelSource, `${p}.labelSource`),
          digest: hex64(o.digest, `${p}.digest`),
          expected: { filename: str(e.filename, `${p}.expected.filename`), mime: str(e.mime, `${p}.expected.mime`) },
        };
      }),
      webpVsPng: {
        webp: readExportIdentityInput(wp.webp, '$.webpVsPng.webp'),
        png: readExportIdentityInput(wp.png, '$.webpVsPng.png'),
        labelSource: labelSource(wp.labelSource, '$.webpVsPng.labelSource'),
        expected: { webp: str(wpe.webp, '$.webpVsPng.expected.webp'), png: str(wpe.png, '$.webpVsPng.expected.png') },
      },
      forcedCollision: {
        digests: [hex64(fcd[0], '$.forcedCollision.digests[0]'), hex64(fcd[1], '$.forcedCollision.digests[1]')],
        label: str(fc.label, '$.forcedCollision.label'),
        kind: oneOf(fc.kind, EXPORT_KINDS, '$.forcedCollision.kind'),
        first: str(fc.first, '$.forcedCollision.first'),
        secondWithFirstKnown: str(fc.secondWithFirstKnown, '$.forcedCollision.secondWithFirstKnown'),
        secondAlone: str(fc.secondAlone, '$.forcedCollision.secondAlone'),
      },
      realCollision: {
        inputA: readExportIdentityInput(rc.inputA, '$.realCollision.inputA'),
        inputB: readExportIdentityInput(rc.inputB, '$.realCollision.inputB'),
        tries: count(rc.tries, '$.realCollision.tries'),
        seedA: str(rc.seedA, '$.realCollision.seedA'),
        seedB: str(rc.seedB, '$.realCollision.seedB'),
        digestA: hex64(rc.digestA, '$.realCollision.digestA'),
        digestB: hex64(rc.digestB, '$.realCollision.digestB'),
        sharedPrefix6: str(rc.sharedPrefix6, '$.realCollision.sharedPrefix6'),
        nameA: str(rc.nameA, '$.realCollision.nameA'),
        nameBWithAKnown: str(rc.nameBWithAKnown, '$.realCollision.nameBWithAKnown'),
      },
      exhaustion: {
        digest: hex64(ex.digest, '$.exhaustion.digest'),
        label: str(ex.label, '$.exhaustion.label'),
        kind: oneOf(ex.kind, EXPORT_KINDS, '$.exhaustion.kind'),
        known: arr(ex.known, '$.exhaustion.known').map((x, i) => {
          const o = obj(x, `$.exhaustion.known[${i}]`);
          return { digest: hex64(o.digest, `$.exhaustion.known[${i}].digest`), filename: str(o.filename, `$.exhaustion.known[${i}].filename`) };
        }),
        occupiedLengths: count(ex.occupiedLengths, '$.exhaustion.occupiedLengths'),
        expectedError: 'ExportNameCollision',
        oneFewerKnown: str(ex.oneFewerKnown, '$.exhaustion.oneFewerKnown'),
      },
    };
  });
}
