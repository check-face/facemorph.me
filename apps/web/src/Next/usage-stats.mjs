// Anonymous changeover statistics (facemorph.me PLAN.md "Changeover statistics in Grafana").
//
// A second, first-party sink beside Google Analytics: the same product events, reduced to a closed
// vocabulary and bounded numbers, batched in memory and sent as one small same-origin beacon to
// /stats/v1, where a Worker adds them to aggregate counters for the before/after Grafana view.
// No cookie, identifier, address or free text is sent or stored, so it needs no banner. It follows
// the same opt-outs as analytics (production host only, off for GPC, Do Not Track, Save-Data and
// automation) plus localStorage 'facemorph-usage-stats' = 'off'. It never affects the product.
import { allowed as analyticsAllowed, deviceProperties } from './analytics.mjs';

export const OPT_OUT_KEY = 'facemorph-usage-stats';
export const ENDPOINT = '/stats/v1';
const FLUSH_AT = 150, FLUSH_EVERY_MS = 60000, MAX_BYTES = 3800;
const ACTIONS = { faces: 'face', face: 'face', morph: 'morph', photo: 'photo', names: 'names', blend: 'blend' };
const ROUTES = { cpu: 'cpu', webgpu: 'webgpu', auto: 'auto' };
const OUTCOMES = ['completed', 'cancelled', 'failed'];

export function allowed(env = globalThis) {
  if (!analyticsAllowed(env)) return false;
  try { return env.localStorage?.getItem(OPT_OUT_KEY) !== 'off'; } catch { return true; }
}

export function platformClass(nav = globalThis.navigator) {
  const p = deviceProperties(nav).platform;
  return p === 'ios' || p === 'android' ? p : p === 'other' ? 'unknown' : 'desktop';
}

const ms = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(Math.min(value, 3.6e6)) : undefined);

/** Maps one product event to a stats event, or null. Pure; exposed for tests. */
export function toStatsEvent(kind, data, platform) {
  if (kind === 'visit') return { t: 'visit', platform, visit: data.visit === 'returning' ? 'returning' : 'first' };
  if (kind === 'job') {
    const action = ACTIONS[data.action], outcome = data.outcome === 'interrupted' ? 'cancelled' : data.outcome;
    if (!action || !OUTCOMES.includes(outcome)) return null;
    return { t: 'job', action, route: ROUTES[data.route] || 'unknown', outcome, platform, ms: outcome === 'completed' ? ms(data.ms) : undefined };
  }
  if (kind === 'ttfr') return ms(data.ms) === undefined ? null : { t: 'ttfr', cache: data.cache === 'warm' ? 'warm' : 'cold', platform, ms: ms(data.ms) };
  if (kind === 'frames') return Number.isFinite(data.n) && data.n > 0 ? { t: 'frames', platform, n: Math.round(data.n) } : null;
  if (kind === 'export') return ['image', 'video'].includes(data.kind) && ['save', 'share'].includes(data.method) ? { t: 'export', kind: data.kind, method: data.method } : null;
  if (kind === 'model_mb') return Number.isFinite(data.mb) && data.mb > 0 ? { t: 'model_mb', cache: 'cold', platform, mb: Math.round(data.mb * 10) / 10 } : null;
  return null;
}

/** A batching sender. `send(body)` defaults to navigator.sendBeacon; injectable for tests. */
export function createSink({ env = globalThis, send, now = () => Date.now() } = {}) {
  let queue = [], lastFlush = now(), timer = null, platform;
  const deliver = send || ((body) => env.navigator?.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' })));
  function flush() {
    if (!queue.length) return;
    let events = queue; queue = []; lastFlush = now();
    while (events.length) {
      let n = events.length, body;
      do { body = JSON.stringify({ v: 1, events: events.slice(0, n) }); if (body.length <= MAX_BYTES) break; n = Math.floor(n / 2); } while (n > 1);
      try { deliver(body); } catch { /* never affects the product */ }
      events = events.slice(n);
    }
  }
  function record(kind, data = {}) {
    try {
      if (!allowed(env)) return;
      platform ??= platformClass(env.navigator);
      const event = toStatsEvent(kind, data, platform);
      if (!event) return;
      queue.push(event);
      if (queue.length >= FLUSH_AT || now() - lastFlush >= FLUSH_EVERY_MS) flush();
      else if (!timer && typeof env.setTimeout === 'function') timer = env.setTimeout(() => { timer = null; flush(); }, FLUSH_EVERY_MS);
    } catch { /* never affects the product */ }
  }
  try {
    env.addEventListener?.('pagehide', flush);
    env.document?.addEventListener?.('visibilitychange', () => { if (env.document.visibilityState === 'hidden') flush(); });
  } catch { /* no page lifecycle here */ }
  return { record, flush, pending: () => queue.length };
}

let shared;
/** The page-wide sink, created on first use. */
export function record(kind, data) { (shared ??= createSink()).record(kind, data); }
