// FaceMorph changeover statistics (PLAN.md "Changeover statistics in Grafana").
//
// The page sends small batched beacons of closed-vocabulary events to POST /stats/v1 on its own
// origin. This Worker validates them and adds them to aggregate counters held by one Durable Object.
// Nothing per-event is stored: no IP address, cookie, identifier or free text ever reaches storage.
// Prometheus on triton scrapes GET /stats/metrics with a bearer token.

const ORIGINS = new Set(['https://next.facemorph.me', 'https://facemorph.me']);
const MAX_BODY = 4096;
const MAX_EVENTS = 200;
const RATE_PER_MINUTE = 20;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|playwright|puppeteer|selenium|phantom/i;

export const VOCAB = {
  platform: ['ios', 'android', 'desktop', 'unknown'],
  visit: ['first', 'returning'],
  action: ['face', 'photo', 'morph', 'names', 'blend'],
  route: ['cpu', 'webgpu', 'auto', 'unknown'],
  outcome: ['completed', 'cancelled', 'failed'],
  cache: ['cold', 'warm'],
  kind: ['image', 'video'],
  method: ['save', 'share'],
};
// Histogram buckets in seconds, chosen to span a warm WebGPU face (~0.1 s) to a phone CPU morph (minutes).
export const BUCKETS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];
const MAX_MS = 3.6e6;

const pick = (field, value) => (VOCAB[field].includes(value) ? value : null);
const num = (value, max) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null);

/** Turns one beacon into counter increments, or null if the beacon is malformed. Exposed for tests. */
export function increments(beacon) {
  if (!beacon || beacon.v !== 1 || !Array.isArray(beacon.events) || beacon.events.length > MAX_EVENTS) return null;
  const out = new Map();
  const add = (key, by = 1) => out.set(key, (out.get(key) || 0) + by);
  const observe = (name, labels, seconds) => {
    for (const le of BUCKETS) if (seconds <= le) add(`${name}_bucket{${labels},le="${le}"}`);
    add(`${name}_bucket{${labels},le="+Inf"}`);
    add(`${name}_sum{${labels}}`, seconds);
    add(`${name}_count{${labels}}`);
  };
  for (const e of beacon.events) {
    if (!e || typeof e !== 'object') continue;
    const platform = pick('platform', e.platform) || 'unknown';
    if (e.t === 'visit') {
      const visit = pick('visit', e.visit);
      if (visit) add(`fm_web_visits_total{platform="${platform}",visit="${visit}"}`);
    } else if (e.t === 'job') {
      const action = pick('action', e.action), route = pick('route', e.route) || 'unknown', outcome = pick('outcome', e.outcome);
      if (!action || !outcome) continue;
      const labels = `action="${action}",route="${route}",platform="${platform}"`;
      add(`fm_web_jobs_total{${labels},outcome="${outcome}"}`);
      const ms = num(e.ms, MAX_MS);
      if (outcome === 'completed' && ms !== null) observe('fm_web_job_duration_seconds', labels, ms / 1000);
    } else if (e.t === 'ttfr') {
      const cache = pick('cache', e.cache), ms = num(e.ms, MAX_MS);
      if (cache && ms !== null) observe('fm_web_time_to_first_result_seconds', `cache="${cache}",platform="${platform}"`, ms / 1000);
    } else if (e.t === 'frames') {
      const n = num(e.n, 100000);
      if (n !== null) add(`fm_web_morph_frames_total{platform="${platform}"}`, Math.round(n));
    } else if (e.t === 'export') {
      const kind = pick('kind', e.kind), method = pick('method', e.method);
      if (kind && method) add(`fm_web_exports_total{kind="${kind}",method="${method}"}`);
    } else if (e.t === 'model_mb') {
      const cache = pick('cache', e.cache), mb = num(e.mb, 4096);
      if (cache && mb !== null) add(`fm_web_model_megabytes_total{cache="${cache}",platform="${platform}"}`, mb);
    }
  }
  return out;
}

