// ProjectJson in TypeScript (fm-7s3a): the explicit, bounded project-file codec ported from classic
// src/Next/ProjectJson.fs with identical semantics: field names, schema version 1 only, classic's limits and
// messages (except the 64-control check, replaced by the contracts byte bound: fm-id4c), and classic's shipped text
// (fields in a fixed order, strings escaped per UTF-16 unit, numbers as the classic build wrote them: String(value)). Typed results replace the legacy tag protocol;
// export names stay decode and encode for the retained bridge.
import {
  PROJECT_TOO_LARGE_MESSAGE,
  SchemaError,
  array,
  boolean,
  bounds,
  field,
  fieldsOf,
  integer,
  kind,
  number,
  parseBounded,
  space,
  text,
  validate,
  withinInputBytes,
  type Project,
} from './project-json.schema.ts';

export * from './project-json.schema.ts';

/** malformed: unreadable, unknown or out-of-limit input (one message, as classic); invalid: a readable project
 * that fails structural admission or its bounds (every message, in classic's order). */
export type ProjectError =
  | { readonly kind: 'malformed'; readonly messages: readonly [string] }
  | { readonly kind: 'invalid'; readonly messages: readonly string[] };
export type ProjectResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProjectError };

export const MALFORMED_MESSAGE =
  'Invalid or unsupported project JSON; check its schema, fields, values and size limits.';

const ROOT_FIELDS = [
  'schemaVersion',
  'bundle',
  'modelSha256',
  'noiseSha256',
  'truncationPsi',
  'truncationCutoff',
  'morph',
];
const MORPH_FIELDS = [
  'algorithmVersion',
  'kind',
  'controls',
  'closed',
  'width',
  'pinchCenter',
  'framesPerSegment',
  'framesPerSecond',
];

function read(input: string): Project {
  const root = fieldsOf(ROOT_FIELDS, parseBounded(input));
  const schemaVersion = integer(field(root, 'schemaVersion'));
  if (schemaVersion !== 1) throw new SchemaError('Unsupported project schema.');
  const bundle = fieldsOf(['version', 'manifestSha256'], field(root, 'bundle'));
  const morph = fieldsOf(MORPH_FIELDS, field(root, 'morph'));
  const controls = array(field(morph, 'controls'));
  // Field reads follow classic's record construction order, so the first failing read is the same one.
  const bundleValue = {
    version: text(field(bundle, 'version')),
    manifestSha256: text(field(bundle, 'manifestSha256')),
  };
  const modelSha256 = text(field(root, 'modelSha256'));
  const noiseSha256 = text(field(root, 'noiseSha256'));
  const truncationPsi = number(field(root, 'truncationPsi'));
  const truncationCutoff = integer(field(root, 'truncationCutoff'));
  return {
    schemaVersion,
    bundle: bundleValue,
    modelSha256,
    noiseSha256,
    truncationPsi,
    truncationCutoff,
    morph: {
      algorithmVersion: text(field(morph, 'algorithmVersion')),
      kind: kind(text(field(morph, 'kind'))),
      controls: controls.map((value) => {
        const control = fieldsOf(['visitId', 'latent'], value);
        const latent = fieldsOf(['space', 'shape', 'values'], field(control, 'latent'));
        return {
          visitId: text(field(control, 'visitId')),
          latent: {
            space: space(text(field(latent, 'space'))),
            shape: array(field(latent, 'shape')).map(integer),
            values: array(field(latent, 'values')).map(number),
          },
        };
      }),
      closed: boolean(field(morph, 'closed')),
      width: number(field(morph, 'width')),
      pinchCenter: boolean(field(morph, 'pinchCenter')),
      framesPerSegment: integer(field(morph, 'framesPerSegment')),
      framesPerSecond: integer(field(morph, 'framesPerSecond')),
    },
  };
}

/** Reads untrusted project text. Never throws: any failure is a typed error. */
export function decode(input: string): ProjectResult<Project> {
  // The byte bound is checked before any parsing, with its own plain message (no face count: fm-id4c).
  if (typeof input === 'string' && !withinInputBytes(input))
    return { ok: false, error: { kind: 'malformed', messages: [PROJECT_TOO_LARGE_MESSAGE] } };
  let project: Project;
  try {
    project = read(input);
  } catch {
    return { ok: false, error: { kind: 'malformed', messages: [MALFORMED_MESSAGE] } };
  }
  const errors = [...validate(project), ...bounds(project)];
  return errors.length
    ? { ok: false, error: { kind: 'invalid', messages: errors } }
    : { ok: true, value: project };
}

/** A string as classic wrote it: '"' and '\' escaped, control characters and every surrogate unit as \uXXXX
 * (lowercase), everything else as itself. */
export function quote(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const c = value[i] ?? '';
    const code = value.charCodeAt(i);
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (code < 32 || (code >= 0xd800 && code <= 0xdfff))
      out += '\\u' + code.toString(16).padStart(4, '0');
    else out += c;
  }
  return out + '"';
}
/** A number as classic's shipped build wrote it: String(value), so -0 is "0" and 1e-7 is "1e-7". */
export const numeric = (value: number): string => String(value);

const jsonArray = (values: readonly string[]): string => '[' + values.join(',') + ']';
const jsonObject = (entries: readonly (readonly [string, string])[]): string =>
  '{' + entries.map(([k, v]) => quote(k) + ':' + v).join(',') + '}';
const boolValue = (value: boolean): string => (value ? 'true' : 'false');

/** Writes a project as classic did, or names why it cannot. */
export function encode(project: Project): ProjectResult<string> {
  const errors = [...validate(project), ...bounds(project)];
  if (errors.length) return { ok: false, error: { kind: 'invalid', messages: errors } };
  const morph = project.morph;
  const value = jsonObject([
    ['schemaVersion', '1'],
    [
      'bundle',
      jsonObject([
        ['version', quote(project.bundle.version)],
        ['manifestSha256', quote(project.bundle.manifestSha256)],
      ]),
    ],
    ['modelSha256', quote(project.modelSha256)],
    ['noiseSha256', quote(project.noiseSha256)],
    ['truncationPsi', numeric(project.truncationPsi)],
    ['truncationCutoff', String(project.truncationCutoff)],
    [
      'morph',
      jsonObject([
        ['algorithmVersion', quote(morph.algorithmVersion)],
        ['kind', quote(morph.kind)],
        [
          'controls',
          jsonArray(
            morph.controls.map((c) =>
              jsonObject([
                ['visitId', quote(c.visitId)],
                [
                  'latent',
                  jsonObject([
                    ['space', quote(c.latent.space)],
                    ['shape', jsonArray(c.latent.shape.map(String))],
                    ['values', jsonArray(c.latent.values.map(numeric))],
                  ]),
                ],
              ]),
            ),
          ),
        ],
        ['closed', boolValue(morph.closed)],
        ['width', numeric(morph.width)],
        ['pinchCenter', boolValue(morph.pinchCenter)],
        ['framesPerSegment', String(morph.framesPerSegment)],
        ['framesPerSecond', String(morph.framesPerSecond)],
      ]),
    ],
  ]);
  return !withinInputBytes(value)
    ? { ok: false, error: { kind: 'invalid', messages: [PROJECT_TOO_LARGE_MESSAGE] } }
    : { ok: true, value };
}
