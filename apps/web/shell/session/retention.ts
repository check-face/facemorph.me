/// <reference lib="dom" />
// On-origin recovery. Storage keys, records, hash checks and byte budgets match last-result.mjs.
import { openOriginals, digest } from '../../src/Next/browser/originals.mjs';
import type { MorphKind } from '../facade/records.ts';
import { keepOnlyWords, rememberWords, type FaceWords } from './session-words.ts';

const KEY = 'last-generated-result-v1';
const SESSION = 'last-generated-session-v2';
const MAX_SESSION_BYTES = 32 * 1024 * 1024;
export const MORPH_FRAME_BUDGET = 4096;
export const SESSION_TOO_LARGE =
  'These faces are too large to keep for next time. They stay here until you close this tab.';
export interface RetainedSettings {
  kind: MorphKind;
  width: number;
  pinch: boolean;
  frames: number;
  fps: number;
}
export interface ResultInput {
  blob: Blob;
  latent: { space: string; values: Float32Array | readonly number[] };
  imageSha256: string;
  latentSha256: string;
  provenance: Readonly<Record<string, unknown>>;
  cacheKey?: string;
  generationKind?: string;
  generationSha256?: string;
}
export interface RetainedResult extends ResultInput {
  latent: { space: 'w-plus'; shape: readonly [18, 512]; values: Float32Array };
}
export interface LastRecord extends Readonly<Record<string, unknown>> {
  kind: string;
  result: RetainedResult;
}
export interface RetainedFace extends Readonly<Record<string, unknown>> {
  id: string;
  generationKind: string;
  result: RetainedResult;
}
export interface SessionRecord extends Readonly<Record<string, unknown>> {
  kind: string;
  ids: readonly string[];
  faces: readonly RetainedFace[];
  frames: readonly Blob[];
  video: Blob | null;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function settingsValid(value: unknown): boolean {
  if (!object(value)) return false;
  return (
    [
      'full-smooth-figure8',
      'full-smooth-ellipse',
      'pairwise-figure8',
      'pairwise-ellipse',
      'linear',
    ].includes(String(value['kind'])) &&
    typeof value['width'] === 'number' &&
    Number.isFinite(value['width']) &&
    value['width'] >= 0 &&
    value['width'] <= 1.2 &&
    typeof value['pinch'] === 'boolean' &&
    typeof value['frames'] === 'number' &&
    [8, 16, 32].includes(value['frames']) &&
    typeof value['fps'] === 'number' &&
    Number.isInteger(value['fps']) &&
    value['fps'] >= 1 &&
    value['fps'] <= 120
  );
}

export async function validateLast(record: unknown): Promise<LastRecord | null> {
  if (!object(record) || record['kind'] !== KEY || !object(record['result'])) return null;
  const r = record['result'];
  if (!(r['blob'] instanceof Blob) || !['image/png', 'image/webp'].includes(r['blob'].type))
    return null;
  if (record['settings'] && !settingsValid(record['settings'])) return null;
  const latent = r['latent'],
    provenance = r['provenance'];
  if (
    !object(latent) ||
    latent['space'] !== 'w-plus' ||
    !object(provenance) ||
    !provenance['modelSha256'] ||
    !provenance['noiseSha256']
  )
    return null;
  const v = latent['values'];
  if (!object(v) || v['length'] !== 18 * 512) return null;
  const values = Array.from(v as unknown as ArrayLike<unknown>);
  if (
    !values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )
    return null;
  const bytes = v instanceof Float32Array ? v : new Float32Array(values);
  const imageSha256: string = await digest(await r['blob'].arrayBuffer());
  const latentSha256: string = await digest(bytes);
  if (imageSha256 !== r['imageSha256'] || latentSha256 !== r['latentSha256']) return null;
  // Preserve additional compatible record fields, independently of compressed image bytes.
  return {
    ...record,
    kind: KEY,
    result: {
      ...r,
      blob: r['blob'],
      imageSha256,
      latentSha256,
      provenance,
      latent: { space: 'w-plus', shape: [18, 512], values: bytes },
    },
  };
}

export async function rememberLast(
  result: Pick<
    ResultInput,
    'imageSha256' | 'latentSha256' | 'cacheKey' | 'generationKind' | 'generationSha256'
  >,
  settings: RetainedSettings,
): Promise<boolean> {
  let store: Awaited<ReturnType<typeof openOriginals>> | undefined;
  try {
    if (!result?.imageSha256 || !result?.latentSha256) return false;
    store = await openOriginals();
    if (!hash(result.cacheKey)) return false;
    await store.put(KEY, {
      kind: KEY,
      key: result.cacheKey,
      generationKind: result.generationKind || 'seed',
      generationSha256: result.generationSha256,
      settings: copySettings(settings),
    });
    return true;
  } catch {
    return false;
  } finally {
    store?.close();
  }
}
export async function readLast(
  onOutcome: (outcome: 'missing' | 'incompatible' | 'unavailable') => void = () => {},
): Promise<LastRecord | null> {
  let store: Awaited<ReturnType<typeof openOriginals>> | undefined;
  try {
    store = await openOriginals();
    const ref: unknown = await store.get(KEY);
    if (!ref) {
      onOutcome('missing');
      return null;
    }
    if (
      !object(ref) ||
      !hash(ref['key']) ||
      !['seed', 'photo', 'latent'].includes(String(ref['generationKind'])) ||
      !hash(ref['generationSha256'])
    ) {
      onOutcome('incompatible');
      return null;
    }
    const result: unknown = await store.get(ref['key']);
    if (!result) {
      onOutcome('missing');
      return null;
    }
    if (!object(result) || result['generationSha256'] !== ref['generationSha256']) {
      onOutcome('incompatible');
      return null;
    }
    const saved = await validateLast({ ...ref, result });
    if (!saved) onOutcome('incompatible');
    return saved;
  } catch {
    onOutcome('unavailable');
    return null;
  } finally {
    store?.close();
  }
}

export async function validateSession(record: unknown): Promise<SessionRecord | null> {
  if (
    !object(record) ||
    record['kind'] !== SESSION ||
    !Array.isArray(record['faces']) ||
    !Array.isArray(record['ids'])
  )
    return null;
  const ids: unknown[] = record['ids'];
  if (
    new Set(ids).size !== ids.length ||
    !ids.every((id): id is string => typeof id === 'string' && id.length <= 128)
  )
    return null;
  const checked: RetainedFace[] = [];
  for (const face of record['faces'] as unknown[]) {
    if (
      !object(face) ||
      typeof face['id'] !== 'string' ||
      !ids.includes(face['id']) ||
      checked.some((f) => f.id === face['id']) ||
      !['seed', 'photo', 'latent'].includes(String(face['generationKind'])) ||
      !object(face['result']) ||
      !hash(face['result']['generationSha256'])
    )
      return null;
    const valid = await validateLast({
      kind: KEY,
      result: face['result'],
      settings: record['settings'],
    });
    if (!valid) return null;
    checked.push({
      ...face,
      id: face['id'],
      generationKind: String(face['generationKind']),
      result: valid.result,
    });
  }
  const bytes = checked.reduce((n, f) => n + f.result.blob.size, 0);
  if (bytes > MAX_SESSION_BYTES) return null;
  let frames: Blob[] = [];
  const offered = record['frames'],
    hashes = record['frameHashes'];
  if (
    Array.isArray(offered) &&
    offered.length <= MORPH_FRAME_BUDGET &&
    Array.isArray(hashes) &&
    hashes.length === offered.length &&
    offered.every(
      (f): f is Blob =>
        f instanceof Blob && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type),
    ) &&
    offered.reduce((n, f) => n + f.size, bytes) <= MAX_SESSION_BYTES
  ) {
    let valid = true;
    for (let i = 0; i < offered.length; i++)
      if ((await digest(await offered[i]!.arrayBuffer())) !== hashes[i]) {
        valid = false;
        break;
      }
    if (valid) frames = offered;
  }
  let video: Blob | null = null;
  const offeredVideo = record['video'];
  if (
    offeredVideo instanceof Blob &&
    offeredVideo.type === 'video/mp4' &&
    offeredVideo.size + bytes + frames.reduce((n, f) => n + f.size, 0) <= MAX_SESSION_BYTES &&
    record['project'] &&
    record['videoSha256'] === (await digest(await offeredVideo.arrayBuffer()))
  )
    video = offeredVideo;
  return {
    ...record,
    kind: SESSION,
    ids: ids as string[],
    faces: checked.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    video,
    frames,
  };
}