/** Renders stored counters as Prometheus text exposition. Exposed for tests. */
export function exposition(rows) {
  const help = {
    fm_web_visits_total: ['counter', 'Visits to the new in-browser app, by platform class and first or returning visit.'],
    fm_web_jobs_total: ['counter', 'Jobs run in the browser, by action, route, platform class and outcome.'],
    fm_web_job_duration_seconds: ['histogram', 'Duration of completed browser jobs.'],
    fm_web_time_to_first_result_seconds: ['histogram', 'Time from page load to the first visible result.'],
    fm_web_morph_frames_total: ['counter', 'Morph frames produced in the browser.'],
    fm_web_exports_total: ['counter', 'Saved or shared files, by kind and method.'],
    fm_web_model_megabytes_total: ['counter', 'Model megabytes moved on visits, by cache state.'],
  };
  const byName = new Map();
  for (const { key, value } of rows) {
    const base = key.slice(0, key.indexOf('{')).replace(/_(bucket|sum|count)$/, '');
    if (!help[base]) continue;
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(`${key} ${value}`);
  }
  let text = '';
  for (const [name, lines] of [...byName].sort()) {
    text += `# HELP ${name} ${help[name][1]}\n# TYPE ${name} ${help[name][0]}\n${lines.sort().join('\n')}\n`;
  }
  return text;
}

const recent = new Map(); // per-isolate, in memory only: hashed client -> {minute, count}
async function rateLimited(request, now = Date.now()) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const day = Math.floor(now / 86400000);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${ip}`));
  const id = btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 12)));
  const minute = Math.floor(now / 60000);
  const slot = recent.get(id);
  if (!slot || slot.minute !== minute) { recent.set(id, { minute, count: 1 }); if (recent.size > 50000) recent.clear(); return false; }
  slot.count += 1;
  return slot.count > RATE_PER_MINUTE;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const empty = (status) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function handle(request, env) {
  const url = new URL(request.url);
  const counter = () => env.COUNTERS.get(env.COUNTERS.idFromName('global'));
  if (url.pathname === '/stats/metrics' && request.method === 'GET') {
    const auth = request.headers.get('authorization') || '';
    if (!timingSafeEqual(auth, `Bearer ${env.SCRAPE_TOKEN || ''}`)) return empty(401);
    const rows = await (await counter().fetch('https://counter/all')).json();
    return new Response(exposition(rows), { headers: { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' } });
  }
  if (url.pathname !== '/stats/v1') return empty(404);
  if (request.method !== 'POST') return empty(405);
  if (!ORIGINS.has(request.headers.get('origin') || '') || request.headers.get('sec-fetch-site') !== 'same-origin') return empty(403);
  if (BOT.test(request.headers.get('user-agent') || '')) return empty(204);
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY) return empty(413);
  if (await rateLimited(request)) return empty(429);
  const body = await request.text();
  if (body.length > MAX_BODY) return empty(413);
  let beacon;
  try { beacon = JSON.parse(body); } catch { return empty(400); }
  const inc = increments(beacon);
  if (!inc) return empty(400);
  if (inc.size) await counter().fetch('https://counter/add', { method: 'POST', body: JSON.stringify([...inc]) });
  return empty(204);
}

export default { fetch: handle };

/** One global Durable Object holding the aggregate counters in its SQLite storage. */
export class StatsCounters {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value REAL NOT NULL)');
  }
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/add') {
      const pairs = await request.json();
      for (const [key, by] of pairs) {
        if (typeof key !== 'string' || !key.startsWith('fm_web_') || key.length > 300 || typeof by !== 'number') continue;
        this.sql.exec('INSERT INTO counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value', key, by);
      }
      return new Response(null, { status: 204 });
    }
    if (pathname === '/all') return Response.json(this.sql.exec('SELECT key, value FROM counters').toArray());
    return new Response(null, { status: 404 });
  }
}
