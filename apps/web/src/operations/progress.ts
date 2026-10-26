// One honest progress bar per requested action (fm-vbj7), from acquisition to the usable default file.
// The candidate reported each stage's own 0..1 fraction, so the bar reset at every stage. Here the work an
// attempt will do is frozen when it is requested; each phase advances only forwards in its own unit; the
// whole-action fraction never decreases, is unknown (indeterminate) while any phase's cost is unknown, does
// not move while a user decision is pending, and reaches 1 only when the default file is ready.

export type PhaseKind = 'acquisition' | 'load' | 'prepare' | 'compute' | 'frames' | 'file';
/** What a phase counts. Bytes and frames never share a unit, so they are never summed. */
export type PhaseUnit = 'bytes' | 'frames' | 'steps';
export interface PhasePlan {
  readonly kind: PhaseKind;
  readonly unit: PhaseUnit;
  /** Share of the whole action from scoped measurements; the plan's weights are normalised. */
  readonly weight: number;
  /** Units of work, or null while unknown (the action is then indeterminate). */
  readonly total: number | null;
  /** Work already complete when the action starts (a cached model, a finished prerequisite face). */
  readonly done?: number;
}
export type Settlement = 'completed' | 'cancelled' | 'failed';
export interface PhaseProgress {
  readonly kind: PhaseKind;
  readonly unit: PhaseUnit;
  readonly done: number;
  readonly total: number | null;
}
export interface ActionProgress {
  readonly attemptId: string;
  /** 0..1, or null when indeterminate (a cost is unknown); never decreases within an attempt. */
  readonly fraction: number | null;
  readonly phases: readonly PhaseProgress[];
  /** True only once the default recovery-bearing file (or the playable MP4) is ready. */
  readonly complete: boolean;
  readonly waiting: boolean;
  readonly settled: Settlement | null;
}

/** Below 1 until the file boundary: computed work alone never claims completion. */
const BEFORE_FILE = 0.999;

export function createActionProgress(attemptId: string, plan: readonly PhasePlan[]) {
  if (!plan.length) throw new Error('An action needs at least one phase');
  const kinds = new Set(plan.map((p) => p.kind));
  if (kinds.size !== plan.length) throw new Error('Each phase appears once in a plan');
  const weightSum = plan.reduce((sum, p) => sum + Math.max(0, p.weight), 0);
  if (!(weightSum > 0)) throw new Error('A plan needs a positive weight');
  const phases = new Map(
    plan.map((p) => [
      p.kind,
      { ...p, weight: Math.max(0, p.weight) / weightSum, done: Math.max(0, p.done ?? 0) },
    ]),
  );
  const seen = new Map<PhaseKind, Set<number>>();
  let best = 0;
  let waiting = false;
  let fileReady = false;
  let settled: Settlement | null = null;

  function computed(): number | null {
    let sum = 0;
    for (const p of phases.values()) {
      if (p.total === null) return null;
      sum += p.weight * (p.total === 0 ? 1 : Math.min(1, p.done / p.total));
    }
    return sum;
  }
  function snapshot(): ActionProgress {
    const value = computed();
    return {
      attemptId,
      fraction: fileReady ? 1 : value === null ? null : best,
      phases: [...phases.values()].map(({ kind, unit, done, total }) => ({
        kind,
        unit,
        done,
        total,
      })),
      complete: fileReady,
      waiting,
      settled,
    };
  }
  function refresh(): ActionProgress {
    const value = computed();
    if (value !== null && !waiting) best = Math.max(best, Math.min(BEFORE_FILE, value));
    return snapshot();
  }
  function phase(kind: PhaseKind, unit: PhaseUnit) {
    const p = phases.get(kind);
    if (!p) throw new Error(`Phase ${kind} is not part of this action`);
    if (p.unit !== unit) throw new Error(`Phase ${kind} counts ${p.unit}, not ${unit}`);
    return p;
  }
  const open = () => settled === null;

  return {
    snapshot,
    /** Units now finished in a phase; counts only ever move forwards. */
    advance(kind: PhaseKind, unit: PhaseUnit, done: number, total?: number): ActionProgress {
      const p = phase(kind, unit);
      if (!open() || !Number.isFinite(done)) return snapshot();
      if (total !== undefined && Number.isFinite(total) && total >= 0 && p.total === null)
        p.total = total; // a cost becomes known; a known cost is frozen at the request boundary
      p.done = Math.max(p.done, done);
      return refresh();
    },
    /** One identified unit (a frame index) finished; repeats count once, in any order. */
    finishUnit(kind: PhaseKind, unit: PhaseUnit, index: number): ActionProgress {
      const p = phase(kind, unit);
      if (!open() || !Number.isInteger(index) || index < 0) return snapshot();
      const set = seen.get(kind) ?? new Set<number>();
      seen.set(kind, set);
      if (p.total !== null && index >= p.total) return snapshot();
      set.add(index);
      p.done = Math.max(p.done, set.size);
      return refresh();
    },
    /** A phase's work is all done (whatever its unit). */
    finish(kind: PhaseKind): ActionProgress {
      const p = phases.get(kind);
      if (!p) throw new Error(`Phase ${kind} is not part of this action`);
      if (!open()) return snapshot();
      if (p.total === null) p.total = Math.max(p.done, 1);
      p.done = p.total;
      return refresh();
    },
    /** While a user decision (consent, crop) is pending the bar holds still. */
    setWaiting(value: boolean): ActionProgress {
      waiting = value;
      return refresh();
    },
    /** The completion boundary: the default file (or playable MP4 with project metadata) is ready. */
    fileReady(): ActionProgress {
      if (!open()) return snapshot();
      for (const p of phases.values()) {
        if (p.total === null) p.total = Math.max(p.done, 1);
        p.done = p.total;
      }
      fileReady = true;
      settled = 'completed';
      best = 1;
      return snapshot();
    },
    /** Cancellation or failure ends the attempt where it stood; usable results are not touched. */
    settle(outcome: Exclude<Settlement, 'completed'>): ActionProgress {
      if (open()) settled = outcome;
      return snapshot();
    },
  };
}
export type ActionProgressTracker = ReturnType<typeof createActionProgress>;

/** The line a morph speaks while it renders: finished frames, never decreasing. */
export const morphLine = (done: number, total: number) => `Generating ${done} / ${total} images`;
