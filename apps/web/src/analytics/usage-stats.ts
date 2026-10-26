// Anonymous changeover statistics (PLAN.md "Changeover statistics in Grafana"), ported from the candidate's
// src/Next/usage-stats.mjs (candidate commit 551b607) with its event definitions unchanged.
//
// A second, first-party sink beside Google Analytics: the same product events, reduced to a closed vocabulary and
// bounded numbers, batched in memory and sent as one small same-origin beacon to /stats/v1, where the Worker in
// services/stats adds them to aggregate counters. No cookie, identifier, address or free text is sent or stored.
//
// Changing what an existing event means would silently break the before/after comparison: a new meaning needs a
// new event kind and metric name, never a redefinition. The three kinds the candidate did not send (job_warm,
// compute, model) are such new kinds; the Worker already accepts them.
//
// Opt-outs: production hosts only (this sink's own list, separate from where Google Analytics loads); off for
// Global Privacy Control, Do Not Track, Save-Data and automation (navigator.webdriver); off when localStorage
// 'facemorph-usage-stats' is 'off', or when the person turned the switch off in this tab and the choice could not
// be saved. It never throws into the product.
import { deviceProperties } from '../Next/analytics.mjs';

export const OPT_OUT_KEY = 'facemorph-usage-stats';
export const ENDPOINT = '/stats/v1';
/** The hosts this sink sends from. The Worker routes /stats/* on both. */
export const HOSTS: readonly string[] = ['next.facemorph.me', 'facemorph.me'];
/** Which build sent a beacon. The deployed Worker reads it as `app` (absent means the candidate). */
export const BUILD = 'monorepo';
export const FLUSH_AT = 150;
export const FLUSH_EVERY_MS = 60_000;
export const MAX_BYTES = 3800;
const MAX_MS = 3.6e6;

const ACTIONS: Readonly<Record<string, Action>> = {
  faces: 'face',
  face: 'face',
  morph: 'morph',
  photo: 'photo',
  names: 'names',
  blend: 'blend',
};
const ROUTES: Readonly<Record<string, Route>> = { cpu: 'cpu', webgpu: 'webgpu', auto: 'auto' };
const OUTCOMES = ['completed', 'cancelled', 'failed'] as const;

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';
export type Action = 'face' | 'photo' | 'morph' | 'names' | 'blend';
export type Route = 'cpu' | 'webgpu' | 'auto' | 'unknown';
export type Outcome = (typeof OUTCOMES)[number];

export type StatsEvent =
  | { t: 'visit'; platform: Platform; visit: 'first' | 'returning' }
  | {
      t: 'job';
      action: Action;
      route: Route;
      outcome: Outcome;
      platform: Platform;
      ms: number | undefined;
    }
  | { t: 'ttfr'; cache: 'warm' | 'cold'; platform: Platform; ms: number }
  | { t: 'frames'; platform: Platform; n: number }
  | { t: 'export'; kind: 'image' | 'video'; method: 'save' | 'share' }
  | { t: 'model_mb'; cache: 'cold'; platform: Platform; mb: number }
  | { t: 'job_warm'; action: Action; route: Route; platform: Platform; ms: number }
  | { t: 'compute'; action: Action; route: Route; platform: Platform; ms: number }
  | { t: 'model'; phase: 'download' | 'cache'; platform: Platform; ms: number };

/** The parts of a browser global the sink reads. Every one is optional: a worker or a test has fewer. */
export interface StatsEnv {
  readonly location?: { readonly hostname: string; readonly protocol: string } | undefined;
  readonly navigator?:
    | {
        readonly userAgent?: string;
        readonly webdriver?: boolean;
        readonly globalPrivacyControl?: boolean;
        readonly doNotTrack?: string | null;
        readonly connection?: { readonly saveData?: boolean };
        readonly sendBeacon?: (url: string, data: Blob) => boolean;
        readonly platform?: string;
        readonly maxTouchPoints?: number;
      }
    | undefined;
  readonly localStorage?:
    | {
        getItem(key: string): string | null;
        setItem?(key: string, value: string): void;
        removeItem?(key: string): void;
      }
    | undefined;
  readonly doNotTrack?: string | null | undefined;
  readonly document?:
    | {
        readonly visibilityState?: string;
        addEventListener?(name: string, fn: () => void): void;
      }
    | undefined;
  addEventListener?(name: string, fn: () => void): void;
  setTimeout?(fn: () => void, ms: number): unknown;
}