/** Restored faces' word keys (face id -> latent SHA-256) from the last readSession in this page. */
const restoredKeys = new Map<string, string>();
/**
 * The key a restored face's tab-scoped words are kept under: the retained record's latent SHA-256 for that face,
 * so words only ever label the very face they were typed for (fm-5hww). Null when this page restored no such face.
 */
export const restoredWordsKey = (faceId: string): string | null => restoredKeys.get(faceId) ?? null;

/** The words behind a face the bridge generated: its source, never its pixels; a photo keeps only its file name. */
function wordsOf(result: unknown): FaceWords | null {
  const source = object(result) ? result['source'] : null;
  if (!object(source)) return null;
  const mode = source['mode'],
    value = source['value'],
    file = source['file'];
  if ((mode === 'text' || mode === 'seed') && typeof value === 'string') return { mode, value };
  if (mode === 'photo' && file instanceof File && file.name) return { mode, value: file.name };
  return null;
}
/** Tab-scoped words for the record just written: new faces' words kept, words of faces no longer in it dropped. */
function retainWords(faces: readonly { id: string; result: ResultInput }[]): void {
  const keep = new Set<string>();
  for (const face of faces) {
    const key = face.result.latentSha256;
    if (!hash(key)) continue;
    keep.add(`${key}:${face.id}`);
    const words = wordsOf(face.result);
    if (words) rememberWords(key, face.id, words);
  }
  keepOnlyWords(keep);
}

