// The not-worse workload's measures (fm-0q4h, slice 1): the fixed visitor journey's finish boundaries, the per-build
// selector maps that name each semantic boundary for the control and the build under test, measures computed from a
// recorded run trace with the time the script spent waiting the way a person would excluded, reliability
// classification, and ABBA order with a discarded warmup. Plain values in, plain values out; the browser runner
// records traces in this shape. The comparison math and the verdict are fm-mc27's (scripts/verify/not-worse.mjs).

/** The semantic boundaries both builds share; each measure starts at an action and ends at one of these. */
export const BOUNDARIES = [
  'usable-page',
  'face-rendered',
  'photo-face-rendered',
  'morph-playable',
  'save-ready',
] as const;
export type Boundary = (typeof BOUNDARIES)[number];

export interface BoundarySelector {
  /** CSS selector of the element whose condition ends the measure. */
  readonly selector: string;
  /** What must hold on it. */
  readonly condition:
    | 'enabled'
    | 'state-filled'
    | 'state-photo'
    | 'decoded'
    | 'canplaythrough'
    | 'download';
}
export type SelectorMap = Readonly<Record<Boundary, BoundarySelector>>;

/** The control (classic candidate build): its DOM contract as the research drivers drive it. */
export const CONTROL_SELECTORS: SelectorMap = Object.freeze({
  'usable-page': { selector: 'section.next-face input[type="text"]', condition: 'enabled' },
  'face-rendered': {
    selector: 'section.next-face[data-next-state="filled"] .next-face-img img',
    condition: 'decoded',
  },
  'photo-face-rendered': {
    selector: 'section.next-face[data-next-state="photo"] .next-face-img img',
    condition: 'decoded',
  },
  'morph-playable': {
    selector: '.next-result video, video.next-video',
    condition: 'canplaythrough',
  },
  'save-ready': { selector: 'button', condition: 'download' },
});

/** The build under test (the Vite shell port): the same semantic boundaries where the port moved them. */
export const BUILD_SELECTORS: SelectorMap = Object.freeze({
  'usable-page': { selector: 'section.next-face input[type="text"]', condition: 'enabled' },
  'face-rendered': {
    selector: 'section.next-face[data-next-state="filled"] .next-face-img img',
    condition: 'decoded',
  },
  'photo-face-rendered': {
    selector: 'section.next-face[data-next-state="photo"] .next-face-img img',
    condition: 'decoded',
  },
  'morph-playable': { selector: '.next-video-slot video.next-video', condition: 'canplaythrough' },
  'save-ready': { selector: 'button', condition: 'download' },
});

export const MEASURES = [
  'usablePageMs',
  'coldFaceMs',
  'warmFaceMs',
  'nextFaceMs',
  'photoEncodeMs',
  'morphPlayableMs',
  'morphPerFrameMs',
  'firstSaveMs',
  'repeatSaveMs',
] as const;
export type Measure = (typeof MEASURES)[number];

/** Which action and boundary bracket each timed measure (morphPerFrameMs is derived). */
export const MEASURE_SPAN: Readonly<
  Record<
    Exclude<Measure, 'morphPerFrameMs'>,
    { readonly action: string; readonly boundary: Boundary }
  >
> = Object.freeze({
  usablePageMs: { action: 'navigate', boundary: 'usable-page' },
  coldFaceMs: { action: 'generate-cold', boundary: 'face-rendered' },
  warmFaceMs: { action: 'generate-warm', boundary: 'face-rendered' },
  nextFaceMs: { action: 'generate-next', boundary: 'face-rendered' },
  photoEncodeMs: { action: 'confirm-photo', boundary: 'photo-face-rendered' },
  morphPlayableMs: { action: 'create-morph', boundary: 'morph-playable' },
  firstSaveMs: { action: 'save-first', boundary: 'save-ready' },
  repeatSaveMs: { action: 'save-repeat', boundary: 'save-ready' },
});

export type TraceEvent =
  | { readonly t: number; readonly kind: 'action'; readonly name: string }
  | { readonly t: number; readonly kind: 'boundary'; readonly name: Boundary }
  | { readonly t: number; readonly kind: 'wait'; readonly end: number }
  | { readonly t: number; readonly kind: 'input'; readonly responseMs: number }
  | { readonly t: number; readonly kind: 'paint-gap'; readonly ms: number }
  | {
      readonly t: number;
      readonly kind: 'crash' | 'reload' | 'oom' | 'uncaught-error';
      readonly detail?: string;
    }
  | {
      readonly t: number;
      readonly kind: 'route';
      readonly requested: string;
      readonly actual: string;
    }
  | {
      readonly t: number;
      readonly kind: 'produced';
      readonly what: 'face' | 'photo-face' | 'video';
    }
  | {
      readonly t: number;
      readonly kind: 'bytes';
      readonly visit: 'first' | 'return';
      readonly bytes: number;
    }
  | { readonly t: number; readonly kind: 'memory'; readonly bytes: number | null };