export interface Options {
  /** Only a test build sets this (FACEMORPH_STATS_ALLOW_AUTOMATION at build time); never the shipped site. */
  readonly allowAutomation?: boolean;
}

/** Why the page itself rules statistics out, before any switch; null when it does not. */
export type Block = 'host' | 'automation' | 'gpc' | 'dnt' | 'save-data';

/** The environment's own opt-outs, in the order a person would want them explained. Pure. */
export function environmentBlock(
  env: StatsEnv,
  { allowAutomation = false }: Options = {},
): Block | null {
  try {
    const nav = env.navigator;
    if (nav?.globalPrivacyControl === true) return 'gpc';
    if (nav?.doNotTrack === '1' || env.doNotTrack === '1') return 'dnt';
    if (nav?.connection?.saveData === true) return 'save-data';
    if (
      !env.location ||
      !HOSTS.includes(env.location.hostname) ||
      env.location.protocol !== 'https:'
    )
      return 'host';
    if (nav?.webdriver && !allowAutomation) return 'automation';
    return null;
  } catch {
    return 'host';
  }
}

/** Whether the stored switch is off. A storage that throws reads as on, as the candidate did. */
export function storedOff(env: StatsEnv): boolean {
  try {
    return env.localStorage?.getItem(OPT_OUT_KEY) === 'off';
  } catch {
    return false;
  }
}

/** Whether statistics may be recorded here at all (the candidate's rule plus the second production host). */
export function allowed(env: StatsEnv = globalThis as StatsEnv, options: Options = {}): boolean {
  return environmentBlock(env, options) === null && !storedOff(env);
}

export function platformClass(
  nav: StatsEnv['navigator'] = (globalThis as StatsEnv).navigator,
): Platform {
  const p = deviceProperties(nav as Navigator | undefined).platform;
  return p === 'ios' || p === 'android' ? p : p === 'other' ? 'unknown' : 'desktop';
}

const ms = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(Math.min(value, MAX_MS))
    : undefined;

type Data = Readonly<Record<string, unknown>>;

/** Maps one product event to a stats event, or null. Pure; the candidate's definitions, unchanged. */
export function toStatsEvent(kind: string, data: Data, platform: Platform): StatsEvent | null {
  if (kind === 'visit')
    return { t: 'visit', platform, visit: data['visit'] === 'returning' ? 'returning' : 'first' };
  if (kind === 'job') {
    const action = ACTIONS[String(data['action'])];
    const raw = data['outcome'] === 'interrupted' ? 'cancelled' : data['outcome'];
    const outcome = OUTCOMES.find((o) => o === raw);
    if (!action || !outcome) return null;
    return {
      t: 'job',
      action,
      route: ROUTES[String(data['route'])] ?? 'unknown',
      outcome,
      platform,
      ms: outcome === 'completed' ? ms(data['ms']) : undefined,
    };
  }
  if (kind === 'ttfr') {
    const value = ms(data['ms']);
    return value === undefined
      ? null
      : { t: 'ttfr', cache: data['cache'] === 'warm' ? 'warm' : 'cold', platform, ms: value };
  }
  if (kind === 'frames') {
    const n = data['n'];
    return typeof n === 'number' && Number.isFinite(n) && n > 0
      ? { t: 'frames', platform, n: Math.round(n) }
      : null;
  }
  if (kind === 'export') {
    const k = data['kind'],
      m = data['method'];
    return (k === 'image' || k === 'video') && (m === 'save' || m === 'share')
      ? { t: 'export', kind: k, method: m }
      : null;
  }
  if (kind === 'model_mb') {
    const mb = data['mb'];
    return typeof mb === 'number' && Number.isFinite(mb) && mb > 0
      ? { t: 'model_mb', cache: 'cold', platform, mb: Math.round(mb * 10) / 10 }
      : null;
  }
  return null;
}

// ---- the three like-for-like kinds (operator, 24 October 2026) ---------------------------------------------------

/** Stages that mean this job had to bring a model in: it was not run with the models already loaded. */
const LOADING_STAGES = new Set([
  'model-loading',
  'model-loaded',
  'encoder-loading',
  'encoder-loaded',
]);

/** What one running job has shown so far, from the runtime's own stages. */
export interface JobState {
  readonly action: string;
  loaded: boolean;
  fetched: boolean;
  modelMs: number | undefined;
  /** Canary checks announced and not yet run: each one's synthesis is qualification, not a face. */
  canaries: number;
  synthesisMs: number[];
  encodeMs: number[];
}

