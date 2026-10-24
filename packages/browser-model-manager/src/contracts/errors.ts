// Manager errors: one discriminated union, structured-clone safe (no Error instances cross a worker).

export type ManagerErrorCode =
  | 'cache-miss'
  | 'corrupt'
  | 'evicted'
  | 'invalidated'
  | 'quota'
  | 'manifest-rejected'
  | 'unknown-status'
  | 'network';

export type ManagerError =
  | { readonly code: 'cache-miss'; readonly sha256: string; readonly message: string }
  | { readonly code: 'corrupt'; readonly sha256: string; readonly message: string }
  | { readonly code: 'evicted'; readonly sha256: string; readonly message: string }
  | { readonly code: 'invalidated'; readonly cause: import('./leases.ts').LeaseInvalidationCause; readonly message: string }
  | { readonly code: 'quota'; readonly requiredBytes: number; readonly message: string }
  | { readonly code: 'manifest-rejected'; readonly reason: import('./manifest.ts').ManifestErrorCode; readonly message: string }
  /** Cache or manifest state could not be read: bounded inspection or retry, never permission to fetch. */
  | { readonly code: 'unknown-status'; readonly retryable: true; readonly message: string }
  | { readonly code: 'network'; readonly retryable: boolean; readonly message: string };

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
