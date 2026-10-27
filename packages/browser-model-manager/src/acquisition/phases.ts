// Download slots admit 2/4 chunks, but the frozen hash/write ceilings admit only one 16 MiB
// input at a time. These independent locks span the actual operation, across every cache,
// uncached acquisition and verified local read in this origin. Waiting bytes remain read-ahead;
// they never start a native digest or an OPFS commit before their phase has room.
import type { SlotLocks } from './slots.ts';

type Phase = 'hash' | 'write';
const localTails: Record<Phase, Promise<void>> = {
  hash: Promise.resolve(),
  write: Promise.resolve(),
};
const check = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Asset acquisition cancelled', 'AbortError');
};

/** Opaque origins without Web Locks still serialize operations within their realm. */
async function localPhase<T>(
  phase: Phase,
  run: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const previous = localTails[phase];
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  localTails[phase] = previous.then(() => done);
  let abort: (() => void) | undefined;
  try {
    await (signal
      ? Promise.race([
          previous,
          new Promise<never>((_resolve, reject) => {
            abort = () =>
              reject(
                signal.reason ?? new DOMException('Asset acquisition cancelled', 'AbortError'),
              );
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          }),
        ])
      : previous);
    check(signal);
    return await run();
  } finally {
    if (abort) signal!.removeEventListener('abort', abort);
    // A cancelled waiter stays behind its predecessor in the tail. Releasing it cannot let
    // a later operation bypass the predecessor while that operation is still running.
    release();
  }
}

export async function acquisitionPhase<T>(
  phase: Phase,
  run: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  check(signal);
  let entered = false;
  try {
    const locks = globalThis.navigator?.locks as SlotLocks | undefined;
    if (!locks) return localPhase(phase, run, signal);
    let value: T;
    await locks.request(
      `facemorph-acquisition:phase-${phase}`,
      signal ? { signal } : {},
      async () => {
        check(signal);
        entered = true;
        value = await run();
      },
    );
    return value!;
  } catch (error) {
    // Only a denied lock API falls back. A SecurityError from the operation itself must not
    // repeat a digest/write, and a cancelled queued request must never run through the fallback.
    check(signal);
    if (entered || (error as { name?: string })?.name !== 'SecurityError') throw error;
    return localPhase(phase, run, signal);
  }
}
