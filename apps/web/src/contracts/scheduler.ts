// The app scheduler: one governor for photo encodes, face synthesis and morph production, because per-slot
// queues cannot bound aggregate memory. One heavyweight operation per shared provider context, with bounded
// frame pipelining and qualified warm reuse inside it. Admission covers runtime init, model/session loading
// and canary execution; idle warm memory counts until released. Waiting jobs hold no resources the active job
// needs; speculative warmup never evicts foreground live resources.
//
// The types are the contract; `schedule` is a pure reference model of the admission rules, so the walkthroughs
// in test/contracts run as plain-value tests. The operation controller implements the real scheduler.

import type { AssetLease } from '@facemorph/browser-model-manager';
import type { ComputeRoute } from '@facemorph/stylegan-js';

export const MAX_HEAVY_OPS_PER_PROVIDER_CONTEXT = 1;
/** One RGBA buffer of the largest accepted source (120 x 1024^2 pixels): 480 MiB. */
export const SOURCE_RGBA_MAX_BYTES = 120 * 1024 * 1024 * 4;

export type ProviderContextId = `${ComputeRoute}:${string}`;
export type HeavyOp = 'photo-encode' | 'face-synthesis' | 'morph-frames';
/** What a heavy op needs resident: the photo encoder or the generator (never both at once). */
export type Residency = 'encoder' | 'generator';
export const RESIDENCY_OF: { readonly [O in HeavyOp]: Residency } = Object.freeze({
  'photo-encode': 'encoder',
  'face-synthesis': 'generator',
  'morph-frames': 'generator',
});

export interface ComputePermit {
  readonly context: ProviderContextId;
  readonly jobId: string;
}

/** Reserved before anything is allocated: sessions, shard buffers, WASM heaps and GPU allocations. */
export interface ResidencyReservation {
  readonly jobId: string;
  readonly residency: Residency;
  readonly sessions: number;
  readonly shardBufferBytes: number;
  readonly wasmHeapBytes: number;
  readonly gpuBytes: number;
}

export interface AssetLeaseRef {
  readonly jobId: string;
  readonly lease: AssetLease;
}

export type CapabilityStatus = 'available' | 'busy' | 'unavailable';

/** Constrained (iPhone) or unknown-memory devices terminate alignment/encoder workers before the next heavy
 * phase: releasing an ONNX session does not shrink its WASM heap. Ample memory keeps qualified warm reuse. */
export interface ConstrainedTeardownPolicy {
  readonly memory: 'constrained' | 'unknown' | 'ample';
}
export const tearsDownBetweenPhases = (p: ConstrainedTeardownPolicy): boolean => p.memory !== 'ample';

/** The route and identities captured when Start/Download is approved; selector changes affect new jobs only. */
export interface RouteSnapshot {
  readonly requested: 'auto' | ComputeRoute;
  readonly fallbackScope: 'none' | 'cpu-once';
  readonly runtimeSha256: string;
  readonly modelSha256: string;
  /** Filled when the job runs. */
  readonly actual?: ComputeRoute;
}

/** From the contracts ceilings; the classic 4,096-frame value until measured. Faces are never truncated. */
export interface FrameBudget {
  readonly maxFrames: number;
  readonly source: 'classic-4096' | 'ceilings';
}

export type RecoveryAction = 'retry' | 'retry-on-cpu' | 'choose-another-photo' | 'approve-download' | 'remove-face';

export type IntentSettlement =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly recovery: RecoveryAction; readonly slot?: string };

export interface Job {
  readonly id: string;
  readonly slot: string;
  readonly revision: number;
  readonly op: HeavyOp;
  readonly context: ProviderContextId;
  /** Who wants it: explicit requests and/or morph intents. Empty owners cancel the job. */
  readonly owners: readonly string[];
}