export const startJob = (action: string): JobState => ({
  action,
  loaded: false,
  fetched: false,
  modelMs: undefined,
  canaries: 0,
  synthesisMs: [],
  encodeMs: [],
});

/** Folds one runtime stage into the job. Pure apart from the job it updates. */
export function observeStage(job: JobState, stage: string, event: Data): void {
  if (LOADING_STAGES.has(stage)) job.loaded = true;
  if (
    stage === 'asset-acquisition' &&
    typeof event['fetched'] === 'number' &&
    event['fetched'] > 0
  ) {
    job.fetched = true;
    job.loaded = true;
  }
  // The runtime announces each canary before running its synthesis (stylegan-js engine/canary.ts runNext).
  if (stage === 'canary') job.canaries += 1;
  const elapsed = ms(event['elapsedMs']);
  if (stage === 'synthesis-complete' && job.canaries > 0) {
    job.canaries -= 1;
    return;
  }
  if (elapsed === undefined) return;
  if (stage === 'model-loaded') job.modelMs = (job.modelMs ?? 0) + elapsed;
  else if (stage === 'synthesis-complete' && elapsed > 0) job.synthesisMs.push(elapsed);
  else if (stage === 'encoding-complete' && elapsed > 0) job.encodeMs.push(elapsed);
}

/**
 * The new-kind events a finished job yields, given its mapped `job` event. job_warm: request to visible result,
 * only for a completed job that loaded no model. compute: model compute per image (synthesis per face; for a
 * photo job, the encode), whatever the outcome, never per morph frame. model: time to get the synthesis model
 * ready, by network download (anything fetched during the job) or restore from the browser's cache.
 */
export function jobEvents(job: JobState, event: StatsEvent & { t: 'job' }): StatsEvent[] {
  const { action, route, platform } = event;
  const out: StatsEvent[] = [];
  if (event.outcome === 'completed' && !job.loaded && event.ms !== undefined)
    out.push({ t: 'job_warm', action, route, platform, ms: event.ms });
  const compute = action === 'photo' ? job.encodeMs : action === 'morph' ? [] : job.synthesisMs;
  for (const value of compute) out.push({ t: 'compute', action, route, platform, ms: value });
  if (job.modelMs !== undefined)
    out.push({ t: 'model', phase: job.fetched ? 'download' : 'cache', platform, ms: job.modelMs });
  return out;
}

// ---- batching ----------------------------------------------------------------------------------------------------

/** The batching rule as a pure function of plain values: flush at 150 events, or once 60 s have passed. */
export const shouldFlush = (pending: number, now: number, lastFlush: number): boolean =>
  pending >= FLUSH_AT || now - lastFlush >= FLUSH_EVERY_MS;

const body = (events: readonly StatsEvent[]) => JSON.stringify({ v: 1, app: BUILD, events });

/** Splits events into beacon bodies of at most MAX_BYTES each, halving a part until it fits. Pure. */
export function bodies(events: readonly StatsEvent[]): string[] {
  const out: string[] = [];
  let rest = events;
  while (rest.length) {
    let n = rest.length,
      text = body(rest);
    while (text.length > MAX_BYTES && n > 1) {
      n = Math.floor(n / 2);
      text = body(rest.slice(0, n));
    }
    out.push(text);
    rest = rest.slice(n);
  }
  return out;
}

export interface Sink {
  record(kind: string, data?: Data): void;
  stage(stage: string, event?: Data): void;
  flush(): void;
  pending(): number;
  /** Off drops the queue at once and sends nothing more from this tab; On resumes. Returns whether it was saved. */
  setOn(on: boolean): boolean;
  /** Whether this tab may send now. */
  active(): boolean;
}

export interface SinkOptions extends Options {
  readonly env?: StatsEnv;
  readonly send?: (body: string) => unknown;
  readonly now?: () => number;
}

