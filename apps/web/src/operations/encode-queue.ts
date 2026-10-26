// The confirmed-crop encode queue (fm-d760, plan crop.queue.core): an ordered list of frozen crops encoded one
// e4e at a time over the package's `encode` and the confirmed-crop policy. fm-fy2.8 wires it into the bridge;
// face.batch renders tiles on top and must not reimplement slots, attempt identities or reference counting.
//
// - Slots keep click order (`enqueueConfirmedCrops`); attempts run from one FIFO, so completion order never
//   reorders anything. A retry or replacement appends its new attempt to the end of that FIFO.
// - One live encoder (MAX_LIVE_ENCODERS): the next attempt starts only after the previous encode has settled,
//   including an aborted one, so a cancel never overlaps two encoder loads.
// - Pixels are tab-only and reference counted: a queued slot holds its decoded source (shared between crops of
//   the same file), a started slot derives its encoder input once and drops the source, success drops the
//   derived input. Cancelled/failed slots keep what they hold, so Retry reuses the frozen ConfirmedCrop and the
//   derived input without a second derivation or any detector call. Nothing here touches OPFS, IndexedDB,
//   sessionStorage or localStorage; after a reload `afterReload` reports unfinished slots as lost.
// - Late results are discarded by slot revision: cancel, remove and replace bump it.
// - With a governor (operations/scheduler.ts), each attempt also holds a photo-encode permit while it runs.
import {
  deriveEncoderInput,
  type ConfirmedCrop,
  type EncodeResult,
  type EncoderInput,
  type LoadedEncoderCapability,
  type SourcePixels,
  type StageTimingEvent,
} from 'stylegan-js';
import type { ProviderContextId } from '../contracts/scheduler.ts';
import type { Governor, Lease } from './scheduler.ts';

/** The plan's "initially one e4e encode at a time"; raising it needs measured evidence and a plan change. */
export const MAX_LIVE_ENCODERS = 1;
/** What an unfinished slot reports after a reload: its pixels never left the tab. */
export const LOST_AFTER_RELOAD = 'lost; use Encode image';
/** Encoder sessions per streamed e4e (the manifest's 108-shard schedule), for progress totals. */
export const E4E_SESSIONS = 108;

export type SlotId = `slot-${number}`;
export type AttemptId = `${SlotId}.a${number}`;
export type SlotState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
/** Why an attempt failed: the encoder's typed invalidation kind, the crop derivation, or the provider. */
export type SlotFailureKind =
  | 'derivation'
  | 'unavailable'
  | 'local-asset'
  | 'schedule'
  | 'memory'
  | 'disposed'
  | 'error';
export type RetryRefusal = 'no-retained-pixels';

/** One confirmed crop and the decoded pixels it was confirmed on (shared by crops of one file). */
export interface QueuedCrop {
  readonly crop: ConfirmedCrop;
  readonly source: SourcePixels;
}

export type SlotProgress =
  /** The shared acquisition/preparation prefix: prepared once, reported inside every slot. */
  | { readonly phase: 'prepare'; readonly shared: true; readonly reused: boolean }
  | { readonly phase: 'permit' }
  | { readonly phase: 'derive'; readonly reused: boolean }
  | { readonly phase: 'encode'; readonly completed: number; readonly total: number };

interface SlotEventBase {
  readonly slotId: SlotId;
  readonly attemptId: AttemptId;
  readonly batchRevision: number;
}
export type SlotEvent =
  | (SlotEventBase & { readonly type: 'slot.queued'; readonly confirmedCropId: string })
  | (SlotEventBase & { readonly type: 'slot.started' })
  | (SlotEventBase & { readonly type: 'slot.progress'; readonly progress: SlotProgress })
  | (SlotEventBase & { readonly type: 'slot.succeeded'; readonly result: EncodeResult })
  | (SlotEventBase & {
      readonly type: 'slot.failed';
      readonly kind: SlotFailureKind;
      readonly message: string;
      /** The error the attempt failed with, for a caller that rethrows its own typed error. */
      readonly cause: unknown;
    })
  | (SlotEventBase & { readonly type: 'slot.cancelled' })
  | (SlotEventBase & { readonly type: 'slot.released'; readonly pixels: 'source' | 'derived' });