/** Morph production waiting on its faces: holds no permit while it waits for dependencies or consent. */
export interface MorphParentIntent {
  readonly id: string;
  readonly slots: readonly string[];
  /** Each slot's input revision when the morph was asked for: its face jobs are for exactly these inputs. */
  readonly revisions: Readonly<Record<string, number>>;
  readonly context: ProviderContextId;
  readonly state: 'awaiting-dependencies' | 'awaiting-consent' | 'queued' | 'producing' | 'settled';
  readonly settlement?: IntentSettlement;
  readonly permit: null | ComputePermit;
}

export interface ContextState {
  readonly capability: CapabilityStatus;
  readonly active: Job | null;
  /** What is resident and idle (warm), counted against memory until released. */
  readonly warm: Residency | null;
  readonly loading: boolean;
}

export interface SchedulerState {
  readonly policy: ConstrainedTeardownPolicy;
  readonly contexts: { readonly [id: ProviderContextId]: ContextState };
  readonly queue: readonly Job[];
  readonly intents: readonly MorphParentIntent[];
  /** Slots whose face is compute-ready (a morph joins on compute-ready, not file-complete). */
  readonly ready: readonly string[];
  readonly reservations: readonly ResidencyReservation[];
}

export type SchedulerEvent =
  | { readonly type: 'request'; readonly job: Omit<Job, 'owners'>; readonly owner: string }
  | { readonly type: 'request-morph'; readonly intent: string; readonly slots: readonly string[]; readonly revisions: Readonly<Record<string, number>>; readonly context: ProviderContextId; readonly consent: boolean }
  | { readonly type: 'consent'; readonly intent: string }
  | { readonly type: 'complete'; readonly jobId: string }
  | { readonly type: 'cancel'; readonly owner: string }
  | { readonly type: 'capability'; readonly context: ProviderContextId; readonly status: CapabilityStatus }
  | { readonly type: 'provider-load'; readonly context: ProviderContextId };

export type SchedulerAction =
  | { readonly type: 'release-warm'; readonly context: ProviderContextId; readonly residency: Residency }
  | { readonly type: 'terminate-workers'; readonly context: ProviderContextId }
  | { readonly type: 'reuse-warm'; readonly context: ProviderContextId; readonly residency: Residency }
  | { readonly type: 'reserve'; readonly reservation: ResidencyReservation }
  | { readonly type: 'grant-permit'; readonly permit: ComputePermit }
  | { readonly type: 'start-load'; readonly context: ProviderContextId }
  | { readonly type: 'join-load'; readonly context: ProviderContextId }
  | { readonly type: 'cancel-job'; readonly jobId: string }
  | { readonly type: 'settle-intent'; readonly intent: string; readonly settlement: IntentSettlement };

const reservationFor = (job: Job): ResidencyReservation => ({
  jobId: job.id,
  residency: RESIDENCY_OF[job.op],
  sessions: 1,
  shardBufferBytes: 0,
  wasmHeapBytes: 0,
  gpuBytes: 0,
});

function admit(state: SchedulerState, actions: SchedulerAction[]): SchedulerState {
  let s = state;
  for (const context of Object.keys(s.contexts) as ProviderContextId[]) {
    const c = s.contexts[context]!;
    if (c.active || c.capability !== 'available') continue;
    const next = s.queue.find((j) => j.context === context);
    if (!next) continue;
    const needs = RESIDENCY_OF[next.op];
    if (c.warm && c.warm !== needs) {
      // Encoder and generator never overlap: the idle one goes before the next is reserved.
      actions.push({ type: 'release-warm', context, residency: c.warm });
      if (tearsDownBetweenPhases(s.policy)) actions.push({ type: 'terminate-workers', context });
    } else if (c.warm === needs) actions.push({ type: 'reuse-warm', context, residency: needs });
    const reservation = reservationFor(next);
    actions.push({ type: 'reserve', reservation }, { type: 'grant-permit', permit: { context, jobId: next.id } });
    s = {
      ...s,
      queue: s.queue.filter((j) => j !== next),
      reservations: [...s.reservations, reservation],
      contexts: { ...s.contexts, [context]: { ...c, active: next, warm: null } },
      intents: s.intents.map((i) => (i.state === 'queued' && next.op === 'morph-frames' && next.owners.includes(i.id) ? { ...i, state: 'producing', permit: { context, jobId: next.id } } : i)),
    };
  }
  return s;
}