/** Time inside [from, to] that the script spent waiting as a person would; excluded from every measure. */
export function waitedWithin(events: readonly TraceEvent[], from: number, to: number): number {
  let total = 0;
  for (const e of events)
    if (e.kind === 'wait') total += Math.max(0, Math.min(e.end, to) - Math.max(e.t, from));
  return total;
}

/** A measure from its action to the next matching boundary after it, less the scripted waits; null if absent. */
export function span(
  events: readonly TraceEvent[],
  action: string,
  boundary: Boundary,
): number | null {
  const start = events.find((e) => e.kind === 'action' && e.name === action);
  if (!start) return null;
  const end = events.find((e) => e.kind === 'boundary' && e.name === boundary && e.t >= start.t);
  if (!end) return null;
  return end.t - start.t - waitedWithin(events, start.t, end.t);
}

export interface RunMeasures {
  readonly values: Readonly<Record<Measure, number | null>>;
  /** A real input that waited more than 1 s for a response, or a paint gap over 1 s. */
  readonly lockups: number;
  readonly bytes: { readonly first: number | null; readonly return: number | null };
  /** Peak memory where the platform reports it; 'unreported' otherwise, never estimated. */
  readonly peakMemory: number | 'unreported';
}

export function measures(events: readonly TraceEvent[], morphFrames: number): RunMeasures {
  const values = {} as Record<Measure, number | null>;
  for (const [m, s] of Object.entries(MEASURE_SPAN) as [
    Exclude<Measure, 'morphPerFrameMs'>,
    { action: string; boundary: Boundary },
  ][])
    values[m] = span(events, s.action, s.boundary);
  values.morphPerFrameMs =
    values.morphPlayableMs === null || morphFrames <= 0
      ? null
      : values.morphPlayableMs / morphFrames;
  const lockups = events.filter(
    (e) => (e.kind === 'input' && e.responseMs > 1000) || (e.kind === 'paint-gap' && e.ms > 1000),
  ).length;
  const byVisit = (v: 'first' | 'return') => {
    const b = events.filter(
      (e): e is Extract<TraceEvent, { kind: 'bytes' }> => e.kind === 'bytes' && e.visit === v,
    );
    return b.length ? b.reduce((n, e) => n + e.bytes, 0) : null;
  };
  const memory = events.filter(
    (e): e is Extract<TraceEvent, { kind: 'memory' }> => e.kind === 'memory' && e.bytes !== null,
  );
  return {
    values,
    lockups,
    bytes: { first: byVisit('first'), return: byVisit('return') },
    peakMemory: memory.length ? Math.max(...memory.map((e) => e.bytes as number)) : 'unreported',
  };
}

export interface Reliability {
  readonly faceProduced: boolean;
  readonly photoFaceProduced: boolean;
  readonly videoProduced: boolean;
  readonly crash: boolean;
  readonly reloads: number;
  readonly outOfMemory: boolean;
  /** The actual route differed from the requested one, from the app's visible route explanation. */
  readonly fallback: boolean;
  readonly uncaughtErrors: number;
}

export function reliability(events: readonly TraceEvent[]): Reliability {
  const produced = (w: 'face' | 'photo-face' | 'video') =>
    events.some((e) => e.kind === 'produced' && e.what === w);
  return {
    faceProduced: produced('face'),
    photoFaceProduced: produced('photo-face'),
    videoProduced: produced('video'),
    crash: events.some((e) => e.kind === 'crash'),
    reloads: events.filter((e) => e.kind === 'reload').length,
    outOfMemory: events.some((e) => e.kind === 'oom'),
    fallback: events.some(
      (e) => e.kind === 'route' && e.requested !== 'auto' && e.requested !== e.actual,
    ),
    uncaughtErrors: events.filter((e) => e.kind === 'uncaught-error').length,
  };
}

export type Side = 'control' | 'build';

export interface ScheduledRun {
  readonly index: number;
  readonly side: Side;
  /** The pair this run belongs to; null for the discarded warmup. */
  readonly pair: number | null;
  readonly order: 'AB' | 'BA' | 'warmup';
}

/**
 * ABBA order: one discarded warmup, then `pairs` pairs alternating control-first and build-first, so neither side
 * always runs second on a warmed device. Control/control runs use the same order with both sides the control.
 */
export function abbaSchedule(pairs: number): ScheduledRun[] {
  if (!Number.isInteger(pairs) || pairs < 1) throw new RangeError('at least one pair');
  const out: ScheduledRun[] = [{ index: 0, side: 'control', pair: null, order: 'warmup' }];
  for (let p = 0; p < pairs; p++) {
    const first: Side = p % 2 === 0 ? 'control' : 'build';
    const second: Side = first === 'control' ? 'build' : 'control';
    const order = p % 2 === 0 ? 'AB' : 'BA';
    out.push(
      { index: out.length, side: first, pair: p, order },
      { index: out.length + 1, side: second, pair: p, order },
    );
  }
  return out;
}

/** The scored runs: the warmup is dropped. */
export const scored = <T extends { readonly run: ScheduledRun }>(runs: readonly T[]): T[] =>
  runs.filter((r) => r.run.order !== 'warmup');
