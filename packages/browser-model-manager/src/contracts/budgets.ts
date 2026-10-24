// Acquisition budgets and live residency, as named fields with their values (contracts milestone 2,
// fm-2o8q). The candidate's two-chunk phone read-ahead is per worker and does not bound overlapping
// workers, so these budgets are aggregate across workers: the per-worker candidate figure becomes the
// whole tab's figure. Values are carried from the candidate (classic a42829b); revising one is a
// contract revision, cited by the app's ceilings file.

import { E4E_MAX_WASM_BYTES } from './manifest.ts';

export interface AcquisitionBudget {
  /** Bytes this owner may transfer in total (its advertised remaining scope). */
  readonly transferBytes: number;
  /** Bytes fetched ahead of the writer, aggregate across workers. */
  readonly readAheadBytes: number;
  /** Bytes held while hashing. */
  readonly hashBytes: number;
  /** Bytes buffered before a storage write commits. */
  readonly writeBufferBytes: number;
}

export interface LiveResidencyLimit {
  /** Model bytes resident at once (encoder and synthesis never overlap; see ResidencyTransition). */
  readonly maxResidentBytes: number;
  readonly maxLiveSessions: number;
}

/** Largest manifest chunk (Assets/model-cache.mjs refuses a chunk part over 16 MiB). */
export const ACQUISITION_CHUNK_MAX_BYTES = 16 * 1024 * 1024;

/** How much memory the device reports; unknown is treated as constrained. */
export type AcquisitionMemoryClass = 'constrained-or-unknown' | 'ample';

/**
 * The fixed parts of an AcquisitionBudget per memory class. browser/ort-worker.mjs reads ahead 4 chunks
 * when `navigator.deviceMemory >= 8`, else 2; model-cache.mjs hashes one chunk at a time (sha256.mjs keeps
 * one chunk and a 64-byte block) and commits one unit per shard write.
 */
export const ACQUISITION_BUDGETS: {
  readonly [M in AcquisitionMemoryClass]: Omit<AcquisitionBudget, 'transferBytes'>;
} = Object.freeze({
  'constrained-or-unknown': Object.freeze({
    readAheadBytes: 2 * ACQUISITION_CHUNK_MAX_BYTES,
    hashBytes: ACQUISITION_CHUNK_MAX_BYTES + 64,
    writeBufferBytes: ACQUISITION_CHUNK_MAX_BYTES,
  }),
  ample: Object.freeze({
    readAheadBytes: 4 * ACQUISITION_CHUNK_MAX_BYTES,
    hashBytes: ACQUISITION_CHUNK_MAX_BYTES + 64,
    writeBufferBytes: ACQUISITION_CHUNK_MAX_BYTES,
  }),
});

/** The memory class from `navigator.deviceMemory` (GiB), as the candidate decides it. */
export function acquisitionMemoryClass(
  deviceMemoryGiB: number | undefined,
): AcquisitionMemoryClass {
  return deviceMemoryGiB !== undefined && deviceMemoryGiB >= 8 ? 'ample' : 'constrained-or-unknown';
}

/**
 * One owner's budget: the transfer is the bytes its consent grant still allows (never a constant), the
 * rest is the memory class's fixed figure.
 */
export function acquisitionBudget(
  memory: AcquisitionMemoryClass,
  grantRemainingBytes: number,
): AcquisitionBudget {
  if (!Number.isSafeInteger(grantRemainingBytes) || grantRemainingBytes < 0)
    throw new RangeError('grantRemainingBytes must be a non-negative integer byte count');
  return { transferBytes: grantRemainingBytes, ...ACQUISITION_BUDGETS[memory] };
}

/**
 * Aggregate live residency. Encoder and generator never overlap, so the bound is the larger of the two:
 * the qualified streamed encoder's 256 MiB unshared heap (maxWasmBytes), which also covers the
 * generator's mapping + synthesis bundle. Live sessions: mapping and synthesis (ort-worker.mjs) are the
 * most held at once; the encoder holds one of its 108 sessions at a time.
 */
export const LIVE_RESIDENCY_LIMIT: LiveResidencyLimit = Object.freeze({
  maxResidentBytes: E4E_MAX_WASM_BYTES,
  maxLiveSessions: 2,
});
