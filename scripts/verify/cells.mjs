#!/usr/bin/env node
// The parity harness's per-cell performance and retained-lane table (fm-q007): every cell the plan protects, with its
// workload boundary, measures, the control/control margin and its source, and the verdict from the shared
// strictly-not-worse rule (not-worse.mjs). A cell with no paired runs is untested, never passed; evidence-gap rows are
// always untested. Paired results come from a JSON file: { "<cell id>": { "reliability": [...], "noise": {...},
//   "measures": { "<measure>": { "pairs": [{control, candidate}], "noisePairs": [...] | "margin": n, "marginSource": "..." } } } }
//   node scripts/verify/cells.mjs [--results results.json] [--markdown]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cellVerdict, measureVerdict, reliabilityVerdict } from './not-worse.mjs';

const FIRST_SAVE_TRADE =
  'first-Save size/latency (PLAN.md retained evidence: 108.63 -> 202.17 ms for 4.38 MB -> 117 KB)';

/** The cells: the three evidence-register rows, the four baseline-note items, and the evidence gaps. */
export const CELLS = [
  {
    id: 'eris-webgpu-warm-morph',
    kind: 'register',
    lane: 'eris RTX 2080 SUPER, Chromium 152, WebGPU (under the shared device lease)',
    workload: 'warm 26-frame morph, ABBA x4; boundary: last frame drawn',
    measures: ['pipelineMsPerFrame', 'rgba8MsPerFrame', 'warmFaceMs'],
  },
  {
    id: 'ubuntu-chrome-cpu-retained',
    kind: 'register',
    lane: 'Ubuntu 24.04 Chrome, CPU route',
    workload:
      'retained/reopened profiles, ABBA x3; boundaries: repeat original drawn, Save handoff',
    measures: ['repeatOriginalMs', 'repeatSaveMs', 'firstSaveMs'],
    trades: { firstSaveMs: FIRST_SAVE_TRADE },
  },
  {
    id: 'ios-simulator-product',
    kind: 'register',
    lane: 'iPhone 16 Pro Simulator, iOS 18.5 product job (build.ci-mobile)',
    workload: 'first full-1024 face; warm synthesis',
    measures: ['firstFullFaceMs', 'warmSynthesisMs'],
  },
  {
    id: 'baseline.mobile-controls-crop-geometry',
    kind: 'baseline-note',
    lane: 'phone width, touch',
    workload: 'mobile controls and crop geometry fixes (11 October note, b2d945a8)',
    measures: [],
    reliabilityOnly: true,
  },
  {
    id: 'baseline.webp-retention-png-fallback',
    kind: 'baseline-note',
    lane: 'CPU route',
    workload: 'background WebP retention with PNG fallback',
    measures: ['retainedBytes'],
  },
  {
    id: 'baseline.compressed-session-recovery',
    kind: 'baseline-note',
    lane: 'CPU route',
    workload:
      'bounded compressed multi-face/video/scrub session recovery without repeated inference',
    measures: ['restoreMs', 'restoreInferenceRequests'],
  },
  {
    id: 'baseline.async-retention-checks',
    kind: 'baseline-note',
    lane: 'CPU route',
    workload: 'corrected asynchronous retention checks',
    measures: [],
    reliabilityOnly: true,
  },
  {
    id: 'gap.physical-iphone',
    kind: 'evidence-gap',
    lane: 'physical iPhones',
    workload: 'no device in the lab',
    measures: [],
  },
  {
    id: 'gap.firefox-webkit-performance',
    kind: 'evidence-gap',
    lane: 'current Firefox and WebKit, full performance',
    workload: 'not measured',
    measures: [],
  },
  {
    id: 'gap.gtx1050-inference',
    kind: 'evidence-gap',
    lane: 'GTX 1050 inference (next-gpu-lane.yml, evidence not a gate)',
    workload: 'not measured',
    measures: [],
  },
];

export function tableRows(results = {}) {
  return CELLS.map((cell) => {
    if (cell.kind === 'evidence-gap')
      return {
        ...cell,
        verdict: 'untested',
        reason: 'evidence gap: no run exists or can run on available devices',
        measures: {},
      };
    const r = results[cell.id];
    if (!r)
      return {
        ...cell,
        verdict: 'untested',
        reason: 'no paired control/port runs recorded for this cell',
        measures: {},
      };
    const reliability = reliabilityVerdict(r.reliability ?? []);
    const measures = Object.fromEntries(
      cell.measures.map((m) => {
        const input = r.measures?.[m];
        const v = input
          ? measureVerdict({
              pairs: input.pairs,
              noise: input.margin ?? input.noisePairs ?? null,
              trade: cell.trades?.[m] ?? null,
            })
          : { verdict: 'untested', reason: 'measure not recorded' };
        return [
          m,
          {
            ...v,
            marginSource:
              input?.marginSource ??
              (input?.noisePairs ? 'control/control pairs on this cell' : null),
          },
        ];
      }),
    );
    const overall = cellVerdict({ reliability, measures });
    return { ...cell, verdict: overall.verdict, traded: overall.traded, reliability, measures };
  });
}

const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : '-');
export function markdown(rows) {
  const lines = [
    '| Cell | Kind | Lane | Workload / boundary | Verdict | Measures (ratio [95% interval], margin, source) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const measures = Object.entries(r.measures ?? {})
      .map(
        ([m, v]) =>
          `${m}: ${v.verdict}${v.ratio ? ` ${fmt(v.ratio)} [${fmt(v.low)}, ${fmt(v.high)}], margin ${fmt(v.margin)} (${v.marginSource ?? 'unknown'})` : ''}`,
      )
      .join('; ');
    lines.push(
      `| ${r.id} | ${r.kind} | ${r.lane} | ${r.workload} | ${r.verdict}${r.reason ? ` (${r.reason})` : ''} | ${measures || '-'} |`,
    );
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--results');
  const results = i > 0 ? JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) : {};
  const rows = tableRows(results);
  process.stdout.write(
    process.argv.includes('--markdown')
      ? markdown(rows)
      : rows
          .map((r) => JSON.stringify({ id: r.id, verdict: r.verdict, reason: r.reason }))
          .join('\n') + '\n',
  );
}
