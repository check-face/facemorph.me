// Dashboard totals check (fm-5yqq): every panel query of dashboards/facemorph-changeover.json returns the same
// result on a real Prometheus scrape of the labelled Worker (services/stats/worker.mjs, with its per-build and
// per-host labels) as on the same Worker with those labels removed, for identical generated traffic.
//
// Both Workers run in real workerd (miniflare, from services/stats/node_modules) with their SQLite Durable Object;
// one real Prometheus (docker, prom/prometheus) scrapes both as jobs `labelled` and `unlabelled`. Panel queries are
// evaluated per job by adding a job matcher to each fm_web_ selector.
//
// Exactness: increase()/rate() extrapolate per series from the samples in the window, so they are linear (and a sum
// over the new labels equals the unlabelled total) only when every series has the same sample times and none is
// extrapolated back to zero. Production series are long-lived and scraped together, so that is the steady state; a
// series that first appears inside the window (a new build/host pair, e.g. the first monorepo beacons) extrapolates
// its start by itself, a difference of at most half a scrape interval's share of that series' increase, on that day
// only. Here every series exists before the first scrape with a large seed, both scrape pools stop together (config
// reload) once both have the same scrape count, and queries run more than 1.1 intervals after, so both jobs have the
// same sample count. A seed of 1 instead of 6 shows the new-series effect (up to ~21% on this 75 s run). Usage: `node ops/grafana/check-dashboard-totals.mjs` (needs docker and
// `npm ci` in services/stats).
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const stats = here('../../services/stats/');
const { Miniflare } = createRequire(join(stats, 'package.json'))('miniflare');
const workerd = createRequire(createRequire(join(stats, 'package.json')).resolve('miniflare'))(
  'workerd',
);
const IMAGE = process.env.PROMETHEUS_IMAGE || 'prom/prometheus:v3.5.0';
const INTERVAL = 5; // seconds
const TOKEN = 'local-dashboard-check';
const PROM_PORT = Number(process.env.PROMETHEUS_PORT || 19090);
const SERIES = [
  'fm_web_visits_total',
  'fm_web_jobs_total',
  'fm_web_job_duration_seconds_bucket',
  'fm_web_job_warm_seconds_bucket',
  'fm_web_compute_seconds_bucket',
  'fm_web_model_ready_seconds_bucket',
  'fm_web_time_to_first_result_seconds_bucket',
  'fm_web_morph_frames_total',
  'fm_web_exports_total',
  'fm_web_model_megabytes_total',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function worker(scriptPath, persist) {
  const mf = new Miniflare({
    modules: true,
    scriptPath,
    modulesRoot: dirname(scriptPath),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
    compatibilityDate:
      workerd.compatibilityDate < '2026-09-16' ? workerd.compatibilityDate : '2026-09-16',
    cf: false,
    host: '127.0.0.1',
    port: 0,
    bindings: { SCRAPE_TOKEN: TOKEN },
    durableObjects: { COUNTERS: { className: 'StatsCounters', useSQLite: true } },
    durableObjectsPersist: persist,
  });
  return { mf, url: await mf.ready };
}

// Generated traffic: every event kind, both builds, both hosts, several platforms. Batch k scales the counts.
const platforms = ['ios', 'android', 'desktop', 'unknown'];
function beacons(k) {
  const out = [];
  for (const app of ['candidate', 'monorepo', undefined]) {
    for (const origin of ['https://next.facemorph.me', 'https://facemorph.me']) {
      const events = [];
      platforms.forEach((platform, p) => {
        const n = k + p;
        for (let i = 0; i < n; i++) {
          events.push({ t: 'visit', platform, visit: i % 3 ? 'returning' : 'first' });
          for (const action of ['face', 'photo', 'morph', 'names', 'blend'])
            for (const route of ['cpu', 'webgpu'])
              events.push({
                t: 'job',
                action,
                route,
                outcome: 'completed',
                platform,
                ms: 80 + 900 * i + 37 * p,
              });
          events.push({ t: 'job', action: 'face', route: 'auto', outcome: 'failed', platform });
          events.push({
            t: 'job',
            action: 'morph',
            route: 'cpu',
            outcome: 'cancelled',
            platform,
            ms: 400,
          });
          events.push({
            t: 'job_warm',
            action: i % 2 ? 'face' : 'blend',
            route: 'webgpu',
            platform,
            ms: 120 + 50 * i,
          });
          events.push({
            t: 'compute',
            action: i % 2 ? 'names' : 'face',
            route: 'cpu',
            platform,
            ms: 900 + 10 * i,
          });
          events.push({
            t: 'model',
            phase: i % 2 ? 'cache' : 'download',
            platform,
            ms: 3000 + 700 * i,
          });
          events.push({ t: 'ttfr', cache: i % 2 ? 'warm' : 'cold', platform, ms: 1500 + 400 * i });
          events.push({ t: 'frames', platform, n: 24 + i });
          events.push({
            t: 'export',
            kind: i % 2 ? 'video' : 'image',
            method: i % 3 ? 'save' : 'share',
            platform,
          });
          events.push({ t: 'model_mb', cache: i % 2 ? 'warm' : 'cold', platform, mb: 211.7 });
        }
      });
      // One beacon per <= 25 events keeps every body under the Worker's 4 KB limit.
      for (let i = 0; i < events.length; i += 25)
        out.push({
          origin,
          body: JSON.stringify({ v: 1, ...(app ? { app } : {}), events: events.slice(i, i + 25) }),
        });
    }
  }
  return out;
}

let ip = 0;
async function post(targets, k) {
  const list = beacons(k);
  for (const { origin, body } of list)
    for (const { mf } of targets) {
      const r = await mf.dispatchFetch(`${origin}/stats/v1`, {
        method: 'POST',
        body,
        headers: {
          origin,
          'sec-fetch-site': 'same-origin',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
          'cf-connecting-ip': `198.51.${(ip >> 8) & 255}.${ip & 255}`,
        },
      });
      if (r.status !== 204) throw Error(`beacon refused: ${r.status} ${body.slice(0, 80)}`);
      ip++;
    }
  return list.length;
}

const prom = (path, params = {}) =>
  fetch(`http://127.0.0.1:${PROM_PORT}${path}?${new URLSearchParams(params)}`).then((r) =>
    r.json(),
  );

function config(targets) {
  const jobs = targets
    .map(
      ({ name, url }) => `  - job_name: ${name}
    scrape_interval: ${INTERVAL}s
    metrics_path: /stats/metrics
    authorization: { type: Bearer, credentials: ${TOKEN} }
    static_configs: [{ targets: ['${new URL(url).host}'] }]`,
    )
    .join('\n');
  return `global: { scrape_interval: ${INTERVAL}s }\nscrape_configs:\n${jobs}\n`;
}

const withJob = (expr, job) =>
  expr.replace(
    /\b(fm_web_\w+)(\{([^}]*)\})?/g,
    (_, name, _b, inner) => `${name}{job="${job}"${inner ? `,${inner}` : ''}}`,
  );
