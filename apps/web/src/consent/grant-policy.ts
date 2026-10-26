// The app's acquisition-grant policy (fm-qrfz): what a person approved the device to download, for which owners,
// and what each request may do next. It replaces the candidate's broad DownloadConsent set, where unknown
// inventory skipped gateScope and work started without a decision (audit defect 19).
//
// Pure: events and their timestamps are plain inputs, and every effect is returned, never performed. The manager
// supplies the grant shape and shared-fetch release (contracts/grant.ts); this module decides, coverage included.
//
// - An owner names one intent (a face press, a photo crop, early preparation). A new press is a new owner, so a
//   cancelled or declined owner's late continuation is refused, and manual continuation is a new request.
// - Unknown inventory or size is inspected within INSPECT_MS and, if still unknown, settles with Retry. It is never
//   permission to fetch, and a grant is never made for bytes nobody could count.
// - One decision groups everything a request lacks (a photo asks once for its detector and encoder). A request
//   that an approved grant already covers, or whose assets are verified locally, opens no decision. Assets outside
//   every grant, or a newly discovered cost, open a revised decision naming the grant it extends.
// - Cancel releases that owner everywhere. A shared fetch stops only when its last owner leaves; verified chunks
//   stay in the cache.
// - Approved fetches start at once, synthesis prerequisites first, so a face can be made while encoder bytes are
//   still transferring.
// - Assets only a descriptor names (the streamed encoder's shards) are asked for by their advertised size. The grant
//   keeps that many bytes as an allowance tied to the descriptor's digest: shards the verified descriptor names are
//   covered up to it, and anything beyond it is a new material cost, so a revised decision.
import {
  cancelOwner,
  type AcquisitionGrant,
  type AcquisitionPriority,
  type AssetInventory,
  type GrantOwnerId,
  type GrantPurpose,
  type SharedFetch,
} from '@facemorph/browser-model-manager';
import type { ComputeRoute } from '@facemorph/stylegan-js';

/** How long a bounded inventory inspection may take before the request settles with Retry. */
export const INSPECT_MS = 10_000;

declare const sha256Brand: unique symbol;
/** A checked lowercase hex SHA-256 digest. */
export type Sha256 = string & { readonly [sha256Brand]: true };
export const sha256Of = (hex: string): Sha256 | null =>
  /^[0-9a-f]{64}$/.test(hex) ? (hex as Sha256) : null;

export interface BoundedAsset {
  readonly sha256: Sha256;
  readonly bytes: number;
  readonly priority: AcquisitionPriority;
}
/** Bytes approved for assets a descriptor (`via`) will name once its verified bytes are read. */
export interface Allowance {
  readonly via: Sha256;
  readonly bytes: number;
  readonly priority: AcquisitionPriority;
}
declare const boundedBrand: unique symbol;
/** A grant the policy made: every asset has a digest and a size, and remainingBytes is their sum. */
export type BoundedGrant = AcquisitionGrant & {
  readonly id: number;
  readonly assets: readonly BoundedAsset[];
  /** What is left of each descriptor's advertised bytes; spent as its named assets are admitted. */
  readonly allowances: readonly Allowance[];
  readonly [boundedBrand]: true;
};

/**
 * The only way to make a grant: at least one asset, each with its digest and byte size, and at least one owner.
 * The approved byte scope is the assets' total plus any descriptor allowances; the grant never covers more.
 */
export function makeGrant(input: {
  readonly id: number;
  readonly manifestSha256: string;
  readonly route: ComputeRoute;
  readonly purpose: GrantPurpose;
  readonly assets: readonly [BoundedAsset, ...BoundedAsset[]];
  readonly owners: readonly [GrantOwnerId, ...GrantOwnerId[]];
  readonly allowances?: readonly Allowance[];
}): BoundedGrant {
  const allowances = input.allowances ?? [];
  for (const a of [...input.assets, ...allowances])
    if (!Number.isSafeInteger(a.bytes) || a.bytes < 0)
      throw RangeError(`asset ${('sha256' in a ? a.sha256 : a.via).slice(0, 12)} has no byte size`);
  for (const a of allowances)
    if (!input.assets.some((x) => x.sha256 === a.via))
      throw RangeError(`allowance ${a.via.slice(0, 12)} names no descriptor in the grant`);
  return {
    ...input,
    allowances,
    remainingBytes: [...input.assets, ...allowances].reduce((n, a) => n + a.bytes, 0),
  } as unknown as BoundedGrant;
}

