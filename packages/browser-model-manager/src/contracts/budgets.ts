// Acquisition budgets and live residency, as named fields. Numeric values arrive with contracts
// milestone 2's ceilings file; the candidate's two-chunk phone read-ahead is per worker and does not
// bound overlapping workers, so these budgets are aggregate across workers.

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
