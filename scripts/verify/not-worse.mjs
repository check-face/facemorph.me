// The strictly-not-worse pass rule (PLAN.md "Strictly not worse than the candidate", operator 24 October 2026) as pure
// functions: the shared no-regression protocol the parity harness (fm-q007), the release gate verify.not-worse (fm-mc27)
// and the ported-app comparisons apply. Inputs are plain numbers from paired ABBA runs on one cell and one workload;
// nothing here measures.
//
//   Reliability: every run that produced a result on the control must produce it on the new build.
//   Timing, byte and memory measures (lower is better): the new build fails when the 95% interval of the paired
//   new/control ratio lies entirely above 1 plus the cell's noise margin, measured from control/control pairs.
//   Fewer than 5 pairs, or no noise margin, is untested: it never counts as passing. A trade recorded in the plan
//   names its measure and is reported as traded.

export const MIN_PAIRS = 5;

// Two-sided 95% Student t critical values by degrees of freedom (1..30), then the normal value.
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];
export const t95 = (df) => (df >= 1 && df <= 30 ? T95[df - 1] : 1.96);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Ratios new/control (or second/first for control/control), one per pair. Every value must be positive and finite. */
export function pairedRatios(pairs) {
  return pairs.map(({ control, candidate }, i) => {
    if (!(control > 0 && candidate > 0 && Number.isFinite(control) && Number.isFinite(candidate)))
      throw new Error(`pair ${i}: values must be positive and finite`);
    return candidate / control;
  });
}

/**
 * 95% interval of the geometric-mean ratio: a t interval on log ratios, exponentiated. Pairing removes the
 * between-pair drift; working in logs makes "10% slower" and "10% faster" symmetric.
 */
export function ratioInterval(ratios) {
  if (ratios.length < 2) return null;
  const logs = ratios.map(Math.log);
  const m = mean(logs);
  const sd = Math.sqrt(logs.reduce((s, x) => s + (x - m) ** 2, 0) / (logs.length - 1));
  const half = (t95(logs.length - 1) * sd) / Math.sqrt(logs.length);
  return {
    ratio: Math.exp(m),
    low: Math.exp(m - half),
    high: Math.exp(m + half),
    n: ratios.length,
  };
}

/**
 * Noise margin from control/control pairs: how far above 1 the control's own paired ratio can reach, as the upper end
 * of its 95% interval minus 1 (never below 0). A cell with too few control/control pairs has no margin.
 */
export function noiseMargin(controlPairs) {
  if (controlPairs.length < MIN_PAIRS) return null;
  const interval = ratioInterval(pairedRatios(controlPairs));
  return Math.max(0, interval.high - 1);
}

/**
 * Verdict for one measure on one cell. `pairs` are {control, candidate}; `noise` is a margin (number) or
 * control/control pairs; `trade` names a recorded plan trade that excuses this measure.
 */
export function measureVerdict({ pairs, noise, trade = null }) {
  if (!Array.isArray(pairs) || pairs.length < MIN_PAIRS)
    return { verdict: 'untested', reason: `fewer than ${MIN_PAIRS} pairs`, n: pairs?.length ?? 0 };
  const margin =
    typeof noise === 'number' ? noise : Array.isArray(noise) ? noiseMargin(noise) : null;
  if (margin === null)
    return {
      verdict: 'untested',
      reason: 'no control/control noise margin for this cell',
      n: pairs.length,
    };
  const interval = ratioInterval(pairedRatios(pairs));
  const limit = 1 + margin;
  const worse = interval.low > limit;
  if (worse && trade) return { verdict: 'traded', trade, margin, limit, ...interval };
  return { verdict: worse ? 'failed' : 'passed', margin, limit, ...interval };
}

/** Reliability: any run that produced its result on the control and not on the new build fails the cell. */
export function reliabilityVerdict(runs) {
  if (!Array.isArray(runs) || runs.length === 0)
    return { verdict: 'untested', reason: 'no paired runs' };
  const lost = runs.filter((r) => r.controlProduced && !r.candidateProduced);
  return lost.length
    ? { verdict: 'failed', lost: lost.length, runs: runs.length }
    : { verdict: 'passed', runs: runs.length };
}

/** A cell passes only if reliability passes and no measure failed or went untested; traded measures are listed. */
export function cellVerdict({ reliability, measures }) {
  const entries = Object.entries(measures);
  const verdicts = [reliability.verdict, ...entries.map(([, v]) => v.verdict)];
  const verdict = verdicts.includes('failed')
    ? 'failed'
    : verdicts.includes('untested')
      ? 'untested'
      : 'passed';
  return { verdict, traded: entries.filter(([, v]) => v.verdict === 'traded').map(([k]) => k) };
}