/** One asset a request needs, as the manager's inventory last reported it; bytes is null when unknown. */
export interface NeededAsset {
  readonly sha256: Sha256;
  readonly bytes: number | null;
  readonly priority: AcquisitionPriority;
  readonly inventory: AssetInventory;
  /** The descriptor whose verified bytes named this asset, when it was not in the manifest itself. */
  readonly via?: Sha256;
}
export interface Request {
  readonly owner: GrantOwnerId;
  readonly purpose: GrantPurpose;
  readonly manifestSha256: string;
  readonly route: ComputeRoute;
  readonly assets: readonly NeededAsset[];
  /** Assets a descriptor among `assets` will name, by their advertised size (photoAssets' estimated case). */
  readonly discovers?: Allowance;
}
/** What the person is asked: every missing asset of the grouped owners, with its size. */
export interface Decision {
  readonly id: number;
  readonly owners: readonly GrantOwnerId[];
  readonly purpose: GrantPurpose;
  readonly manifestSha256: string;
  readonly route: ComputeRoute;
  /** Everything the owners lack, so the grant covers them whoever else leaves; fetches still dedupe by digest. */
  readonly assets: readonly BoundedAsset[];
  /** Assets a descriptor will name, shown by their advertised size and included in `bytes`. */
  readonly discovers: Allowance | null;
  readonly bytes: number;
  /** The part of `bytes` no approved grant already covers: what this decision newly asks for. */
  readonly extraBytes: number;
  /** The grant this decision would extend: more scope always needs a revised decision. */
  readonly revises: number | null;
}

export type Effect =
  | {
      readonly type: 'inspect';
      readonly owner: GrantOwnerId;
      readonly assets: readonly Sha256[];
      readonly until: number;
    }
  | { readonly type: 'ask'; readonly decision: Decision }
  | { readonly type: 'proceed'; readonly owner: GrantOwnerId }
  | {
      readonly type: 'fetch';
      readonly sha256: Sha256;
      readonly bytes: number;
      readonly priority: AcquisitionPriority;
      readonly owners: readonly GrantOwnerId[];
    }
  | { readonly type: 'stop'; readonly sha256: Sha256 }
  | { readonly type: 'retry'; readonly owner: GrantOwnerId; readonly reason: 'inventory-unknown' }
  | { readonly type: 'abandon'; readonly owner: GrantOwnerId }
  | { readonly type: 'refuse'; readonly owner: GrantOwnerId; readonly reason: 'abandoned' };

export type Event =
  | { readonly type: 'request'; readonly request: Request; readonly at: number }
  | {
      readonly type: 'inspected';
      readonly owner: GrantOwnerId;
      readonly assets: readonly NeededAsset[];
      readonly at: number;
    }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'approve'; readonly decision: number; readonly at: number }
  | { readonly type: 'decline'; readonly decision: number; readonly at: number }
  | { readonly type: 'cancel'; readonly owner: GrantOwnerId; readonly at: number }
  /** A deferred stage or retry of an owner already admitted; it may also report newly discovered assets. */
  | { readonly type: 'continue'; readonly request: Request; readonly at: number };

export interface PolicyState {
  readonly next: number;
  readonly inspecting: ReadonlyMap<
    GrantOwnerId,
    { readonly request: Request; readonly until: number }
  >;
  readonly open: ReadonlyMap<number, Decision>;
  readonly grants: readonly BoundedGrant[];
  readonly fetches: readonly SharedFetch[];
  /** Owners whose intent was cancelled or declined: their continuations are refused. */
  readonly abandoned: ReadonlySet<GrantOwnerId>;
  /** Owners admitted (proceeding, approved or fetching), so a continuation is recognised. */
  readonly admitted: ReadonlySet<GrantOwnerId>;
}
export const initialPolicy: PolicyState = {
  next: 1,
  inspecting: new Map(),
  open: new Map(),
  grants: [],
  fetches: [],
  abandoned: new Set(),
  admitted: new Set(),
};

// Fetch order: a face can be made first, the small detector arrives promptly, and the rest of what the action
// needs (the encoder) transfers while the person chooses and crops; optional and warming work comes last.
const RANK: Record<AcquisitionPriority, number> = {
  'synthesis-prerequisite': 0,
  'detector-prerequisite': 1,
  'foreground-required': 2,
  optional: 3,
  'speculative-warming': 4,
};
const bySynthesisFirst = <T extends { readonly priority: AcquisitionPriority }>(
  xs: readonly T[],
): T[] => [...xs].sort((a, b) => RANK[a.priority] - RANK[b.priority]);

const withSet = <T>(s: ReadonlySet<T>, v: T): ReadonlySet<T> => new Set(s).add(v);
const without = <K, V>(m: ReadonlyMap<K, V>, k: K): ReadonlyMap<K, V> => {
  const n = new Map(m);
  n.delete(k);
  return n;
};

