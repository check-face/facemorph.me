// Prepared files (fm-l6mq): the encoded export files kept ready to Save or Share, keyed by result revision,
// format and encoding options, bounded by bytes (the planner in contracts/prepared-file-cache.ts). No DOM: the
// caller supplies `encode`, which turns retained pixels or frames into bytes for a format. A format change only
// re-encodes; inference is never asked for here. A completion for a revision that is no longer current is
// discarded, never cached or returned as the current file.
import {
  EMPTY_PREPARED_FILE_CACHE,
  lookupPreparedFile,
  pinCacheEntry,
  planCacheInsert,
  preparedFileKey,
  touchCacheEntry,
  type PreparedFileCacheMaxBytes,
  type PreparedFileCacheState,
} from '../contracts/prepared-file-cache.ts';
import { CONTAINER_TYPE, typeMatchesBytes, type ExportContainer } from './export-policy.ts';

export interface PreparedFile {
  readonly key: string;
  readonly resultRevision: number;
  readonly format: ExportContainer;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export type PrepareOutcome =
  | { readonly status: 'ready'; readonly file: PreparedFile; readonly fromCache: boolean; readonly retained: boolean }
  | { readonly status: 'stale'; readonly resultRevision: number; readonly currentRevision: number }
  | { readonly status: 'type-mismatch'; readonly format: ExportContainer };

export interface PreparedFiles {
  /** The revision whose files are current. Files of other revisions are dropped. */
  readonly currentRevision: () => number;
  readonly setRevision: (revision: number) => void;
  /** The file for (current revision, format, options): from the cache, else encoded from retained pixels. */
  readonly prepare: (
    format: ExportContainer,
    encodingOptions: Readonly<Record<string, unknown>>,
    encode: (format: ExportContainer) => Promise<Uint8Array>,
    options?: { readonly pin?: boolean; readonly revision?: number },
  ) => Promise<PrepareOutcome>;
  readonly state: () => PreparedFileCacheState;
}

/** A byte-bounded prepared-file store over the contracts planner. */
export function preparedFiles(maxBytes: PreparedFileCacheMaxBytes, initialRevision = 0): PreparedFiles {
  let revision = initialRevision;
  let state: PreparedFileCacheState = EMPTY_PREPARED_FILE_CACHE;
  const files = new Map<string, PreparedFile>();
  const drop = (keys: readonly string[]) => keys.forEach((k) => files.delete(k));
  return {
    currentRevision: () => revision,
    setRevision(next) {
      if (next === revision) return;
      revision = next;
      drop([...files.keys()]);
      state = EMPTY_PREPARED_FILE_CACHE;
    },
    state: () => state,
    async prepare(format, encodingOptions, encode, options = {}) {
      const asked = options.revision ?? revision;
      const key = preparedFileKey({ resultRevision: asked, format, encodingOptions });
      const cached = files.get(key);
      if (cached && lookupPreparedFile(state, key).status === 'ready') {
        state = touchCacheEntry(state, key);
        if (options.pin) state = pinCacheEntry(state, key);
        return { status: 'ready', file: cached, fromCache: true, retained: true };
      }
      const bytes = await encode(format);
      // The person moved on while the file was encoding: the result belongs to an old revision.
      if (asked !== revision) return { status: 'stale', resultRevision: asked, currentRevision: revision };
      const { mime, extension } = CONTAINER_TYPE[format];
      if (!typeMatchesBytes(bytes, { mime, filename: `file.${extension}` })) return { status: 'type-mismatch', format };
      const file: PreparedFile = { key, resultRevision: asked, format, mime, bytes };
      const plan = planCacheInsert(state, { key, bytes: bytes.length }, maxBytes, options.pin === true);
      state = plan.state;
      drop(plan.evicted);
      if (plan.retained) files.set(key, file);
      return { status: 'ready', file, fromCache: false, retained: plan.retained };
    },
  };
}
