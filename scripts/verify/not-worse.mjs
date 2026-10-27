// The strictly-not-worse pass rule (PLAN.md "Strictly not worse than the candidate", operator 24 October 2026) as pure
// functions: the shared no-regression protocol the parity harness (fm-q007), the release gate verify.not-worse (fm-mc27)
// and the ported-app comparisons apply. Inputs are plain numbers from paired ABBA runs on one cell and one workload;
// nothing here measures.
//
//   Reliability: every run that produced a result on the control must produce it on the new build, and a new crash,
//   reload, out-of-memory kill or fallback in any pair fails the cell whatever the timings.
//   Timing, byte and memory measures (lower is better), against 1 plus the cell's noise margin (from control/control
//   pairs): the new build fails when the 95% interval of the paired new/control ratio lies entirely above that limit,
//   passes when it lies entirely at or below it, and is inconclusive when the interval spans it or there are fewer
//   than 5 pairs. No noise margin is untested. Neither counts as passing. A trade recorded in the plan names its
//   measure and its citation and is reported as traded.
//   Release (fm-mc27): a class is claimed only when every listed cell of it passed; a missing or untested cell permits
//   no claim for its class. Missing or unpassed required local cells (P30 Pro, eris) block handover; an explicitly
//   unavailable hosted runner is untested and does not block, while a real failure on a hosted lane does.

export const MIN_PAIRS = 5;
/** Inconclusive measures get more pairs, two at a time to keep ABBA balance, up to this many (orchestrator, 27 Oct). */
export const MAX_PAIRS = 15;

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
    return {
      verdict: 'inconclusive',
      reason: `fewer than ${MIN_PAIRS} pairs`,
      n: pairs?.length ?? 0,
    };
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
  if (worse && trade) {
    const cited = typeof trade === 'string' ? trade.trim() : trade.measure && trade.citation;
    if (!cited) throw new Error('a trade names its measure and its PLAN.md citation');
    return { verdict: 'traded', trade, margin, limit, ...interval };
  }
  // The bound: the largest slowdown (as a fraction) the 95% interval still allows.
  const bound = Math.max(0, interval.high - 1);
  if (worse) return { verdict: 'failed', margin, limit, bound, ...interval };
  if (interval.high <= limit) return { verdict: 'passed', margin, limit, bound, ...interval };
  return {
    verdict: 'inconclusive',
    reason: 'the interval spans the limit',
    margin,
    limit,
    bound,
    ...interval,
  };
}

/**
 * The adaptive plan for one cell: `measures` maps a measure to { pairs, noise, trade }. An inconclusive measure below
 * `maxPairs` asks for more pairs (`more`, at least `step` and at least up to MIN_PAIRS, never past the maximum); the
 * cell runs the largest request. At the maximum an inconclusive measure stays inconclusive, with the reason that the
 * noise is too high and its bound: the largest slowdown its interval cannot exclude.
 */
export function extendPlan({ measures, maxPairs = MAX_PAIRS, step = 2 }) {
  const verdicts = {};
  let more = 0;
  for (const [name, m] of Object.entries(measures)) {
    const v = measureVerdict(m);
    const n = m.pairs?.length ?? 0;
    if (v.verdict === 'inconclusive') {
      if (n < maxPairs)
        more = Math.max(more, Math.min(maxPairs - n, Math.max(step, MIN_PAIRS - n)));
      else
        v.reason = `still inconclusive at the ${maxPairs}-pair maximum: the noise is too high to decide; a slowdown of up to ${((v.bound ?? 0) * 100).toFixed(1)}% is not excluded`;
    }
    verdicts[name] = v;
  }
  return { verdicts, more };
}

/** The reliability events that fail a cell when the new build shows them, whatever the timings. */
export const RELIABILITY_EVENTS = ['crash', 'reload', 'outOfMemory', 'fallback'];

/**
 * Reliability: any run that produced its result on the control and not on the new build fails the cell, as does any
 * new-build run with a crash, reload, out-of-memory kill or fallback (`candidateEvents`, e.g. { crash: true }).
 */
export function reliabilityVerdict(runs) {
  if (!Array.isArray(runs) || runs.length === 0)
    return { verdict: 'untested', reason: 'no paired runs' };
  const lost = runs.filter((r) => r.controlProduced && !r.candidateProduced);
  const events = RELIABILITY_EVENTS.filter((e) => runs.some((r) => r.candidateEvents?.[e]));
  return lost.length || events.length
    ? { verdict: 'failed', lost: lost.length, events, runs: runs.length }
    : { verdict: 'passed', runs: runs.length };
}

// Worst first: a cell or class takes the worst verdict among its parts.
const ORDER = ['failed', 'untested', 'inconclusive', 'passed'];
const worst = (verdicts) => ORDER.find((v) => verdicts.includes(v)) ?? 'passed';

/**
 * A cell passes only if reliability passes and every measure passed or was traded; traded measures are listed.
 * Otherwise it takes the worst of failed, untested and inconclusive.
 */
export function cellVerdict({ reliability, measures }) {
  const entries = Object.entries(measures);
  const verdicts = [reliability.verdict, ...entries.map(([, v]) => v.verdict)].map((v) =>
    v === 'traded' ? 'passed' : v,
  );
  return {
    verdict: worst(verdicts),
    traded: entries.filter(([, v]) => v.verdict === 'traded').map(([k]) => k),
  };
}

/**
 * The release verdict over the listed cells. `listed` names every cell the gate requires: { id, class, local }
 * (local: a required local cell such as the P30 Pro or eris). `results` maps a cell id to its cellVerdict, or to
 * { verdict: 'untested', unavailable: '<reason>' } for an explicitly unavailable hosted runner. A class is claimed
 * (passed) only when all its cells passed; each class's verdict is independent of the others. Handover is blocked by
 * any local cell that did not pass and by any failed cell; an unavailable hosted cell does not block.
 */
export function releaseVerdict({ listed, results }) {
  const cells = listed.map((c) => {
    const r = results[c.id];
    if (!r) return { ...c, verdict: 'untested', reason: 'no evidence for this cell' };
    if (r.unavailable && c.local)
      return {
        ...c,
        verdict: 'untested',
        reason: `required local cell unavailable: ${r.unavailable}`,
      };
    return { ...c, ...r };
  });
  const classes = {};
  for (const c of cells) (classes[c.class] ??= []).push(c.verdict);
  const byClass = Object.fromEntries(
    Object.entries(classes).map(([k, verdicts]) => [k, worst(verdicts)]),
  );
  const blockers = cells.filter(
    (c) => c.verdict === 'failed' || (c.local && c.verdict !== 'passed'),
  );
  return {
    cells,
    classes: byClass,
    claims: Object.keys(byClass).filter((k) => byClass[k] === 'passed'),
    handover: blockers.length ? 'blocked' : 'allowed',
    blockers: blockers.map((c) => ({ id: c.id, verdict: c.verdict, reason: c.reason })),
  };
}
