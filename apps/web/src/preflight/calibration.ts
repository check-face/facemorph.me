// fm-g019: measured per-workload calibration. This module consumes versioned evidence;
// it neither runs the checker nor turns one score into a whole-job prediction.
import type { CalibrationScope, EstimatedStage, StageEstimate } from '../contracts/preflight.ts';

export interface PairedMeasurement {
  readonly id: string;
  readonly partition: 'training' | 'held-out';
  readonly stage: EstimatedStage;
  readonly scope: CalibrationScope;
  /** Browser/CPU compatibility class, not an inferred device-memory bucket. */
  readonly profile: string;
  readonly device: string;
  readonly at: string;
  readonly checkerUnitMs: number;
  readonly durationMs: number;
}
export interface StageRequest {
  readonly stage: EstimatedStage;
  readonly scope: CalibrationScope;
  readonly units: number;
}
export interface CalibrationContext {
  readonly profile: string;
  readonly device?: string;
  readonly checkerUnitMs?: number;
  readonly nowMs: number;
  readonly maxActualAgeMs?: number;
  /** Comparable timings must be requested and labelled explicitly. */
  readonly allowComparable?: boolean;
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
export const sameCalibrationScope = (a: CalibrationScope, b: CalibrationScope): boolean =>
  a.checkpoint === b.checkpoint &&
  a.resolution === b.resolution &&
  a.provider === b.provider &&
  a.runtime === b.runtime &&
  a.threadMode === b.threadMode &&
  a.workload === b.workload;

function compatible(request: StageRequest, profile: string, rows: readonly PairedMeasurement[]) {
  return rows.filter(
    (row) =>
      row.stage === request.stage &&
      row.profile === profile &&
      sameCalibrationScope(row.scope, request.scope) &&
      positive(row.checkerUnitMs) &&
      positive(row.durationMs),
  );
}
function fit(rows: readonly PairedMeasurement[]) {
  const training = rows.filter((row) => row.partition === 'training');
  const heldOut = rows.filter((row) => row.partition === 'held-out');
  if (
    new Set(training.map((row) => row.id)).size < 3 ||
    new Set(heldOut.map((row) => row.id)).size < 2
  )
    return null;
  const ratios = training.map((row) => row.durationMs / row.checkerUnitMs);
  if (!ratios.every(positive)) return null;
  return {
    coefficient: median(ratios),
    low: Math.min(...ratios),
    high: Math.max(...ratios),
    scoreLow: Math.min(...training.map((row) => row.checkerUnitMs)),
    scoreHigh: Math.max(...training.map((row) => row.checkerUnitMs)),
  };
}

/** Prefer compatible recent measurements here, then in-domain calibration, then explicit comparable data.
 * No match (including a different checkpoint/runtime/thread mode/workload) remains unknown. */
export function estimateStage(
  request: StageRequest,
  context: CalibrationContext,
  measurements: readonly PairedMeasurement[],
): StageEstimate | null {
  const rows = compatible(request, context.profile, measurements);
  const actual = context.device
    ? rows.filter((row) => {
        const age = context.nowMs - Date.parse(row.at);
        return (
          row.device === context.device && age >= 0 && age <= (context.maxActualAgeMs ?? 86_400_000)
        );
      })
    : [];
  const result = (
    rangeMs: readonly [number, number],
    source: StageEstimate['source'],
  ): StageEstimate => ({ stage: request.stage, scope: request.scope, rangeMs, source });
  if (actual.length)
    return result(
      [
        Math.min(...actual.map((row) => row.durationMs)),
        Math.max(...actual.map((row) => row.durationMs)),
      ],
      'recent-actual-device',
    );
  const model = fit(rows);
  const score = context.checkerUnitMs;
  if (model && positive(score) && score >= model.scoreLow && score <= model.scoreHigh)
    if (positive(score * model.low) && positive(score * model.high))
      return result([score * model.low, score * model.high], 'calibrated-local-check');
  if (context.allowComparable && rows.length >= 3)
    return result(
      [
        Math.min(...rows.map((row) => row.durationMs)),
        Math.max(...rows.map((row) => row.durationMs)),
      ],
      'comparable-device',
    );
  return null;
}

/** The cost/copy boundary: withhold a whole-job range if any requested stage is unknown.
 * Each known stage is multiplied by its own unit count, never by another stage's score. */
export function estimateJob(
  requests: readonly StageRequest[],
  context: CalibrationContext,
  measurements: readonly PairedMeasurement[],
) {
  const stages = requests.map((request) => ({
    ...request,
    estimate:
      Number.isSafeInteger(request.units) && request.units > 0
        ? estimateStage(request, context, measurements)
        : null,
  }));
  if (!stages.length || stages.some((stage) => !stage.estimate))
    return { kind: 'no-reliable-estimate' as const, rangeMs: null, stages };
  const rangeMs: [number, number] = [0, 0];
  for (const stage of stages) {
    rangeMs[0] += stage.estimate!.rangeMs[0] * stage.units;
    rangeMs[1] += stage.estimate!.rangeMs[1] * stage.units;
  }
  if (!rangeMs.every(positive))
    return { kind: 'no-reliable-estimate' as const, rangeMs: null, stages };
  return { kind: 'estimate' as const, rangeMs, stages };
}

/** Held-out rows never fit the coefficient or the display range. Report error even outside the
 * training domain, marking that case uncalibrated for display. No numerical threshold is claimed. */
export function heldOutErrors(measurements: readonly PairedMeasurement[]) {
  return measurements
    .filter((row) => row.partition === 'held-out')
    .map((row) => {
      const model = fit(
        compatible({ stage: row.stage, scope: row.scope, units: 1 }, row.profile, measurements),
      );
      const predictedMs = model ? model.coefficient * row.checkerUnitMs : null;
      return {
        id: row.id,
        profile: row.profile,
        stage: row.stage,
        scope: row.scope,
        status:
          model && row.checkerUnitMs >= model.scoreLow && row.checkerUnitMs <= model.scoreHigh
            ? 'tested'
            : 'uncalibrated',
        threshold: 'measured, no threshold',
        actualMs: row.durationMs,
        predictedMs,
        relativeError:
          predictedMs === null ? null : Math.abs(predictedMs - row.durationMs) / row.durationMs,
      };
    });
}