/** Adds `owners` to the fetch of each asset (one fetch per digest) and returns fetch effects for new ones. */
function startFetches(
  fetches: readonly SharedFetch[],
  assets: readonly BoundedAsset[],
  owners: readonly GrantOwnerId[],
): { readonly fetches: readonly SharedFetch[]; readonly effects: readonly Effect[] } {
  const next = fetches.map((f) => ({ sha256: f.sha256, owners: [...f.owners] }));
  const effects: Effect[] = [];
  for (const a of bySynthesisFirst(assets)) {
    const existing = next.find((f) => f.sha256 === a.sha256);
    if (existing) {
      for (const o of owners) if (!existing.owners.includes(o)) existing.owners.push(o);
      continue;
    }
    next.push({ sha256: a.sha256, owners: [...owners] });
    effects.push({
      type: 'fetch',
      sha256: a.sha256,
      bytes: a.bytes,
      priority: a.priority,
      owners: [...owners],
    });
  }
  return { fetches: next, effects };
}

/**
 * `grant` extended to cover `missing`, or null: each asset is in the grant at the same size, or a descriptor the grant
 * holds an allowance for named it and the allowance still has room. The approved total never grows.
 */
function cover(
  grant: BoundedGrant,
  missing: readonly (BoundedAsset & { readonly via?: Sha256 })[],
): BoundedGrant | null {
  const granted = new Map(grant.assets.map((a) => [a.sha256, a.bytes]));
  const left = new Map(grant.allowances.map((a) => [a.via, a.bytes]));
  const added: BoundedAsset[] = [];
  for (const a of missing) {
    const size = granted.get(a.sha256);
    if (size !== undefined) {
      if (size !== a.bytes) return null;
      continue;
    }
    const room = a.via === undefined ? undefined : left.get(a.via);
    if (room === undefined || room < a.bytes) return null;
    left.set(a.via!, room - a.bytes);
    granted.set(a.sha256, a.bytes);
    added.push({ sha256: a.sha256, bytes: a.bytes, priority: a.priority });
  }
  if (!added.length) return grant;
  return {
    ...grant,
    assets: [...grant.assets, ...added],
    allowances: grant.allowances.map((a) => ({ ...a, bytes: left.get(a.via) ?? a.bytes })),
  } as BoundedGrant;
}

/** Admits a request whose inventory is known: proceed, join a covering grant, or ask (revised if it extends one). */
function admit(
  state: PolicyState,
  request: Request,
  at: number,
): readonly [PolicyState, readonly Effect[]] {
  const unknown = request.assets.filter((a) => a.inventory === 'unknown' || a.bytes === null);
  if (unknown.length) {
    const until = at + INSPECT_MS;
    return [
      { ...state, inspecting: new Map(state.inspecting).set(request.owner, { request, until }) },
      [{ type: 'inspect', owner: request.owner, assets: unknown.map((a) => a.sha256), until }],
    ];
  }
  const missing = request.assets
    .filter((a) => a.inventory !== 'verified-local')
    .map((a) => ({
      sha256: a.sha256,
      bytes: a.bytes as number,
      priority: a.priority,
      ...(a.via ? { via: a.via } : {}),
    }));
  const admitted = withSet(state.admitted, request.owner);
  if (!missing.length && !request.discovers)
    return [{ ...state, admitted }, [{ type: 'proceed', owner: request.owner }]];
  const same = state.grants.filter(
    (g) => g.manifestSha256 === request.manifestSha256 && g.route === request.route,
  );
  let covering: BoundedGrant | null = null;
  let extended: BoundedGrant | null = null;
  for (const g of same) {
    extended = request.discovers ? null : cover(g, missing);
    if (extended) {
      covering = g;
      break;
    }
  }
  if (covering && extended) {
    const grown = extended.owners.includes(request.owner)
      ? extended
      : ({ ...extended, owners: [...extended.owners, request.owner] } as BoundedGrant);
    const grants = state.grants.map((g) => (g === covering ? grown : g));
    const started = startFetches(state.fetches, missing, [request.owner]);
    return [
      { ...state, grants, fetches: started.fetches, admitted },
      [...started.effects, { type: 'proceed', owner: request.owner }],
    ];
  }
  // Ask once for everything missing; a grant it partly overlaps is revised, and only the rest is new to the person.
  const granted = new Set(same.flatMap((g) => g.assets.map((a) => a.sha256)));
  const advertised = request.discovers?.bytes ?? 0;
  const assets = bySynthesisFirst(missing).map(({ sha256, bytes, priority }) => ({
    sha256,
    bytes,
    priority,
  }));
  const decision: Decision = {
    id: state.next,
    owners: [request.owner],
    purpose: request.purpose,
    manifestSha256: request.manifestSha256,
    route: request.route,
    assets,
    discovers: request.discovers ?? null,
    bytes: assets.reduce((n, a) => n + a.bytes, 0) + advertised,
    extraBytes:
      assets.filter((a) => !granted.has(a.sha256)).reduce((n, a) => n + a.bytes, 0) + advertised,
    revises: same.length ? same[same.length - 1]!.id : null,
  };
  return [
    { ...state, next: state.next + 1, open: new Map(state.open).set(decision.id, decision) },
    [{ type: 'ask', decision }],
  ];
}