/** A batching sender. `send(body)` defaults to navigator.sendBeacon; injectable for tests. */
export function createSink({
  env = globalThis as StatsEnv,
  send,
  now = () => Date.now(),
  allowAutomation = false,
}: SinkOptions = {}): Sink {
  let queue: StatsEvent[] = [],
    lastFlush = now(),
    timer = false,
    platform: Platform | undefined,
    job: JobState | null = null,
    // The person's choice in this tab, when storage could not keep it.
    tab: boolean | null = null;
  const deliver =
    send ??
    ((text: string) =>
      env.navigator?.sendBeacon?.(ENDPOINT, new Blob([text], { type: 'application/json' })));
  const active = () => {
    try {
      if (tab === false) return false;
      if (environmentBlock(env, { allowAutomation }) !== null) return false;
      return tab === true || !storedOff(env);
    } catch {
      return false;
    }
  };
  function flush() {
    try {
      if (!queue.length) return;
      const events = queue;
      queue = [];
      lastFlush = now();
      if (!active()) return;
      for (const text of bodies(events)) {
        try {
          deliver(text);
        } catch {
          /* never affects the product */
        }
      }
    } catch {
      /* never affects the product */
    }
  }
  function push(events: readonly StatsEvent[]) {
    queue.push(...events);
    if (shouldFlush(queue.length, now(), lastFlush)) flush();
    else if (!timer && typeof env.setTimeout === 'function') {
      timer = true;
      env.setTimeout(() => {
        timer = false;
        flush();
      }, FLUSH_EVERY_MS);
    }
  }
  function record(kind: string, data: Data = {}) {
    try {
      if (kind === 'start') {
        job = startJob(String(data['action']));
        return;
      }
      const finished = kind === 'job' ? job : null;
      if (kind === 'job') job = null;
      if (!active()) return;
      platform ??= platformClass(env.navigator);
      const event = toStatsEvent(kind, data, platform);
      if (!event) return;
      push(event.t === 'job' && finished ? [event, ...jobEvents(finished, event)] : [event]);
    } catch {
      /* never affects the product */
    }
  }
  function stage(name: string, event: Data = {}) {
    try {
      if (job) observeStage(job, name, event);
    } catch {
      /* never affects the product */
    }
  }
  function setOn(on: boolean): boolean {
    if (!on) queue = [];
    try {
      if (on) env.localStorage?.removeItem?.(OPT_OUT_KEY);
      else env.localStorage?.setItem?.(OPT_OUT_KEY, 'off');
      if (storedOff(env) === !on) {
        tab = null;
        return true;
      }
    } catch {
      /* the choice holds for this tab */
    }
    tab = on;
    return false;
  }
  try {
    env.addEventListener?.('pagehide', flush);
    env.document?.addEventListener?.('visibilitychange', () => {
      if (env.document?.visibilityState === 'hidden') flush();
    });
  } catch {
    /* no page lifecycle here */
  }
  return { record, stage, flush, pending: () => queue.length, setOn, active };
}

// ---- the page-wide sink and the switch ---------------------------------------------------------------------------

let shared: Sink | undefined;
let sharedOptions: Options = {};
const page = () => (shared ??= createSink(sharedOptions));

/** Sets the build's options before first use (the facade does this at load). */
export function configure(options: Options): void {
  if (!shared) sharedOptions = options;
}
/** The page-wide sink's entry points, as analytics.mjs and reporting.mjs call them. */
export function record(kind: string, data?: Data): void {
  page().record(kind, data);
}
export function stage(name: string, event?: Data): void {
  page().stage(name, event);
}
/** The gate analytics.mjs asks before it notes a visit (and writes its visit key) for these statistics. */
export function recording(): boolean {
  return page().active();
}

/** What the switch shows. */
export interface SwitchState {
  readonly on: boolean;
  /** Set when the browser's own setting turns statistics off; the switch is then disabled. */
  readonly reason: string | null;
  /** False when the last choice could not be saved and holds for this tab only. */
  readonly saved: boolean;
}

const REASONS: Readonly<Record<Block, string>> = {
  gpc: 'Off because your browser sends Global Privacy Control.',
  dnt: 'Off because your browser sends Do Not Track.',
  'save-data': 'Off because your browser asks to save data.',
  host: 'Off: usage statistics are only counted on facemorph.me.',
  automation: 'Off in automated browsers.',
};

let lastSaved = true;
export function switchState(env: StatsEnv = globalThis as StatsEnv): SwitchState {
  const block = environmentBlock(env, sharedOptions);
  if (block) return { on: false, reason: REASONS[block], saved: true };
  return { on: page().active(), reason: null, saved: lastSaved };
}
export function setUsageStats(on: boolean, env: StatsEnv = globalThis as StatsEnv): SwitchState {
  lastSaved = page().setOn(on);
  return switchState(env);
}
