// Still-image entry (fm-4f5m): every chosen, dropped or pasted file is classified by the stylegan-js recovery
// reader (inspectStill) before any face is touched. `matching` and `missing` continue to the bridge's existing
// entry (recovered without inference, or the confirmed-crop photo flow); every other kind is held by the face as
// media: shown when its pixels decode, saved as its original bytes, never computed with. Reasons are data, like
// route-admission refusals. Pure apart from reading the file's bytes: nothing here fetches, and no URL found in
// a file's metadata is followed.
import { inspectStill, readRecovery, type StillKind } from 'stylegan-js';
import { APP_DESCRIPTORS } from './recovery-files.ts';

/** Why a face holds a file instead of using it: a key, its plain sentence and a Help anchor. */
export interface StillReason {
  readonly reasonKey: string;
  readonly text: string;
  readonly helpAnchor: string;
}

/** Kinds the bridge's own entry takes; every other kind is held by the face, untouched. */
export type HeldKind = Exclude<StillKind, 'matching' | 'missing'>;

/** What the classifier reads of a picked file; a DOM File satisfies it (the media core has no DOM globals). */
export interface StillFile {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StillEntry<F extends StillFile = StillFile> {
  /** The file's position in its pick or drop. */
  readonly index: number;
  readonly file: F;
  readonly bytes: number;
  readonly kind: StillKind;
  readonly reason: StillReason | null;
}

/** Files the reader does not take (the bridge refuses them on its own terms). */
export const MAX_STILL_BYTES = 64 * 1024 * 1024;
const HELP = '#help-keep-originals';

export const isHeld = (kind: StillKind): kind is HeldKind => kind !== 'matching' && kind !== 'missing';

/** The loaded model and every identity this build knows, from the shipped descriptors. */
export const SHIPPED_MODELS = (() => {
  const [d] = APP_DESCRIPTORS;
  if (!d) throw new Error('This build ships no generator descriptor.');
  return {
    loaded: { ...d.identity, latent: { layers: d.latent.layers, width: d.latent.width } },
    known: APP_DESCRIPTORS.map((x) => x.identity),
  } as const;
})();

/** One file's verdict from its bytes. `models` defaults to the shipped generator. */
export function classifyStillBytes(
  bytes: Uint8Array,
  models: Parameters<typeof inspectStill>[1] = SHIPPED_MODELS,
): { readonly kind: StillKind; readonly reason: StillReason | null } {
  const r = inspectStill(bytes, models);
  switch (r.kind) {
    case 'matching':
      return { kind: r.kind, reason: null };
    case 'missing':
      return {
        kind: r.kind,
        reason: { reasonKey: 'still-missing', text: 'This image has no saved face data, so it is encoded as a photo.', helpAnchor: HELP },
      };
    case 'damaged': {
      const parsed = readRecovery(bytes);
      const damage = parsed.kind === 'damaged' ? parsed.reason : 'unreadable';
      return {
        kind: r.kind,
        reason: {
          reasonKey: `still-damaged-${damage}`,
          text:
            damage === 'integrity'
              ? 'This image’s saved face data failed its integrity check, so the face is not changed.'
              : `This image’s saved face data is damaged (${damage}), so the face is not changed.`,
          helpAnchor: HELP,
        },
      };
    }
    case 'incompatible-schema':
      return {
        kind: r.kind,
        reason: {
          reasonKey: 'still-schema',
          text: `${r.reason ?? 'Its saved face data is a version this app cannot read.'} It is shown and saved as it is, but cannot be morphed.`,
          helpAnchor: HELP,
        },
      };
    case 'incompatible-model':
    case 'unknown-model':
      return {
        kind: r.kind,
        reason: {
          reasonKey: r.kind === 'incompatible-model' ? 'still-model-mismatch' : 'still-model-unknown',
          text: `${r.reason ?? 'This face was made with another model.'} It is shown and saved as it is, but left out of morphs.`,
          helpAnchor: HELP,
        },
      };
  }
}

/** Classifies each file in order, before any face changes. A file too large to read is left to the bridge. */
export async function classifyStills<F extends StillFile>(
  files: readonly F[],
  models: Parameters<typeof inspectStill>[1] = SHIPPED_MODELS,
): Promise<readonly StillEntry<F>[]> {
  const entries: StillEntry<F>[] = [];
  for (const [index, file] of files.entries()) {
    if (typeof file?.arrayBuffer !== 'function' || file.size > MAX_STILL_BYTES) {
      entries.push({ index, file, bytes: file?.size ?? 0, kind: 'missing', reason: null });
      continue;
    }
    const verdict = classifyStillBytes(new Uint8Array(await file.arrayBuffer()), models);
    entries.push({ index, file, bytes: file.size, ...verdict });
  }
  return entries;
}

/** What a classification log line carries: never the file name or pixels. */
export const stillLog = (entry: StillEntry, target: string, revision: number, applied: boolean) => ({
  index: entry.index,
  bytes: entry.bytes,
  kind: entry.kind,
  reasonKey: entry.reason?.reasonKey ?? null,
  target,
  revision,
  applied,
});