function cancel(
  state: PolicyState,
  owner: GrantOwnerId,
): readonly [PolicyState, readonly Effect[]] {
  const open = new Map<number, Decision>();
  for (const [id, d] of state.open) {
    const owners = d.owners.filter((o) => o !== owner);
    if (owners.length) open.set(id, { ...d, owners });
  }
  const grants = state.grants
    .map((g) => ({ ...g, owners: g.owners.filter((o) => o !== owner) }) as BoundedGrant)
    .filter((g) => g.owners.length);
  const released = cancelOwner(state.fetches, owner);
  const admitted = new Set(state.admitted);
  admitted.delete(owner);
  return [
    {
      ...state,
      inspecting: without(state.inspecting, owner),
      open,
      grants,
      fetches: released.continuing,
      abandoned: withSet(state.abandoned, owner),
      admitted,
    },
    [
      ...released.stopped.map((sha256): Effect => ({ type: 'stop', sha256: sha256 as Sha256 })),
      { type: 'abandon', owner },
    ],
  ];
}

export function step(state: PolicyState, event: Event): readonly [PolicyState, readonly Effect[]] {
  switch (event.type) {
    case 'request':
      if (state.abandoned.has(event.request.owner))
        return [state, [{ type: 'refuse', owner: event.request.owner, reason: 'abandoned' }]];
      return admit(state, event.request, event.at);
    case 'continue': {
      const { owner } = event.request;
      if (state.abandoned.has(owner) || !state.admitted.has(owner))
        return [state, [{ type: 'refuse', owner, reason: 'abandoned' }]];
      return admit(state, event.request, event.at);
    }
    case 'inspected': {
      const pending = state.inspecting.get(event.owner);
      if (!pending) return [state, []]; // cancelled during inspection, or already settled
      const inspecting = without(state.inspecting, event.owner);
      const sizes = new Map(event.assets.map((a) => [a.sha256, a]));
      const request = {
        ...pending.request,
        assets: pending.request.assets.map((a) => sizes.get(a.sha256) ?? a),
      };
      if (request.assets.some((a) => a.inventory === 'unknown' || a.bytes === null))
        return [
          { ...state, inspecting },
          [{ type: 'retry', owner: event.owner, reason: 'inventory-unknown' }],
        ];
      return admit({ ...state, inspecting }, request, event.at);
    }
    case 'tick': {
      const late = [...state.inspecting].filter(([, p]) => event.at >= p.until).map(([o]) => o);
      if (!late.length) return [state, []];
      let inspecting = state.inspecting;
      for (const o of late) inspecting = without(inspecting, o);
      return [
        { ...state, inspecting },
        late.map((owner): Effect => ({ type: 'retry', owner, reason: 'inventory-unknown' })),
      ];
    }
    case 'approve': {
      const d = state.open.get(event.decision);
      if (!d || !d.owners.length) return [state, []];
      const [first, ...rest] = d.assets;
      const [owner, ...others] = d.owners;
      if (!first || !owner) return [{ ...state, open: without(state.open, d.id) }, []];
      const grant = makeGrant({
        id: d.id,
        manifestSha256: d.manifestSha256,
        route: d.route,
        purpose: d.purpose,
        assets: [first, ...rest],
        owners: [owner, ...others],
        ...(d.discovers ? { allowances: [d.discovers] } : {}),
      });
      const started = startFetches(state.fetches, d.assets, d.owners);
      let admitted = state.admitted;
      for (const o of d.owners) admitted = withSet(admitted, o);
      return [
        {
          ...state,
          open: without(state.open, d.id),
          grants: [...state.grants, grant],
          fetches: started.fetches,
          admitted,
        },
        [...started.effects, ...d.owners.map((o): Effect => ({ type: 'proceed', owner: o }))],
      ];
    }
    case 'decline': {
      const d = state.open.get(event.decision);
      if (!d) return [state, []];
      let next: PolicyState = { ...state, open: without(state.open, d.id) };
      const effects: Effect[] = [];
      for (const o of d.owners) {
        const [s, e] = cancel(next, o);
        next = s;
        effects.push(...e);
      }
      return [next, effects];
    }
    case 'cancel':
      return cancel(state, event.owner);
  }
}

/** Runs events in order from `state`; the effects in the order they were produced. */
export function run(
  events: readonly Event[],
  state: PolicyState = initialPolicy,
): readonly [PolicyState, readonly Effect[]] {
  const effects: Effect[] = [];
  for (const e of events) {
    const [s, out] = step(state, e);
    state = s;
    effects.push(...out);
  }
  return [state, effects];
}
