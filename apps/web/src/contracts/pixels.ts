// Retry pixels: a pending, running or retryable photo's decoded pixels, reference counted per slot and
// released on success, remove, replace or disposal. Tab-only; never persisted.

export interface RetryPixelRef {
  readonly slot: string;
  readonly bytes: number;
  readonly holders: number;
  readonly persisted: false;
}

export function holdPixels(ref: RetryPixelRef | undefined, slot: string, bytes: number): RetryPixelRef {
  return ref ? { ...ref, holders: ref.holders + 1 } : { slot, bytes, holders: 1, persisted: false };
}

/** Releasing the last holder frees the pixels (undefined); `success`, `remove`, `replace` and `dispose` all release. */
export function releasePixels(ref: RetryPixelRef, _why: 'success' | 'remove' | 'replace' | 'dispose'): RetryPixelRef | undefined {
  return ref.holders > 1 ? { ...ref, holders: ref.holders - 1 } : undefined;
}
