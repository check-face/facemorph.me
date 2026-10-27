// Release timing check (fm-fy2.11): the median of each measure over the paired runs that run.ts wrote, build against
// control. A measure fails when the build's median exceeds the control's by more than --threshold (a fraction) and, for
// a time, also by more than --floor-ms: a gap under 50 ms is below what a person notices (operator, 28 October 2026; one
// rule for every timed measure). Byte counts have the ratio alone. The build fails outright when any of its runs lost a
// product its segment needs (face, photo face, video), crashed, reloaded, ran out of memory, fell back or did not finish.
//
// It takes any number of run.ts output dirs (a dir, or a dir holding them, searched three levels deep): one per job,
// each job one segment and one or more pairs on one runner. Dirs of a segment are merged by global pair index; each
// segment is decided on its own by the sequential rule (`decide`) and the release verdict is pass only if every segment
// passes. Prints the per-measure table with every pair, writes it as JSON (--json), prints the local command that
// reproduces a failing or undecided segment, and exits 0 pass, 1 fail, 3 more pairs needed (--github-output gets
// verdict=pass|fail|more and more={"<segment>":[next pair indexes]}).
//
//   node scripts/verify/not-worse/median-check.mjs <dir>... [--threshold 0.15] [--floor-ms 50] [--min-pairs 3]
//     [--max-pairs 7] [--expect face,morph,photo] [--json <file>] [--github-output <file>]
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SEGMENTS } from './workload.ts';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const SEGMENT_SCHEMA = 'facemorph.not-worse-segment/1';

/** Reads one run.ts output dir: its runs (warmups excluded, each with the trace's failure text) and its segment.json. */
export function loadDir(dir) {
  const runs = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.endsWith('.trace.json') || name.includes('warmup'))
      continue;
    const doc = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (doc.schema !== 'facemorph.not-worse-run/1') continue;
    const tracePath = join(dir, name.replace(/\.json$/, '.trace.json'));
    const failure = existsSync(tracePath)
      ? (JSON.parse(readFileSync(tracePath, 'utf8')).failure ?? null)
      : null;
    for (const run of doc.runs)
      runs.push({ ...run, file: name, failure, digests: doc.digests, cell: doc.cell });
  }
  const metaPath = join(dir, 'segment.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  if (meta && meta.schema !== SEGMENT_SCHEMA) throw new Error(`${metaPath}: not ${SEGMENT_SCHEMA}`);
  return { dir, segment: meta?.segment ?? 'all', meta, runs };
}

/** Back-compatible: one dir's runs as {control, build} lists. */
export function loadRuns(dir) {
  const sides = { control: [], build: [] };
  for (const run of loadDir(dir).runs) (sides[run.side] ??= []).push(run);
  return sides;
}

/** The run.ts output dirs under each path: a path that holds run documents or a segment.json, else its subdirs. */
export function findDirs(paths, depth = 3) {
  const out = [];
  for (const p of paths) {
    const names = readdirSync(p);
    if (
      names.includes('segment.json') ||
      names.some((n) => /^\d+-(control|build)-.*\.json$/.test(n))
    )
      out.push(p);
    else if (depth > 0)
      out.push(
        ...findDirs(
          names.map((n) => join(p, n)).filter((q) => statSync(q).isDirectory()),
          depth - 1,
        ),
      );
  }
  return out;
}

export const values = (run) => ({
  ...run.measures.values,
  bytesFirst: run.measures.bytes?.first,
  bytesReturn: run.measures.bytes?.return,
});

const ALL_PRODUCTS = SEGMENTS.all.produces;

/** Why a build run does not count (null when it does): a lost product of its segment, a crash, a reload, OOM, fallback. */
export function unreliable(run, produces = ALL_PRODUCTS) {
  const r = run.reliability;
  if (run.failure) return `did not finish: ${run.failure}`;
  if (produces.includes('face') && !r.faceProduced) return 'lost the face';
  if (produces.includes('photo-face') && r.photoFaceProduced === false)
    return 'lost the photo face';
  if (produces.includes('video') && !r.videoProduced) return 'lost the video';
  if (r.crash) return 'crashed';
  if (r.reloads > 0) return 'reloaded';
  if (r.outOfMemory) return 'ran out of memory';
  if (r.fallback) return 'fell back from the requested route';
  return null;
}

/** The release rule for one value pair (or pair of medians): within 1 + threshold, or for a time within the floor. */
export function within(measure, build, control, threshold, floorMs = 50) {
  const ratio = control > 0 ? build / control : build > 0 ? Infinity : 1;
  return {
    ratio,
    ok: ratio <= 1 + threshold || (measure.endsWith('Ms') && build - control <= floorMs),
  };
}