/** What a slot looks like without its pixels: safe to keep in session state across a reload. */
export interface SlotSnapshot {
  readonly slotId: SlotId;
  readonly batchRevision: number;
  readonly confirmedCropId: string;
  readonly state: SlotState;
  readonly attemptId: AttemptId;
  readonly failure?: SlotFailureKind;
}
export type ReloadedSlot =
  | (SlotSnapshot & { readonly state: 'succeeded'; readonly retry: false })
  | (Omit<SlotSnapshot, 'state'> & {
      readonly state: 'lost';
      readonly message: typeof LOST_AFTER_RELOAD;
      readonly retry: false;
    });

/**
 * After a reload no pixels exist: a finished slot stays finished (its latent lives in the app's own state),
 * every other slot is lost and never offers Retry.
 */
export function afterReload(slots: readonly SlotSnapshot[]): readonly ReloadedSlot[] {
  return slots.map((s) =>
    s.state === 'succeeded'
      ? { ...s, state: 'succeeded', retry: false }
      : { ...s, state: 'lost', message: LOST_AFTER_RELOAD, retry: false },
  );
}

export interface EncodeQueueOptions {
  /** The loaded encoder, or the shared preparation that loads it once (retried after a failure). */
  readonly encoder: LoadedEncoderCapability | (() => Promise<LoadedEncoderCapability>);
  /** The confirmed-crop policy's single derivation (default deriveEncoderInput). */
  readonly derive?: (source: SourcePixels, crop: ConfirmedCrop) => EncoderInput;
  /** The operation controller's governor: each attempt holds a photo-encode permit while it runs. */
  readonly governor?: Pick<Governor, 'request' | 'withdraw'>;
  readonly context?: ProviderContextId;
  /** Residency the encoder holds while running, for the governor (default the 256 MiB encoder heap). */
  readonly residentBytes?: number;
}

export interface EncodeQueueInspection {
  readonly liveEncoders: number;
  readonly maxLiveEncoders: number;
  readonly derivations: number;
  readonly pending: readonly AttemptId[];
  readonly running: AttemptId | null;
  readonly sources: number;
}

interface Slot {
  readonly id: SlotId;
  readonly batchRevision: number;
  crop: ConfirmedCrop;
  source: SourcePixels | null;
  derived: EncoderInput | null;
  state: SlotState;
  attempts: number;
  attemptId: AttemptId;
  revision: number;
  failure?: SlotFailureKind;
  result?: EncodeResult;
  abort?: AbortController;
}
interface Attempt {
  readonly slot: Slot;
  readonly attemptId: AttemptId;
  readonly revision: number;
}

const failureOf = (error: unknown): SlotFailureKind => {
  const e = error as { name?: string; kind?: string } | null;
  if (e?.name === 'CropDerivationError') return 'derivation';
  if (e?.name === 'CapabilityUnavailable') return 'unavailable';
  const kind = e?.kind;
  return kind === 'local-asset' || kind === 'schedule' || kind === 'memory' || kind === 'disposed'
    ? kind
    : 'error';
};

