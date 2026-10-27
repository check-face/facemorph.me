// Release timing check (fm-fy2.11): the median of each measure over the paired runs that run.ts wrote, build against
// control. A measure fails when the build's median exceeds the control's by more than --threshold (a fraction) and, for
// a time, also by more than --floor-ms: a gap under 50 ms is below what a person notices (operator, 28 October 2026; one
// rule for every timed measure). Byte counts have the ratio alone. The build fails outright when any of its runs lost a
// face, photo face or video, crashed, reloaded, ran out of memory or fell back. Prints one line per measure and exits 1
// on any failure.
//
//   node scripts/verify/not-worse/median-check.mjs <run.ts --out dir> [--threshold 0.15] [--floor-ms 50]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Reads the run documents in `dir` (warmups excluded) into {control, build} lists of runs. */
export function loadRuns(dir) {
  const sides = { control: [], build: [] };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.includes('warmup')) continue;
    const doc = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (doc.schema !== 'facemorph.not-worse-run/1') continue;
    for (const run of doc.runs) (sides[run.side] ??= []).push(run);
  }
  return sides;
}

const values = (run) => ({
  ...run.measures.values,
  bytesFirst: run.measures.bytes?.first,
  bytesReturn: run.measures.bytes?.return,
});

const unreliable = (r) =>
  !r.faceProduced ||
  r.photoFaceProduced === false ||
  !r.videoProduced ||
  r.crash ||
  r.reloads > 0 ||
  r.outOfMemory ||
  r.fallback;

/** One row per measure present on both sides, then the verdict. */
export function check({ control, build }, threshold, floorMs = 50) {
  if (!control.length || !build.length)
    return { ok: false, rows: [], reason: 'a side has no runs' };
  const lost = build.filter((run) => unreliable(run.reliability));
  const names = Object.keys(values(control[0])).filter((k) =>
    [...control, ...build].every((run) => Number.isFinite(values(run)[k])),
  );
  const rows = names.map((measure) => {
    const c = median(control.map((run) => values(run)[measure]));
    const b = median(build.map((run) => values(run)[measure]));
    const ratio = c > 0 ? b / c : b > 0 ? Infinity : 1;
    const timed = measure.endsWith('Ms');
    return {
      measure,
      control: c,
      build: b,
      ratio,
      ok: ratio <= 1 + threshold || (timed && b - c <= floorMs),
    };
  });
  const ok = lost.length === 0 && rows.every((row) => row.ok);
  return {
    ok,
    rows,
    reason: lost.length ? `${lost.length} build run(s) lost a result or were unreliable` : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      threshold: { type: 'string', default: '0.15' },
      'floor-ms': { type: 'string', default: '50' },
    },
  });
  const threshold = Number(opt.threshold);
  const floorMs = Number(opt['floor-ms']);
  const result = check(loadRuns(positionals[0]), threshold, floorMs);
  for (const r of result.rows)
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.measure}: build ${r.build.toFixed(0)} / control ${r.control.toFixed(0)} = ${r.ratio.toFixed(3)} (limit ${(1 + threshold).toFixed(2)}${r.measure.endsWith('Ms') ? ` and +${floorMs} ms` : ''})`,
    );
  if (result.reason) console.log(`FAIL ${result.reason}`);
  console.log(result.ok ? 'timing check passed' : 'timing check failed');
  process.exitCode = result.ok ? 0 : 1;
}