/** Queues the faces an intent still needs (joining any queued or active job for the same slot and revision). */
function requestFaces(state: SchedulerState, intent: MorphParentIntent): SchedulerState {
  let s = state;
  for (const slot of intent.slots) {
    if (s.ready.includes(slot)) continue;
    const revision = intent.revisions[slot] ?? 0;
    const existing = [...s.queue, ...Object.values(s.contexts).map((c) => c.active)].find((j) => j && j.slot === slot && j.revision === revision && j.op === 'face-synthesis');
    if (existing) {
      s = { ...s, queue: s.queue.map((j) => (j === existing ? { ...j, owners: [...j.owners, intent.id] } : j)) };
    } else {
      s = { ...s, queue: [...s.queue, { id: `${intent.id}:${slot}`, slot, revision, op: 'face-synthesis', context: intent.context, owners: [intent.id] }] };
    }
  }
  return s;
}

function promoteIntents(state: SchedulerState): SchedulerState {
  let s = state;
  for (const i of s.intents) {
    if (i.state === 'awaiting-dependencies' && i.slots.every((slot) => s.ready.includes(slot))) {
      s = {
        ...s,
        intents: s.intents.map((x) => (x === i ? { ...x, state: 'queued' } : x)),
        queue: [...s.queue, { id: `${i.id}:frames`, slot: i.id, revision: 0, op: 'morph-frames', context: i.context, owners: [i.id] }],
      };
    }
  }
  return s;
}

