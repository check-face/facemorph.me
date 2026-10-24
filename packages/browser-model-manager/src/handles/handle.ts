// A loaded model handle (fm-ffn7, contracts/lifecycle.ts LoadedModelHandle): the engine capability plus the leases
// that keep its verified local bytes. The capability it hands out cannot acquire anything: it runs only what the
// adapter loaded from a VerifiedLocalReader. When any leased asset is invalidated, every pending operation settles
// at once as failed with the typed manager error, the adapter's sessions are disposed and the leases released; later
// calls fail the same way. Nothing is refetched: reacquisition and re-admission are the app's, outside the engine.
// release() does the same without an error: pending operations settle, then sessions and leases go.

import type {
  CancellationSignal,
  LoadedModelCapability,
  MappingRequest,
  MappingResult,
  StageTimingHook,
  SynthesisRequest,
  SynthesisResult,
} from '@facemorph/stylegan-js';
import type { ManagerError } from '../contracts/errors.ts';
import type { AssetLease, LeaseInvalidationCause } from '../contracts/leases.ts';
import type { LoadedModelHandle } from '../contracts/lifecycle.ts';
import type { LeaseRegistry } from './leases.ts';

/** Thrown by a handle's operations once it is invalidated or released; `error` is the structured manager error. */
export class HandleUnavailable extends Error {
  readonly error: ManagerError;
  constructor(error: ManagerError) {
    super(error.message);
    this.name = 'HandleUnavailable';
    this.error = error;
  }
}

export interface HandleState {
  readonly pending: number;
  readonly state: 'live' | 'invalidated' | 'released';
}

export function createLoadedHandle({
  manifestSha256,
  capability,
  assets,
  registry,
}: {
  manifestSha256: string;
  capability: LoadedModelCapability;
  assets: readonly { sha256: string; bytes: number }[];
  registry: LeaseRegistry;
}): LoadedModelHandle & { inspect(): HandleState } {
  let state: HandleState['state'] = 'live';
  let failure: ManagerError | null = null;
  const pending = new Set<(error: HandleUnavailable) => void>();
  const listeners: ((cause: LeaseInvalidationCause) => void)[] = [];
  let disposed: Promise<void> | null = null;
  const shutDown = () =>
    (disposed ??= capability.dispose().finally(() => leases.forEach((l) => l.release())));

  const holder = {
    invalidated(cause: LeaseInvalidationCause, error: ManagerError) {
      if (state !== 'live') return;
      state = 'invalidated';
      failure = error;
      for (const reject of pending) reject(new HandleUnavailable(error));
      pending.clear();
      // Either settlement rule (contracts/leases.ts) releases the sessions and leases: the asset is gone, so the
      // handle cannot run again; device and worker loss also leave nothing of the handle to reuse.
      void shutDown();
      for (const l of listeners) l(cause);
    },
  };
  const leases: AssetLease[] = registry.lease(assets, holder);

  const unavailable = (): HandleUnavailable =>
    new HandleUnavailable(
      failure ?? {
        code: 'invalidated',
        cause: 'worker-loss',
        message: 'the loaded handle was released',
      },
    );

  /** Runs an operation that settles early, as failed, if the handle is invalidated or released meanwhile. */
  function guard<T>(run: () => Promise<T>): Promise<T> {
    if (state !== 'live') return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      const settle = (e: HandleUnavailable) => reject(e);
      pending.add(settle);
      run().then(
        (v) => {
          if (!pending.delete(settle)) return; // already settled by invalidation or release
          resolve(v);
        },
        (e: unknown) => {
          if (!pending.delete(settle)) return;
          reject(e);
        },
      );
    });
  }

  const wrapped: LoadedModelCapability = {
    identity: capability.identity,
    latent: capability.latent,
    image: capability.image,
    provider: capability.provider,
    unsupported: capability.unsupported,
    map: (
      request: MappingRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<MappingResult> => guard(() => capability.map(request, signal, onTiming)),
    synthesize: (
      request: SynthesisRequest,
      signal?: CancellationSignal,
      onTiming?: StageTimingHook,
    ): Promise<SynthesisResult> => guard(() => capability.synthesize(request, signal, onTiming)),
    dispose: () => handle.release(),
  };

  const handle = {
    manifestSha256,
    capability: wrapped,
    leases,
    onInvalidated(listener: (cause: LeaseInvalidationCause) => void) {
      listeners.push(listener);
    },
    async release() {
      if (state === 'live') {
        state = 'released';
        const error = unavailable();
        for (const reject of pending) reject(error);
        pending.clear();
      }
      await shutDown();
    },
    inspect: (): HandleState => ({ pending: pending.size, state }),
  };
  return handle;
}