export function createEncodeQueue(options: EncodeQueueOptions) {
  const derive = options.derive ?? deriveEncoderInput;
  const context = options.context ?? 'cpu:e4e';
  const residentBytes = options.residentBytes ?? 256 * 1024 * 1024;
  const listeners = new Set<(event: SlotEvent) => void>();
  const slots = new Map<SlotId, Slot>();
  const order: SlotId[] = [];
  const pending: Attempt[] = [];
  const sourceRefs = new Map<SourcePixels, number>();
  let nextSlot = 0;
  let live = 0;
  let maxLive = 0;
  let derivations = 0;
  let running: Attempt | null = null;
  let pumping = false;
  let prepared: Promise<LoadedEncoderCapability> | null =
    typeof options.encoder === 'function' ? null : Promise.resolve(options.encoder);
  let preparedOnce = prepared !== null;

  const emit = (event: SlotEvent) => {
    for (const listener of listeners) listener(event);
  };
  const base = (slot: Slot, attemptId = slot.attemptId): SlotEventBase => ({
    slotId: slot.id,
    attemptId,
    batchRevision: slot.batchRevision,
  });

  function holdSource(source: SourcePixels): void {
    sourceRefs.set(source, (sourceRefs.get(source) ?? 0) + 1);
  }
  function releaseSource(slot: Slot): void {
    const source = slot.source;
    if (!source) return;
    slot.source = null;
    const refs = (sourceRefs.get(source) ?? 1) - 1;
    if (refs > 0) sourceRefs.set(source, refs);
    else sourceRefs.delete(source);
    emit({ type: 'slot.released', ...base(slot), pixels: 'source' });
  }
  function releaseDerived(slot: Slot): void {
    if (!slot.derived) return;
    slot.derived = null;
    emit({ type: 'slot.released', ...base(slot), pixels: 'derived' });
  }
  function releaseAll(slot: Slot): void {
    releaseSource(slot);
    releaseDerived(slot);
  }

  function newAttempt(slot: Slot): Attempt {
    slot.attempts++;
    slot.revision++;
    slot.attemptId = `${slot.id}.a${slot.attempts}`;
    slot.state = 'queued';
    delete slot.failure;
    delete slot.result;
    const attempt = { slot, attemptId: slot.attemptId, revision: slot.revision };
    pending.push(attempt);
    emit({ type: 'slot.queued', ...base(slot), confirmedCropId: slot.crop.confirmedCropId });
    kick();
    return attempt;
  }
  /** Stops whatever the slot has queued or running; its late result is discarded by revision. */
  function stop(slot: Slot): void {
    for (let i = pending.length - 1; i >= 0; i--)
      if (pending[i]!.slot === slot) pending.splice(i, 1);
    slot.revision++;
    slot.abort?.abort();
    if (running?.slot === slot) options.governor?.withdraw(running.attemptId);
  }

  function kick(): void {
    if (pumping) return;
    pumping = true;
    queueMicrotask(() => void pump());
  }
  async function pump(): Promise<void> {
    try {
      for (let next = pending.shift(); next; next = pending.shift()) await run(next);
    } finally {
      pumping = false;
    }
  }

  function prepare(): Promise<LoadedEncoderCapability> {
    if (!prepared) {
      const load = options.encoder as () => Promise<LoadedEncoderCapability>;
      prepared = load().then(
        (encoder) => {
          preparedOnce = true;
          return encoder;
        },
        (error: unknown) => {
          prepared = null;
          throw error;
        },
      );
    }
    return prepared;
  }

  async function run(attempt: Attempt): Promise<void> {
    const { slot, attemptId } = attempt;
    const current = () => slots.get(slot.id) === slot && slot.revision === attempt.revision;
    if (!current()) return;
    const abort = new AbortController();
    slot.abort = abort;
    slot.state = 'running';
    running = attempt;
    emit({ type: 'slot.started', ...base(slot, attemptId) });
    const progress = (p: SlotProgress) => {
      if (current()) emit({ type: 'slot.progress', ...base(slot, attemptId), progress: p });
    };
    let lease: Lease | undefined;
    let counted = false;
    try {
      if (options.governor) {
        progress({ phase: 'permit' });
        lease = await options.governor.request({
          id: attemptId,
          op: 'photo-encode',
          context,
          bytes: residentBytes,
          sessions: 1,
        });
        if (!current()) return;
      }
      progress({ phase: 'prepare', shared: true, reused: preparedOnce });
      const encoder = await prepare();
      if (!current()) return;
      const reused = slot.derived !== null;
      if (!slot.derived) {
        derivations++;
        slot.derived = derive(slot.source!, slot.crop);
        releaseSource(slot);
      }
      progress({ phase: 'derive', reused });
      lease?.phase('inference');
      live++;
      counted = true;
      maxLive = Math.max(maxLive, live);
      if (live > MAX_LIVE_ENCODERS) throw new Error('More than one live encoder');
      let runs = 0;
      const result = await encoder.encode(
        {
          ids: {
            requestId: attemptId,
            inputRevision: slot.batchRevision,
            attemptId: slot.attempts,
          },
          input: slot.derived,
          confirmedCropId: slot.crop.confirmedCropId,
        },
        abort.signal,
        (event: StageTimingEvent) => {
          if (event.stage === 'encoder-run')
            progress({ phase: 'encode', completed: ++runs, total: E4E_SESSIONS });
        },
      );
      if (!current()) return;
      slot.state = 'succeeded';
      slot.result = result;
      releaseAll(slot);
      emit({ type: 'slot.succeeded', ...base(slot, attemptId), result });
    } catch (error) {
      if (!current()) return;
      const kind = failureOf(error);
      slot.state = 'failed';
      slot.failure = kind;
      // A crop that cannot be derived never will be: nothing is retained, so Retry is refused.
      if (kind === 'derivation') releaseAll(slot);
      emit({
        type: 'slot.failed',
        ...base(slot, attemptId),
        kind,
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    } finally {
      if (counted) live--;
      if (slot.abort === abort) delete slot.abort;
      if (running === attempt) running = null;
      await lease?.settle();
    }
  }

  /** Drops the slot and its pixels; a running encode is aborted and its result discarded. */
  function removeSlot(slotId: SlotId): boolean {
    const slot = slots.get(slotId);
    if (!slot) return false;
    stop(slot);
    releaseAll(slot);
    slots.delete(slotId);
    order.splice(order.indexOf(slotId), 1);
    return true;
  }

  const snapshotOf = (slot: Slot): SlotSnapshot => ({
    slotId: slot.id,
    batchRevision: slot.batchRevision,
    confirmedCropId: slot.crop.confirmedCropId,
    state: slot.state,
    attemptId: slot.attemptId,
    ...(slot.failure ? { failure: slot.failure } : {}),
  });

  return {
    /** One slot per crop, in click order; the queue starts at once. */
    enqueueConfirmedCrops(batchRevision: number, crops: readonly QueuedCrop[]): SlotId[] {
      if (!Number.isSafeInteger(batchRevision) || batchRevision < 0)
        throw new RangeError('batchRevision is a non-negative integer');
      return crops.map(({ crop, source }) => {
        const id: SlotId = `slot-${++nextSlot}`;
        const slot: Slot = {
          id,
          batchRevision,
          crop,
          source,
          derived: null,
          state: 'queued',
          attempts: 0,
          attemptId: `${id}.a0`,
          revision: 0,
        };
        holdSource(source);
        slots.set(id, slot);
        order.push(id);
        newAttempt(slot);
        return id;
      });
    },
    /** Settles only this slot `cancelled`; queued siblings keep their order. Its pixels stay for Retry. */
    cancelSlot(slotId: SlotId): boolean {
      const slot = slots.get(slotId);
      if (!slot || (slot.state !== 'queued' && slot.state !== 'running')) return false;
      stop(slot);
      slot.state = 'cancelled';
      emit({ type: 'slot.cancelled', ...base(slot) });
      return true;
    },
    /** A new attempt for a cancelled/failed slot that still holds pixels, appended to the queue. */
    retrySlot(slotId: SlotId): AttemptId | RetryRefusal {
      const slot = slots.get(slotId);
      if (
        !slot ||
        (slot.state !== 'cancelled' && slot.state !== 'failed') ||
        (!slot.source && !slot.derived)
      )
        return 'no-retained-pixels';
      return newAttempt(slot).attemptId;
    },
    removeSlot,
    /** Same slot and position, a new frozen crop: old pixels released, a new attempt queued. */
    replaceSlot(slotId: SlotId, next: QueuedCrop): AttemptId | null {
      const slot = slots.get(slotId);
      if (!slot) return null;
      stop(slot);
      releaseAll(slot);
      slot.crop = next.crop;
      slot.source = next.source;
      holdSource(next.source);
      return newAttempt(slot).attemptId;
    },
    /** Removes every slot of that batch revision. */
    disposeBatch(batchRevision: number): number {
      const ids = order.filter((id) => slots.get(id)!.batchRevision === batchRevision);
      for (const id of ids) removeSlot(id);
      return ids.length;
    },
    subscribe(listener: (event: SlotEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Slots in click order, without pixels. */
    slots(): readonly SlotSnapshot[] {
      return order.map((id) => snapshotOf(slots.get(id)!));
    },
    result(slotId: SlotId): EncodeResult | undefined {
      return slots.get(slotId)?.result;
    },
    /** Resolves when nothing is queued or running. */
    async idle(): Promise<void> {
      while (pumping || pending.length) await new Promise((r) => setTimeout(r, 5));
    },
    /** Test-build hook: pixel buffers this slot holds (its source reference and its derived input). */
    pixelRefs(slotId: SlotId): number {
      const slot = slots.get(slotId);
      return slot ? Number(slot.source !== null) + Number(slot.derived !== null) : 0;
    },
    /** Test-build hook: slots holding this decoded source. */
    sourceRefs(source: SourcePixels): number {
      return sourceRefs.get(source) ?? 0;
    },
    inspect(): EncodeQueueInspection {
      return {
        liveEncoders: live,
        maxLiveEncoders: maxLive,
        derivations,
        pending: pending.map((a) => a.attemptId),
        running: running?.attemptId ?? null,
        sources: sourceRefs.size,
      };
    },
  };
}
export type EncodeQueue = ReturnType<typeof createEncodeQueue>;