export interface SessionInput {
  ids: readonly string[];
  faces: readonly { id: string; result: ResultInput }[];
  settings: RetainedSettings;
  project?: unknown;
  video?: Blob | null;
  frames?: readonly Blob[];
}
const copySettings = (s: RetainedSettings): RetainedSettings => ({
  kind: s.kind,
  width: s.width,
  pinch: s.pinch,
  frames: s.frames,
  fps: s.fps,
});
/** Pure retention decision; the estimate itself always comes from the real browser. */
export function videoHasHeadroom(
  estimate: StorageEstimate,
  videoBytes: number,
  retainedBytes: number,
): boolean {
  return (
    Number.isFinite(estimate.quota) &&
    (estimate.quota ?? 0) - (estimate.usage || 0) > videoBytes + retainedBytes + 8 * 1024 * 1024
  );
}
export async function rememberSession(
  { ids, faces, settings, project, video, frames = [] }: SessionInput,
  isCurrent: () => boolean = () => true,
  onRefused: (reason: string) => void = () => {},
): Promise<boolean> {
  let store: Awaited<ReturnType<typeof openOriginals>> | undefined;
  try {
    const selected = [];
    let bytes = 0;
    for (const face of faces) {
      const r = face.result;
      bytes += r.blob.size;
      if (bytes > MAX_SESSION_BYTES) {
        if (!isCurrent()) return false;
        try {
          onRefused(SESSION_TOO_LARGE);
        } catch {
          /* refusal observer must not prevent invalidation */
        }
        store = await openOriginals();
        if (isCurrent()) {
          await store.put(SESSION, { kind: SESSION, faces: [], ids: [] });
          keepOnlyWords(new Set());
        }
        return false;
      }
      selected.push({
        id: face.id,
        generationKind: r.generationKind || 'latent',
        result: {
          blob: r.blob,
          latent: r.latent,
          values: r.latent.values,
          space: 'w-plus',
          imageSha256: r.imageSha256,
          latentSha256: r.latentSha256,
          generationSha256: r.generationSha256,
          generationKind: r.generationKind || 'latent',
          cacheKey: r.cacheKey,
          provenance: r.provenance,
          width: 1024,
          height: 1024,
        },
      });
    }
    if (frames.reduce((n, f) => n + f.size, bytes) > MAX_SESSION_BYTES) frames = [];
    bytes += frames.reduce((n, f) => n + f.size, 0);
    const frameHashes = [];
    for (const frame of frames) frameHashes.push(await digest(await frame.arrayBuffer()));
    let savedVideo: Blob | null = null;
    if (
      video instanceof Blob &&
      video.type === 'video/mp4' &&
      video.size + bytes <= MAX_SESSION_BYTES
    ) {
      let headroom = true;
      try {
        const estimate = await navigator.storage.estimate();
        headroom = videoHasHeadroom(estimate, video.size, bytes);
      } catch {
        headroom = false;
      }
      if (headroom) savedVideo = video;
      else console.warn('Last video retention skipped: storage headroom unavailable.');
    }
    const record = {
      kind: SESSION,
      ids: [...ids],
      faces: selected,
      settings: copySettings(settings),
      project: project || null,
      frames,
      frameHashes,
      video: savedVideo,
      videoSha256: savedVideo ? await digest(await savedVideo.arrayBuffer()) : null,
    };
    if (!isCurrent()) return false;
    store = await openOriginals();
    if (!isCurrent()) return false;
    try {
      await store.put(SESSION, record);
    } catch (error) {
      console.warn(
        'Last session write retried without video:',
        error instanceof Error ? error.name : 'Error',
      );
      if (!isCurrent()) return false;
      await store.put(SESSION, { ...record, video: null, videoSha256: null });
    }
    retainWords(faces);
    return true;
  } catch (error) {
    console.warn('Last session write failed:', error instanceof Error ? error.name : 'Error');
    try {
      if (isCurrent() && store) {
        await store.put(SESSION, { kind: SESSION, faces: [], ids: [] });
        keepOnlyWords(new Set());
      }
    } catch {
      /* storage unavailable */
    }
    return false;
  } finally {
    store?.close();
  }
}
export async function readSession(): Promise<
  SessionRecord | { kind: string; faces: readonly []; ids: readonly [] } | null
> {
  let store: Awaited<ReturnType<typeof openOriginals>> | undefined;
  try {
    store = await openOriginals();
    const record: unknown = await store.get(SESSION);
    if (record) {
      const valid = await validateSession(record);
      restoredKeys.clear();
      for (const face of valid?.faces ?? []) restoredKeys.set(face.id, face.result.latentSha256);
      return valid || { kind: SESSION, faces: [], ids: [] };
    }
  } catch {
    /* unavailable storage */
  } finally {
    store?.close();
  }
  return null;
}