/** One step of the reference model. */
export function schedule(state: SchedulerState, event: SchedulerEvent): { readonly state: SchedulerState; readonly actions: readonly SchedulerAction[] } {
  const actions: SchedulerAction[] = [];
  let s = state;
  switch (event.type) {
    case 'request': {
      const joined = [...s.queue, ...Object.values(s.contexts).map((c) => c.active)].find((j) => j && j.slot === event.job.slot && j.revision === event.job.revision && j.op === event.job.op);
      s = joined
        ? { ...s, queue: s.queue.map((j) => (j === joined ? { ...j, owners: [...j.owners, event.owner] } : j)) }
        : { ...s, queue: [...s.queue, { ...event.job, owners: [event.owner] }] };
      break;
    }
    case 'request-morph': {
      const intent: MorphParentIntent = { id: event.intent, slots: event.slots, revisions: event.revisions, context: event.context, state: event.consent ? 'awaiting-dependencies' : 'awaiting-consent', permit: null };
      s = { ...s, intents: [...s.intents, intent] };
      if (event.consent) s = requestFaces(s, intent);
      break;
    }
    case 'consent': {
      const i = s.intents.find((x) => x.id === event.intent && x.state === 'awaiting-consent');
      if (i) {
        const next: MorphParentIntent = { ...i, state: 'awaiting-dependencies' };
        s = requestFaces({ ...s, intents: s.intents.map((x) => (x === i ? next : x)) }, next);
      }
      break;
    }
    case 'complete': {
      const context = (Object.keys(s.contexts) as ProviderContextId[]).find((k) => s.contexts[k]!.active?.id === event.jobId);
      if (!context) break;
      const c = s.contexts[context]!;
      const job = c.active!;
      s = {
        ...s,
        reservations: s.reservations.filter((r) => r.jobId !== job.id),
        // Ample memory keeps the model warm for reuse; a constrained device releases it at once.
        contexts: { ...s.contexts, [context]: { ...c, active: null, warm: tearsDownBetweenPhases(s.policy) ? null : RESIDENCY_OF[job.op] } },
        ready: job.op === 'morph-frames' ? s.ready : [...s.ready, job.slot],
      };
      if (tearsDownBetweenPhases(s.policy)) actions.push({ type: 'terminate-workers', context });
      if (job.op === 'morph-frames') {
        for (const owner of job.owners) {
          actions.push({ type: 'settle-intent', intent: owner, settlement: { status: 'completed' } });
          s = { ...s, intents: s.intents.map((i) => (i.id === owner ? { ...i, state: 'settled', settlement: { status: 'completed' }, permit: null } : i)) };
        }
      }
      s = promoteIntents(s);
      break;
    }
    case 'cancel': {
      // Cancelling an owner detaches it; a job still wanted by another owner (an explicit face request) runs on.
      const detach = (j: Job): Job => ({ ...j, owners: j.owners.filter((o) => o !== event.owner) });
      const queue = s.queue.map(detach);
      for (const j of queue) if (j.owners.length === 0) actions.push({ type: 'cancel-job', jobId: j.id });
      s = { ...s, queue: queue.filter((j) => j.owners.length > 0) };
      for (const k of Object.keys(s.contexts) as ProviderContextId[]) {
        const active = s.contexts[k]!.active;
        if (active && active.owners.includes(event.owner)) {
          const left = detach(active);
          if (left.owners.length === 0) actions.push({ type: 'cancel-job', jobId: active.id });
          s = {
            ...s,
            reservations: left.owners.length === 0 ? s.reservations.filter((r) => r.jobId !== active.id) : s.reservations,
            contexts: { ...s.contexts, [k]: { ...s.contexts[k]!, active: left.owners.length === 0 ? null : left } },
          };
        }
      }
      if (s.intents.some((i) => i.id === event.owner && i.state !== 'settled')) {
        actions.push({ type: 'settle-intent', intent: event.owner, settlement: { status: 'cancelled' } });
        s = { ...s, intents: s.intents.map((i) => (i.id === event.owner ? { ...i, state: 'settled', settlement: { status: 'cancelled' }, permit: null } : i)) };
      }
      break;
    }
    case 'capability': {
      const c = s.contexts[event.context]!;
      s = { ...s, contexts: { ...s.contexts, [event.context]: { ...c, capability: event.status } } };
      if (event.status === 'unavailable') {
        // Queued work on a lost context settles with a specific recovery action rather than waiting forever.
        const lost = s.queue.filter((j) => j.context === event.context);
        for (const j of lost) actions.push({ type: 'cancel-job', jobId: j.id });
        const owners = new Set(lost.flatMap((j) => j.owners));
        s = { ...s, queue: s.queue.filter((j) => j.context !== event.context) };
        for (const i of s.intents) {
          if (owners.has(i.id) && i.state !== 'settled') {
            const settlement: IntentSettlement = { status: 'failed', recovery: 'retry-on-cpu' };
            actions.push({ type: 'settle-intent', intent: i.id, settlement });
            s = { ...s, intents: s.intents.map((x) => (x === i ? { ...x, state: 'settled', settlement, permit: null } : x)) };
          }
        }
      }
      break;
    }
    case 'provider-load': {
      const c = s.contexts[event.context]!;
      // Competing loads for one context share one load.
      actions.push({ type: c.loading ? 'join-load' : 'start-load', context: event.context });
      s = { ...s, contexts: { ...s.contexts, [event.context]: { ...c, loading: true } } };
      break;
    }
  }
  s = admit(s, actions);
  return { state: s, actions };
}

export function initialScheduler(contexts: readonly ProviderContextId[], policy: ConstrainedTeardownPolicy): SchedulerState {
  return {
    policy,
    contexts: Object.fromEntries(contexts.map((c) => [c, { capability: 'available', active: null, warm: null, loading: false }])),
    queue: [],
    intents: [],
    ready: [],
    reservations: [],
  };
}
