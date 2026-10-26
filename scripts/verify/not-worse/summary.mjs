// Per-cell summary of one paired not-worse run directory (fm-0q4h): reads every run document (run.schema.json) the
// desktop runner (run.ts) or the hosted mobile runner (mobile.py) wrote there, and reports per measure the medians
// per side, n, every scored pair's raw values in schedule order, and the min and max of the per-pair build/control
// ratio. When both sides are the same digest (control/control) it also reports the cell's noise margin per measure
// with the gate's own rule (scripts/verify/not-worse.mjs noiseMargin); the verdict itself stays fm-mc27's.
//   node scripts/verify/not-worse/summary.mjs <run dir> [--cell <name>] [--extra '<json>']   writes <dir>/summary.json
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_PAIRS, noiseMargin } from '../not-worse.mjs';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : null;
};

/** The comparable values of one run: the timed measures, bytes per visit and peak memory where reported. */
export function runValues(run) {
  const m = run.measures;
  return {
    ...m.values,
    bytesFirst: m.bytes.first,
    bytesReturn: m.bytes.return,
    peakMemory: typeof m.peakMemory === 'number' ? m.peakMemory : null,
    lockups: m.lockups,
  };
}

/** Pure: run documents in, summary out. `failed` names run files whose journey did not finish. */
export function summarize(docs, { failed = new Set() } = {}) {
  const runs = docs
    .flatMap((d) => d.doc.runs.map((r) => ({ file: d.file, run: r, values: runValues(r) })))
    .sort((a, b) => a.run.index - b.run.index);
  const digests = docs[0]?.doc.digests ?? null;
  const controlControl = digests !== null && digests.control === digests.build;
  const scored = runs.filter((r) => r.run.order !== 'warmup' && !failed.has(r.file));
  const pairIds = [...new Set(scored.map((r) => r.run.pair))].sort((a, b) => a - b);
  const names = Object.keys(runs[0]?.values ?? {});
  const measures = {};
  for (const n of names) {
    const side = (s) =>
      scored
        .filter((r) => r.run.side === s && typeof r.values[n] === 'number')
        .map((r) => r.values[n]);
    // control/control: both runs are the control, so "first" and "second" of each pair are the two sides.
    const pairs = [];
    for (const p of pairIds) {
      const inPair = scored.filter((r) => r.run.pair === p);
      const c = inPair.find((r) => r.run.side === 'control')?.values[n];
      const b = inPair.find((r) => r.run.side === 'build')?.values[n];
      if (typeof c === 'number' && typeof b === 'number')
        pairs.push({ pair: p, order: inPair[0].run.order, control: c, candidate: b });
    }
    const ratios = pairs
      .filter((p) => p.control > 0 && p.candidate > 0)
      .map((p) => p.candidate / p.control);
    let margin = null;
    let marginReason = null;
    if (controlControl) {
      const positive = pairs.filter((p) => p.control > 0 && p.candidate > 0);
      if (positive.length < MIN_PAIRS)
        marginReason = `${positive.length} complete pairs with positive values; ${MIN_PAIRS} needed`;
      else margin = noiseMargin(positive);
    }
    measures[n] = {
      controlMedian: median(side('control')),
      buildMedian: median(side('build')),
      n: [side('control').length, side('build').length],
      pairs,
      ratioMin: ratios.length ? Math.min(...ratios) : null,
      ratioMax: ratios.length ? Math.max(...ratios) : null,
      ...(controlControl
        ? { noiseMargin: margin, ...(marginReason ? { noiseMarginUnset: marginReason } : {}) }
        : {}),
    };
  }
  const reliability = runs.map((r) => ({
    file: r.file,
    side: r.run.side,
    pair: r.run.pair,
    order: r.run.order,
    ...r.run.reliability,
  }));
  return {
    controlControl,
    digests,
    cell: docs[0]?.doc.cell ?? null,
    runs: runs.length,
    scoredPairs: pairIds.length,
    reliability,
    reliabilityEvents: reliability.filter(
      (r) =>
        r.crash ||
        r.reloads ||
        r.outOfMemory ||
        r.fallback ||
        r.uncaughtErrors ||
        !r.faceProduced ||
        !r.videoProduced,
    ),
    measures,
  };
}

/** Reads <dir>/NN-*.json run documents (not traces, not summary) and the failures recorded beside them. */
export function summarizeDir(dir, extra = {}) {
  const files = readdirSync(dir)
    .filter((f) => /^\d\d-.*\.json$/.test(f) && !f.endsWith('.trace.json'))
    .sort();
  const docs = files.map((file) => ({
    file,
    doc: JSON.parse(readFileSync(join(dir, file), 'utf8')),
  }));
  const failed = new Set(
    files.filter((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f.replace(/\.json$/, '.trace.json')), 'utf8'))
          .failure;
      } catch {
        return false;
      }
    }),
  );
  const summary = { ...extra, ...summarize(docs, { failed }), failures: [...failed] };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) throw new Error('usage: summary.mjs <run dir> [--extra <json>]');
  const i = rest.indexOf('--extra');
  const s = summarizeDir(dir, i >= 0 ? JSON.parse(rest[i + 1]) : {});
  const margins = Object.fromEntries(
    Object.entries(s.measures).map(([k, v]) => [k, v.noiseMargin ?? v.noiseMarginUnset ?? null]),
  );
  console.log(
    JSON.stringify({
      summary: { dir, controlControl: s.controlControl, pairs: s.scoredPairs, margins },
    }),
  );
}