const key = (metric) =>
  JSON.stringify(
    Object.entries(metric)
      .filter(([k]) => k !== 'job' && k !== 'instance')
      .sort(),
  );

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'fm-dashboard-check-'));
  const src = await readFile(join(stats, 'worker.mjs'), 'utf8');
  const stripped = src.replaceAll('${site},', '');
  if (stripped.includes('${site}')) throw Error('unlabelled variant still uses the site labels');
  await writeFile(join(dir, 'worker.mjs'), stripped);
  await writeFile(
    join(dir, 'entry.mjs'),
    "export { default, StatsCounters } from './worker.mjs';\n",
  );
  const labelled = {
    name: 'labelled',
    ...(await worker(join(stats, 'entry.mjs'), join(dir, 'db-a'))),
  };
  const unlabelled = {
    name: 'unlabelled',
    ...(await worker(join(dir, 'entry.mjs'), join(dir, 'db-b'))),
  };
  const targets = [labelled, unlabelled];
  const cfg = join(dir, 'prometheus.yml');
  const container = `fm-dashboard-check-${process.pid}`;
  let ok = false;
  try {
    // Every series exists before the first scrape, with a value large enough against the later increments that no
    // series is extrapolated back to zero: the steady state of long-lived series, where increase() is linear.
    log('seed beacons per Worker:', await post(targets, 6));
    await writeFile(cfg, config(targets));
    await chmod(dir, 0o755);
    await chmod(cfg, 0o644);
    execFileSync('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      container,
      '--network',
      'host',
      '-v',
      `${cfg}:/etc/prometheus/prometheus.yml:ro`,
      IMAGE,
      '--config.file=/etc/prometheus/prometheus.yml',
      `--web.listen-address=127.0.0.1:${PROM_PORT}`,
      '--web.enable-lifecycle',
      '--storage.tsdb.path=/prometheus',
    ]);
    log('prometheus', IMAGE, 'container', container);
    for (let i = 0; ; i++) {
      await sleep(1000);
      const up = await prom('/api/v1/query', { query: 'up' }).catch(() => null);
      if (up?.data?.result?.length === 2 && up.data.result.every((r) => r.value[1] === '1')) break;
      if (i > 60) throw Error('targets never came up: ' + JSON.stringify(up));
    }
    // Samples per fm_web_ series of a job: the smallest and largest count (equal once every series was scraped
    // alike), as one comparable number, min * 1000 + max.
    const count = async (job, time) => {
      const one = async (agg, name) => {
        const r = await prom('/api/v1/query', {
          query: `${agg}(count_over_time(${name}{job="${job}"}[1d]))`,
          ...(time ? { time } : {}),
        });
        if (r.status !== 'success') throw Error(r.error);
        return Number(r.data.result[0]?.value[1] ?? 0);
      };
      let lo = Infinity,
        hi = 0;
      for (const name of SERIES) {
        lo = Math.min(lo, await one('min', name));
        hi = Math.max(hi, await one('max', name));
      }
      return lo * 1000 + hi;
    };
    const counts = async () => ({
      labelled: await count('labelled'),
      unlabelled: await count('unlabelled'),
    });
    const waitScrapes = async (n) => {
      const start = await counts();
      const goal = Math.max(start.labelled % 1000, start.unlabelled % 1000) + n;
      const level = (v) => Math.floor(v / 1000) === v % 1000;
      for (;;) {
        await sleep(100);
        const c = await counts();
        if (c.labelled % 1000 >= goal && c.labelled === c.unlabelled && level(c.labelled)) return c;
      }
    };
    await waitScrapes(3);
    log('second traffic batch:', await post(targets, 2));
    await waitScrapes(3);
    log('third traffic batch:', await post(targets, 1));
    const before = await waitScrapes(3);
    // Stop both scrape pools together right after both reached the same scrape count.
    await writeFile(cfg, 'global: { scrape_interval: 5s }\nscrape_configs: []\n');
    const reload = await fetch(`http://127.0.0.1:${PROM_PORT}/-/reload`, { method: 'POST' });
    if (!reload.ok) throw Error(`reload failed ${reload.status}`);
    log('scraping stopped after', before);
    await sleep((INTERVAL * 1.1 + 5) * 1000);
    const at = String(Date.now() / 1000);
    const samples = {
      labelled: await count('labelled', at),
      unlabelled: await count('unlabelled', at),
    };
    log('samples per job (min*1000+max over fm_web_ series)', samples);
    if (samples.labelled !== samples.unlabelled) throw Error('unequal sample counts; rerun');
    const labelsSeen = await prom('/api/v1/query', {
      query: 'count by (job, app, host) ({__name__=~"fm_web_.*"})',
      time: at,
    });
    log(
      'label sets:',
      labelsSeen.data.result
        .map((r) => `${r.metric.job}:${r.metric.app ?? '-'}/${r.metric.host ?? '-'}`)
        .join(' '),
    );

    const dash = JSON.parse(await readFile(here('dashboards/facemorph-changeover.json'), 'utf8'));
    const exprs = [];
    const walk = (ps) => {
      for (const p of ps) {
        for (const t of p.targets || [])
          if (t.expr) exprs.push({ id: p.id, title: p.title, expr: t.expr });
        walk(p.panels || []);
      }
    };
    walk(dash.panels);
    let failures = 0;
    for (const { id, title, expr } of exprs) {
      const res = {};
      for (const j of ['labelled', 'unlabelled']) {
        const r = await prom('/api/v1/query', { query: withJob(expr, j), time: at });
        if (r.status !== 'success') throw Error(`${id} ${r.error}`);
        res[j] = new Map(r.data.result.map((x) => [key(x.metric), Number(x.value[1])]));
      }
      const keys = new Set([...res.labelled.keys(), ...res.unlabelled.keys()]);
      let worst = 0;
      let same = res.labelled.size === res.unlabelled.size;
      for (const k of keys) {
        const a = res.labelled.get(k),
          b = res.unlabelled.get(k);
        if (a === undefined || b === undefined) {
          same = false;
          continue;
        }
        const d =
          a === b || (Number.isNaN(a) && Number.isNaN(b))
            ? 0
            : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
        worst = Math.max(worst, d);
      }
      const pass = same && worst <= 1e-9;
      if (!pass) failures++;
      const sample = [...res.labelled.values()].slice(0, 3).map((v) => +v.toPrecision(6));
      const fm = /fm_web_/.test(expr);
      console.log(
        `${pass ? 'PASS' : 'FAIL'} panel ${id} ${fm ? 'new' : 'old'} series=${res.labelled.size}/${res.unlabelled.size} maxRelDiff=${worst} e.g.=${JSON.stringify(sample)} | ${title}`,
      );
      if (fm && res.labelled.size === 0) {
        console.log('  FAIL: empty result for an fm_web query');
        failures++;
      }
    }
    ok = failures === 0;
    console.log(ok ? `ALL ${exprs.length} panel queries equal` : `${failures} failures`);
  } finally {
    try {
      execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    } catch {}
    for (const { mf } of targets) await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
  process.exit(ok ? 0 : 1);
}
await main();