/**
 * One row per measure, then the verdict, from the medians per side. With `measures` (a segment's list) every one of
 * them is compared and a build run without a value fails its row; without it, the measures present on every run.
 */
export function check({ control, build }, threshold, floorMs = 50, { measures, produces } = {}) {
  if (!control.length || !build.length)
    return { ok: false, rows: [], reason: 'a side has no runs' };
  const lost = build.filter((run) => unreliable(run, produces));
  const names =
    measures ??
    Object.keys(values(control[0])).filter((k) =>
      [...control, ...build].every((run) => Number.isFinite(values(run)[k])),
    );
  const rows = names.map((measure) => {
    const cs = control.map((run) => values(run)[measure]).filter(Number.isFinite);
    const bs = build.map((run) => values(run)[measure]).filter(Number.isFinite);
    if (!cs.length || bs.length < build.length)
      return {
        measure,
        control: cs.length ? median(cs) : null,
        build: bs.length ? median(bs) : null,
        ratio: null,
        ok: false,
        note: cs.length ? 'missing from a build run' : 'no control value',
      };
    const c = median(cs);
    const b = median(bs);
    return { measure, control: c, build: b, ...within(measure, b, c, threshold, floorMs) };
  });
  const ok = lost.length === 0 && rows.every((row) => row.ok);
  return {
    ok,
    rows,
    reason: lost.length ? `${lost.length} build run(s) lost a result or were unreliable` : null,
  };
}

/** Runs grouped into pairs by global pair index: [{pair, order, control, build}] (a side is null when absent). */
export function toPairs(runs) {
  const byPair = new Map();
  for (const run of runs) {
    if (run.pair === null || run.order === 'warmup') continue;
    const p = byPair.get(run.pair) ?? {
      pair: run.pair,
      order: run.order,
      control: null,
      build: null,
    };
    if (p[run.side]) throw new Error(`pair ${run.pair} has two ${run.side} runs`);
    p[run.side] = run;
    byPair.set(run.pair, p);
  }
  return [...byPair.values()].sort((a, b) => a.pair - b.pair);
}

/**
 * The sequential stop rule for one segment, over every pair attempted so far (pure). A pair is complete when both its
 * runs finished; a pair whose control run failed is incomplete and does not count; a build run that failed or is
 * unreliable fails the segment at once.
 *   1. Any build run unreliable or unfinished: fail.
 *   2. Fewer than `minPairs` complete pairs: more (enough to reach the minimum), or fail once `maxPairs` were attempted.
 *   3. Clear fail: some measure is over the rule (ratio above 1 + threshold and, for a time, more than floorMs slower)
 *      in every complete pair, and its median is over too. (Over in every pair forces the median over: if b_i > f(c_i)
 *      with f(c) = max(c(1 + t), c + floor) increasing, each order statistic of b exceeds f of that of c, and f is
 *      convex, so an even count's mean of the two middles is over as well.)
 *   4. Clear pass: every measure is within the rule in every complete pair and the medians pass.
 *   5. `maxPairs` attempted: the medians decide (median-check's rule).
 *   6. Otherwise: more, the rest up to `maxPairs` (one more wave).
 * Steps 3 and 4 only end early when every pair already agrees with the medians' verdict; the verdict is always the
 * median rule's except where step 1 or 2 fails a build outright.
 */
