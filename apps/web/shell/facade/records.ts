// The records that cross the candidate bridge (fm-pia9), typed as classic src/Next/Product.fs declared them
// (Input, Face, PublicPreview, NameFace, Progress, Output, Request, Downloads), plus the shapes Product.fs read
// through `obj` (photo selection, crop offers, detected-face choices, refusal reasons). The bridge is untyped
// JavaScript, so nothing it returns is trusted: every value is read from `unknown` here and either becomes one of
// these records or a FacadeError naming the field that was wrong. Pure: no DOM, no bridge import.

/** A payload from the bridge that is not the record its export promises. */
export class FacadeError extends Error {
  readonly record: string;
  readonly path: string;
  constructor(record: string, path: string, why: string) {
    super(`${record}${path ? `.${path}` : ''}: ${why}`);
    this.name = 'FacadeError';
    this.record = record;
    this.path = path;
  }
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads fields of one record, each failing with the record name and field path. */
class Reader {
  readonly record: string;
  readonly value: Obj;
  readonly path: string;
  constructor(record: string, value: Obj, path = '') {
    this.record = record;
    this.value = value;
    this.path = path;
  }
  static of(record: string, value: unknown, path = ''): Reader {
    if (!isObj(value))
      throw new FacadeError(record, path, `expected an object, got ${describe(value)}`);
    return new Reader(record, value, path);
  }
  private at(key: string): string {
    return this.path ? `${this.path}.${key}` : key;
  }
  private fail(key: string, why: string): never {
    throw new FacadeError(this.record, this.at(key), why);
  }
  string(key: string): string {
    const v = this.value[key];
    return typeof v === 'string' ? v : this.fail(key, `expected a string, got ${describe(v)}`);
  }
  /** A string field the bridge leaves undefined or null when empty. */
  optionalString(key: string): string {
    const v = this.value[key];
    return v === undefined || v === null
      ? ''
      : typeof v === 'string'
        ? v
        : this.fail(key, `expected a string, got ${describe(v)}`);
  }
  boolean(key: string): boolean {
    const v = this.value[key];
    return typeof v === 'boolean' ? v : this.fail(key, `expected a boolean, got ${describe(v)}`);
  }
  number(key: string): number {
    const v = this.value[key];
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : this.fail(key, `expected a finite number, got ${describe(v)}`);
  }
  integer(key: string): number {
    const v = this.number(key);
    return Number.isInteger(v) ? v : this.fail(key, `expected an integer, got ${v}`);
  }
  oneOf<T extends string>(key: string, choices: readonly T[]): T {
    const v = this.string(key);
    return (choices as readonly string[]).includes(v)
      ? (v as T)
      : this.fail(key, `expected one of ${choices.join(', ')}, got "${v}"`);
  }
  array<T>(key: string, item: (value: unknown, path: string) => T): readonly T[] {
    const v = this.value[key];
    if (!Array.isArray(v)) return this.fail(key, `expected an array, got ${describe(v)}`);
    return v.map((x, i) => item(x, `${this.at(key)}[${i}]`));
  }
  blobOrNull(key: string): Blob | null {
    const v = this.value[key];
    if (v === undefined || v === null) return null;
    return v instanceof Blob ? v : this.fail(key, `expected a Blob or null, got ${describe(v)}`);
  }
  has(key: string): boolean {
    return this.value[key] !== undefined && this.value[key] !== null;
  }
  raw(key: string): unknown {
    return this.value[key];
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v;
}

// ---- records (Product.fs lines 15-27, 84) -------------------------------------------------------------------------

export const INPUT_MODES = ['text', 'seed', 'photo', 'project'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

/** One face slot as the request carries it. `file` is the chosen photo for a photo slot, otherwise null. */
export interface Input {
  readonly id: string;
  readonly mode: InputMode;
  readonly value: string;
  readonly file: Blob | null;
}

export interface Face {
  readonly id: string;
  /** The bridge holds the face's pixels (raw), so drawFace can paint it before its file is encoded. */
  readonly raw: boolean;
  readonly url: string;
  readonly label: string;
  readonly sourceMode: string;
  readonly sourceFile: Blob | null;
}

export interface PublicPreview {
  readonly id: string;
  readonly mode: InputMode;
  readonly value: string;
  readonly url: string;
}

export interface NameFace {
  readonly name: string;
  readonly value: string;
  readonly image: string;
  readonly full: string;
}

export interface Progress {
  readonly jobId: number;
  readonly stage: string;
  readonly text: string;
  /** 0..1, the bar's position for the whole job. */
  readonly fraction: number;
  /** Present on face progress, absent on global acquisition/reporting events. */
  readonly face?: string;
}

export const MORPH_KINDS = [
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
] as const;
export type MorphKind = (typeof MORPH_KINDS)[number];

/** Why an operation was refused by route admission (fm-lt2p): a key, its sentence and a Help anchor. */
export interface Refusal {
  readonly reasonKey: string;
  readonly text: string;
  readonly helpAnchor: string;
}

/** Faces the detector found in a photo, offered for the person to choose (Product.fs reads it as `obj`). */
export interface DetectedFaces {
  readonly id: string;
  readonly file: Blob;
  readonly boxes: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
  readonly url: string;
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly scale: number;
}

export interface Output {
  readonly faces: readonly Face[];
  readonly videoUrl: string;
  readonly projectJson: string;
  readonly message: string;
  readonly errorMessage: string;
  readonly restored: boolean;
  readonly inputs: readonly Input[];
  /** '' when no morph exists yet. */
  readonly kind: MorphKind | '';
  readonly width: number;
  readonly pinch: boolean;
  readonly frames: number;
  readonly fps: number;
  readonly photoChoices: DetectedFaces | null;
  /** The face whose photo must be cropped again (no face, or several), or null. */
  readonly cropFace: string | null;
  readonly refusal: Refusal | null;
}

export const ACTIONS = ['face', 'faces', 'morph', 'blend'] as const;
export type Action = (typeof ACTIONS)[number];
export const PROVIDERS = ['auto', 'cpu', 'webgpu'] as const;
export type RequestedProvider = (typeof PROVIDERS)[number];

export interface Request {
  readonly jobId: number;
  readonly action: Action;
  /** The face a `face` action works on, or the id a `blend` result is installed under; '' otherwise. */
  readonly target: string;
  readonly inputs: readonly Input[];
  /** A `blend` action's weight per input, in input order. */
  readonly weights?: readonly number[];
  readonly kind: MorphKind;
  readonly width: number;
  readonly pinch: boolean;
  readonly frames: number;
  readonly fps: number;
  /** Morph video size (fm-36ag); Standard when absent. */
  readonly quality?: 'standard' | 'full';
  readonly provider: RequestedProvider;
  /** Runtime identity is the SHA-256 of the selected runtime manifest bytes. */
  readonly routeSnapshot?: import('../../src/contracts/scheduler.ts').RouteSnapshot;
}

export const DOWNLOAD_PHASES = ['idle', 'downloading', 'done', 'failed'] as const;
export interface Downloads {
  readonly known: boolean;
  readonly phase: string;
  readonly scope: string;
  readonly loaded: number;
  readonly total: number;
  readonly routeReady: boolean;
  readonly photoReady: boolean;
  readonly photoAvailable: boolean;
  readonly routeBytes: number;
  readonly photoBytes: number;
  /** An independently requested photo setup discovered a larger scope and needs a fresh decision. */
  readonly photoApprovalRequired?: boolean;
  /** The pinned video codec fallback (fm-9kr8): verified on this device, and the bytes it would download. */
  readonly codecReady?: boolean;
  readonly codecBytes?: number;
  /** A model file this session downloaded could not be saved (browser storage refused it), fm-9kr8. */
  readonly modelNotKept?: boolean;
}

/** A photo that needs the crop step: its preview, as photo-selection.mjs returns it (`{crop: true, file, ...}`). */
export interface CropOffer {
  readonly file: Blob;
  readonly blob: Blob;
  readonly url: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly scale: number;
  readonly resized: boolean;
}

/** What choosing a photo for a face gives (selectPhotoReported), by kind. */
export type PhotoSelection =
  /** A newer choice or a cancelled picker superseded it. */
  | { readonly kind: 'superseded' }
  /** A saved morph MP4 carrying its project: open it as a project. */
  | { readonly kind: 'project'; readonly projectFile: Blob }
  /** A saved face image carrying its latent: recovered without encoding. */
  | { readonly kind: 'recovered'; readonly output: Output }
  /** A photo the encoder can take as it is. */
  | { readonly kind: 'photo'; readonly file: Blob }
  /** A photo that has to be cropped first. */
  | { readonly kind: 'crop'; readonly offer: CropOffer };

// ---- readers ------------------------------------------------------------------------------------------------------

const readInput = (value: unknown, path: string): Input => {
  const r = Reader.of('Input', value, path);
  return {
    id: r.string('id'),
    mode: r.oneOf('mode', INPUT_MODES),
    value: r.optionalString('value'),
    file: r.blobOrNull('file'),
  };
};

const readFace = (value: unknown, path: string): Face => {
  const r = Reader.of('Face', value, path);
  return {
    id: r.string('id'),
    raw: r.boolean('raw'),
    url: r.optionalString('url'),
    label: r.string('label'),
    sourceMode: r.optionalString('sourceMode'),
    sourceFile: r.blobOrNull('sourceFile'),
  };
};

function readRefusal(value: unknown, path: string): Refusal {
  const r = Reader.of('Refusal', value, path);
  return {
    reasonKey: r.string('reasonKey'),
    text: r.string('text'),
    helpAnchor: r.string('helpAnchor'),
  };
}

function readDetected(value: unknown, path: string): DetectedFaces {
  const r = Reader.of('DetectedFaces', value, path);
  const file = r.raw('file');
  if (!(file instanceof Blob))
    throw new FacadeError('DetectedFaces', `${path}.file`, 'expected a Blob');
  return {
    id: r.string('id'),
    file,
    boxes: r.array('boxes', (box, p) => {
      const b = Reader.of('DetectedFaces', box, p);
      return {
        x: b.number('x'),
        y: b.number('y'),
        width: b.number('width'),
        height: b.number('height'),
      };
    }),
    url: r.string('url'),
    previewWidth: r.number('previewWidth'),
    previewHeight: r.number('previewHeight'),
    scale: r.number('scale'),
  };
}

export function readOutput(value: unknown, path = ''): Output {
  const r = Reader.of('Output', value, path);
  return {
    faces: r.array('faces', readFace),
    videoUrl: r.optionalString('videoUrl'),
    projectJson: r.optionalString('projectJson'),
    message: r.optionalString('message'),
    errorMessage: r.optionalString('errorMessage'),
    restored: r.boolean('restored'),
    inputs: r.array('inputs', readInput),
    kind: r.has('kind') && r.string('kind') !== '' ? r.oneOf('kind', MORPH_KINDS) : '',
    width: r.number('width'),
    pinch: r.boolean('pinch'),
    frames: r.integer('frames'),
    fps: r.integer('fps'),
    photoChoices: r.has('photoChoices')
      ? readDetected(r.raw('photoChoices'), 'photoChoices')
      : null,
    cropFace: r.has('cropFace') ? r.string('cropFace') : null,
    refusal: r.has('refusal') ? readRefusal(r.raw('refusal'), 'refusal') : null,
  };
}

export function readProgress(value: unknown): Progress {
  const r = Reader.of('Progress', value);
  return {
    jobId: r.integer('jobId'),
    stage: r.string('stage'),
    text: r.optionalString('text'),
    fraction: r.number('fraction'),
    ...(r.has('face') ? { face: r.string('face') } : {}),
  };
}

export function readDownloads(value: unknown): Downloads {
  const r = Reader.of('Downloads', value);
  return {
    known: r.boolean('known'),
    phase: r.string('phase'),
    scope: r.optionalString('scope'),
    loaded: r.number('loaded'),
    total: r.number('total'),
    routeReady: r.boolean('routeReady'),
    photoReady: r.boolean('photoReady'),
    photoAvailable: r.boolean('photoAvailable'),
    routeBytes: r.number('routeBytes'),
    photoBytes: r.number('photoBytes'),
    ...(r.has('photoApprovalRequired')
      ? { photoApprovalRequired: r.boolean('photoApprovalRequired') }
      : {}),
    ...(r.has('codecReady') ? { codecReady: r.boolean('codecReady') } : {}),
    ...(r.has('codecBytes') ? { codecBytes: r.number('codecBytes') } : {}),
    ...(r.has('modelNotKept') ? { modelNotKept: r.boolean('modelNotKept') } : {}),
  };
}

export function readNameFaces(value: unknown): readonly NameFace[] {
  if (!Array.isArray(value))
    throw new FacadeError('NameFace[]', '', `expected an array, got ${describe(value)}`);
  return value.map((x, i) => {
    const r = Reader.of('NameFace', x, `[${i}]`);
    return {
      name: r.string('name'),
      value: r.string('value'),
      image: r.optionalString('image'),
      full: r.optionalString('full'),
    };
  });
}

export function readCropOffer(value: unknown, path = ''): CropOffer {
  const r = Reader.of('CropOffer', value, path);
  const file = r.raw('file'),
    blob = r.raw('blob');
  if (!(file instanceof Blob)) throw new FacadeError('CropOffer', 'file', 'expected a Blob');
  if (!(blob instanceof Blob)) throw new FacadeError('CropOffer', 'blob', 'expected a Blob');
  return {
    file,
    blob,
    url: r.string('url'),
    sourceWidth: r.number('sourceWidth'),
    sourceHeight: r.number('sourceHeight'),
    previewWidth: r.number('previewWidth'),
    previewHeight: r.number('previewHeight'),
    scale: r.number('scale'),
    resized: r.has('resized') ? r.boolean('resized') : false,
  };
}

export function readPhotoSelection(value: unknown): PhotoSelection {
  if (value === null || value === undefined) return { kind: 'superseded' };
  if (value instanceof Blob) return { kind: 'photo', file: value };
  const r = Reader.of('PhotoSelection', value);
  if (r.has('projectFile')) {
    const projectFile = r.raw('projectFile');
    if (!(projectFile instanceof Blob))
      throw new FacadeError('PhotoSelection', 'projectFile', 'expected a Blob');
    return { kind: 'project', projectFile };
  }
  if (r.raw('recovered') === true) return { kind: 'recovered', output: readOutput(value) };
  if (r.raw('crop') === true) return { kind: 'crop', offer: readCropOffer(value) };
  throw new FacadeError(
    'PhotoSelection',
    '',
    'not a project, a recovered face, a photo or a crop offer',
  );
}

/** A cropped photo (cropPhotoReported, chooseDetectedFace): the File the encoder takes. */
export function readCroppedFile(value: unknown, record = 'CroppedPhoto'): File {
  if (value instanceof File) return value;
  throw new FacadeError(record, '', `expected a File, got ${describe(value)}`);
}

/** A measured median in milliseconds, or null while nothing was measured. */
export function readMeasured(value: unknown, record: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new FacadeError(
    record,
    '',
    `expected a non-negative number or null, got ${describe(value)}`,
  );
}

export interface JobProgress {
  readonly facesDone: number;
  readonly facesTotal: number;
  readonly framesDone: number;
  readonly framesTotal: number;
  readonly videoFramesDone: number;
  readonly videoFramesTotal: number;
}
export function readJobProgress(value: unknown): JobProgress {
  const r = Reader.of('JobProgress', value);
  return {
    facesDone: r.integer('facesDone'),
    facesTotal: r.integer('facesTotal'),
    framesDone: r.integer('framesDone'),
    framesTotal: r.integer('framesTotal'),
    videoFramesDone: r.integer('videoFramesDone'),
    videoFramesTotal: r.integer('videoFramesTotal'),
  };
}

export function readString(value: unknown, record: string): string {
  if (typeof value === 'string') return value;
  throw new FacadeError(record, '', `expected a string, got ${describe(value)}`);
}
export function readBoolean(value: unknown, record: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new FacadeError(record, '', `expected a boolean, got ${describe(value)}`);
}
export function readInteger(value: unknown, record: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new FacadeError(record, '', `expected an integer, got ${describe(value)}`);
}