export function decide(
  pairs,
  { threshold = 0.15, floorMs = 50, minPairs = 3, maxPairs = 7, segment = 'all' } = {},
) {
  const { measures, produces } = SEGMENTS[segment];
  const attempted = pairs.length;
  const nextPairs = (k) => {
    const used = new Set(pairs.map((p) => p.pair));
    const out = [];
    for (let i = 0; out.length < k; i++) if (!used.has(i)) out.push(i);
    return out;
  };
  const finish = (verdict, reason, extra = {}) => ({
    verdict,
    reason,
    attempted,
    complete: complete.length,
    more: verdict === 'more' ? (extra.more ?? 0) : 0,
    nextPairs: verdict === 'more' ? nextPairs(extra.more) : [],
    rows: extra.rows ?? [],
  });
  const complete = pairs.filter(
    (p) => p.control && p.build && !p.control.failure && !p.build.failure,
  );
  const bad = pairs
    .filter((p) => p.build)
    .map((p) => [p.pair, unreliable(p.build, produces)])
    .filter(([, why]) => why);
  const rows = (() => {
    if (!complete.length) return [];
    const medians = check(
      { control: complete.map((p) => p.control), build: complete.map((p) => p.build) },
      threshold,
      floorMs,
      { measures, produces },
    );
    return medians.rows.map((row) => ({
      ...row,
      timed: row.measure.endsWith('Ms'),
      pairs: complete.map((p) => {
        const c = values(p.control)[row.measure];
        const b = values(p.build)[row.measure];
        return Number.isFinite(c) && Number.isFinite(b)
          ? {
              pair: p.pair,
              order: p.order,
              control: c,
              build: b,
              ...within(row.measure, b, c, threshold, floorMs),
            }
          : {
              pair: p.pair,
              order: p.order,
              control: c ?? null,
              build: b ?? null,
              ratio: null,
              ok: false,
            };
      }),
    }));
  })();
  if (bad.length)
    return finish('fail', bad.map(([pair, why]) => `pair ${pair} build run ${why}`).join('; '), {
      rows,
    });
  if (complete.length < minPairs)
    return attempted >= maxPairs
      ? finish(
          'fail',
          `${complete.length} complete pair(s) of ${attempted}, fewer than ${minPairs}`,
          {
            rows,
          },
        )
      : finish('more', `${complete.length} complete pair(s), fewer than ${minPairs}`, {
          rows,
          more: Math.min(minPairs - complete.length, maxPairs - attempted),
        });
  const overAll = rows.filter((r) => !r.ok && r.pairs.every((p) => !p.ok));
  if (overAll.length)
    return finish(
      'fail',
      `over the rule in every pair: ${overAll.map((r) => r.measure).join(', ')}`,
      {
        rows,
      },
    );
  const medianOk = rows.every((r) => r.ok);
  if (medianOk && rows.every((r) => r.pairs.every((p) => p.ok)))
    return finish('pass', `within the rule in every pair (${complete.length})`, { rows });
  if (attempted >= maxPairs)
    return finish(
      medianOk ? 'pass' : 'fail',
      `${attempted} pairs attempted (the maximum): the medians decide`,
      { rows },
    );
  return finish('more', 'pairs disagree: more pairs', { rows, more: maxPairs - attempted });
}

/** Every dir merged per segment and decided; digests and cell must agree across dirs. Pure over loaded dirs. */
export function evaluate(loaded, options = {}) {
  const segments = {};
  for (const d of loaded) (segments[d.segment] ??= []).push(d);
  const problems = [];
  const first = loaded.flatMap((d) => d.runs)[0];
  for (const d of loaded)
    for (const run of d.runs) {
      if (
        run.digests.control !== first.digests.control ||
        run.digests.build !== first.digests.build
      )
        problems.push(`${d.dir}: digests differ from ${first.file}'s`);
      if (run.cell.provider !== first.cell.provider || run.cell.browser !== first.cell.browser)
        problems.push(`${d.dir}: cell ${run.cell.provider}/${run.cell.browser} differs`);
    }
  for (const s of options.expect ?? []) if (!segments[s]) problems.push(`segment ${s} has no dir`);
  const result = {};
  for (const [segment, dirs] of Object.entries(segments)) {
    let pairs;
    try {
      pairs = toPairs(dirs.flatMap((d) => d.runs));
    } catch (error) {
      problems.push(`segment ${segment}: ${error.message}`);
      continue;
    }
    result[segment] = {
      dirs: dirs.map((d) => d.dir),
      invocation: dirs.find((d) => d.meta)?.meta.invocation ?? null,
      ...decide(pairs, { ...options, segment }),
    };
  }
  const verdicts = Object.values(result).map((s) => s.verdict);
  const verdict =
    problems.length || !verdicts.length || verdicts.includes('fail')
      ? 'fail'
      : verdicts.includes('more')
        ? 'more'
        : 'pass';
  problems.splice(0, problems.length, ...new Set(problems));
  return {
    schema: 'facemorph.not-worse-timing/1',
    verdict,
    threshold: options.threshold ?? 0.15,
    floorMs: options.floorMs ?? 50,
    minPairs: options.minPairs ?? 3,
    maxPairs: options.maxPairs ?? 7,
    digests: first?.digests ?? null,
    cell: first ? { provider: first.cell.provider, browser: first.cell.browser } : null,
    problems,
    segments: result,
  };
}

/** The command that reruns one segment locally, the CI paths and digests replaced by the local ones. */
export function reproduce(segment, s, { minPairs, maxPairs }) {
  const inv = s.invocation ?? {};
  const args = [
    '--control .cache/control/tree/deploy-next',
    `--control-digest "$(node -p 'require("./autoresearch/drivers/control.json").treeSha256')"`,
    '--build deploy-next',
    `--build-digest "$(node --input-type=module -e "import {treeDigest} from './scripts/ci/fetch-artifact.ts'; console.log(treeDigest('deploy-next'))")"`,
    '--build-source local:repro',
    `--segment ${segment}`,
    `--pairs ${minPairs} --max-pairs ${maxPairs}`,
    `--provider ${inv.provider ?? 'cpu'} --browser ${inv.browser ?? 'chromium'}`,
    '--runtime "${FACEMORPH_RUNTIME_DIR:-.cache/runtime}"',
    `--label repro-${segment}-$(date +%s) --out .cache/not-worse`,
  ];
  return [
    `# ${segment}: the CI build was ${inv.buildDigest ?? 'unknown'} (${inv.buildSource ?? 'unknown source'}); build deploy-next locally or download that artifact into deploy-next/ and check the digest`,
    `python3 autoresearch/run.py --exclusive gpu-timing --wait 0 --timeout 3600 -- \\\n  node scripts/verify/not-worse/run.ts ${args.join(' \\\n    ')}`,
  ].join('\n');
}

const fmt = (x, measure) =>
  x === null || x === undefined
    ? '-'
    : measure.endsWith('Ms')
      ? x.toFixed(0)
      : String(Math.round(x));
const fr = (r) => (r === null || r === undefined ? '-' : Number.isFinite(r) ? r.toFixed(3) : 'inf');

/** The per-measure, per-pair table (markdown) and the verdict lines. */
export function report(result) {
  const lines = [];
  const { threshold, floorMs } = result;
  for (const [segment, s] of Object.entries(result.segments)) {
    lines.push(
      `### ${segment}: ${s.verdict} (${s.reason}; ${s.complete} complete of ${s.attempted} pairs)`,
      '',
      '| | measure | build | control | ratio | pairs: build / control = ratio |',
      '|---|---|---|---|---|---|',
    );
    for (const r of s.rows)
      lines.push(
        `| ${r.ok ? 'ok' : 'FAIL'} | ${r.measure} | ${fmt(r.build, r.measure)} | ${fmt(r.control, r.measure)} | ${fr(r.ratio)}${r.note ? ` (${r.note})` : ''} | ${r.pairs
          .map(
            (p) =>
              `p${p.pair} ${p.order}: ${fmt(p.build, r.measure)} / ${fmt(p.control, r.measure)} = ${fr(p.ratio)}${p.ok ? '' : ' over'}`,
          )
          .join('; ')} |`,
      );
    lines.push(
      '',
      `Limit ${(1 + threshold).toFixed(2)}x, and for times also +${floorMs} ms. Dirs: ${s.dirs.join(', ')}`,
      '',
    );
  }
  for (const p of result.problems) lines.push(`FAIL ${p}`);
  if (result.verdict !== 'pass') {
    const rerun = Object.entries(result.segments).filter(([, s]) => s.verdict !== 'pass');
    if (rerun.length) {
      lines.push('Reproduce locally:', '', '```sh');
      for (const [segment, s] of rerun) lines.push(reproduce(segment, s, result));
      lines.push('```', '');
    }
  }
  lines.push(
    result.verdict === 'pass'
      ? 'timing check passed'
      : result.verdict === 'more'
        ? `timing check needs more pairs: ${Object.entries(result.segments)
            .filter(([, s]) => s.verdict === 'more')
            .map(([k, s]) => `${k} [${s.nextPairs.join(', ')}]`)
            .join('; ')}`
        : 'timing check failed',
  );
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      threshold: { type: 'string', default: '0.15' },
      'floor-ms': { type: 'string', default: '50' },
      'min-pairs': { type: 'string', default: '3' },
      'max-pairs': { type: 'string', default: '7' },
      expect: { type: 'string' },
      json: { type: 'string' },
      'github-output': { type: 'string' },
    },
  });
  if (!positionals.length) throw new Error('give at least one run.ts output dir');
  const options = {
    threshold: Number(opt.threshold),
    floorMs: Number(opt['floor-ms']),
    minPairs: Number(opt['min-pairs']),
    maxPairs: Number(opt['max-pairs']),
    expect: opt.expect ? opt.expect.split(',') : [],
  };
  const dirs = findDirs(positionals);
  const result = evaluate(dirs.map(loadDir), options);
  console.log(report(result));
  if (opt.json) writeFileSync(opt.json, JSON.stringify(result, null, 2) + '\n');
  if (opt['github-output'])
    appendFileSync(
      opt['github-output'],
      `verdict=${result.verdict}\nmore=${JSON.stringify(
        Object.fromEntries(
          Object.entries(result.segments)
            .filter(([, s]) => s.verdict === 'more')
            .map(([k, s]) => [k, s.nextPairs]),
        ),
      )}\n`,
    );
  process.exitCode = result.verdict === 'pass' ? 0 : result.verdict === 'more' ? 3 : 1;
}
