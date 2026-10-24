// Network records and assertion primitives (fm-o8xn), shared by the Playwright helper (playwright.ts) and mirrored
// exactly by the CDP helper (intercept.py); both are checked against the same vectors (vectors.json).
//
// A record holds steps, requests and console errors, each with a `seq` in arrival order. A request carries the index
// of the step that was current when it started (-1 before the first step), its host class, its URL as origin + path
// template, initiator (page, worker, service-worker), status, failure, bytes and from_cache. A helper that cannot
// observe a field lists it in `unobservable`; a claim that depends on it reports 'untested'.
// A window {fromStep, toStep} covers the requests that started from the first step to the second, inclusive; a
// window naming a step that was never recorded has no data, and a claim on it fails, never passing by absence.
// Each primitive returns a verdict and logs one JSON line.

export type HostClass = 'app' | 'model-host' | 'names-host' | 'collector' | 'third-party' | 'local';
export type Initiator = 'page' | 'worker' | 'service-worker' | 'unknown';

export interface HostRule {
  readonly host: string;
  readonly pathPrefix?: string;
  readonly class: HostClass;
}
export interface HostMap {
  readonly version: number;
  readonly rules: readonly HostRule[];
}
export interface Step {
  readonly name: string;
  readonly seq: number;
}
export interface Request {
  readonly seq: number;
  readonly step: number;
  readonly url: string;
  readonly hostClass: HostClass;
  readonly method: string;
  readonly initiator: Initiator;
  status: number | null;
  failed: boolean;
  errorText: string | null;
  bytes: number | null;
  fromCache: boolean | null;
}
export interface ConsoleEntry {
  readonly seq: number;
  readonly step: number;
  readonly level: string;
  readonly text: string;
  readonly source: Initiator;
}
export interface NetworkRecord {
  readonly schema: 'facemorph.network-record/1';
  readonly helper: string;
  readonly hostMap: number;
  readonly steps: Step[];
  readonly requests: Request[];
  readonly console: ConsoleEntry[];
  readonly unobservable: string[];
}
export interface Window {
  readonly fromStep?: string;
  readonly toStep?: string;
}
export type Selector =
  | { readonly step: string }
  | { readonly hostClass: HostClass; readonly path?: string };
export interface Verdict {
  readonly primitive: string;
  readonly hostClass: HostClass | null;
  readonly window: { fromStep: string | null; toStep: string | null };
  readonly count: number;
  readonly bytes: number | null;
  readonly verdict: 'pass' | 'fail' | 'untested';
  readonly reason: string;
  readonly requests?: Request[];
}
export type Log = (line: Record<string, unknown>) => void;
export const LOG: Log = (line) => console.log(JSON.stringify(line));

export function newRecord(
  helper: string,
  hostMap: HostMap,
  unobservable: string[] = [],
): NetworkRecord {
  return {
    schema: 'facemorph.network-record/1',
    helper,
    hostMap: hostMap.version,
    steps: [],
    requests: [],
    console: [],
    unobservable,
  };
}

const nextSeq = (rec: NetworkRecord) => rec.steps.length + rec.requests.length + rec.console.length;
const current = (rec: NetworkRecord) => rec.steps.length - 1;

/** Marks the start of a named step; later requests belong to it. */
export function step(rec: NetworkRecord, name: string): void {
  rec.steps.push({ name, seq: nextSeq(rec) });
}

/** Host class of a URL under a host map: first matching rule; data:/blob: are local; otherwise third-party. Pure. */
export function classify(url: string, map: HostMap): HostClass {
  if (url.startsWith('data:') || url.startsWith('blob:')) return 'local';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'third-party';
  }
  for (const r of map.rules)
    if (
      (r.host === u.host || r.host === u.hostname) &&
      (!r.pathPrefix || u.pathname.startsWith(r.pathPrefix))
    )
      return r.class;
  return 'third-party';
}

/** origin + path template: no query or fragment; numeric segments become ':n', hex of 16+ characters ':hex'. Pure. */
export function template(url: string): string {
  if (url.startsWith('data:')) return 'data:';
  if (url.startsWith('blob:')) return 'blob:';
  const u = new URL(url);
  const path = u.pathname
    .split('/')
    .map((s) => (/^\d+$/.test(s) ? ':n' : /^[0-9a-f]{16,}$/i.test(s) ? ':hex' : s))
    .join('/');
  return `${u.origin}${path}`;
}

/** Adds a request at the current step; the helper fills status, bytes and failure as they arrive. */
export function addRequest(
  rec: NetworkRecord,
  map: HostMap,
  r: { url: string; method: string; initiator: Initiator },
): Request {
  const req: Request = {
    seq: nextSeq(rec),
    step: current(rec),
    url: template(r.url),
    hostClass: classify(r.url, map),
    method: r.method,
    initiator: r.initiator,
    status: null,
    failed: false,
    errorText: null,
    bytes: null,
    fromCache: null,
  };
  rec.requests.push(req);
  return req;
}

export function addConsole(
  rec: NetworkRecord,
  level: string,
  text: string,
  source: Initiator,
): void {
  rec.console.push({ seq: nextSeq(rec), step: current(rec), level, text, source });
}

function bounds(rec: NetworkRecord, w: Window): [number, number] | string {
  const index = (name: string) => rec.steps.findIndex((s) => s.name === name);
  const from = w.fromStep === undefined ? -1 : index(w.fromStep);
  const to = w.toStep === undefined ? rec.steps.length - 1 : index(w.toStep);
  if (w.fromStep !== undefined && from < 0)
    return `no data for the window: step ${w.fromStep} was not recorded`;
  if (w.toStep !== undefined && to < 0)
    return `no data for the window: step ${w.toStep} was not recorded`;
  return [from, to];
}

const sumBytes = (rs: readonly Request[]) =>
  rs.some((r) => r.bytes === null) ? null : rs.reduce((s, r) => s + (r.bytes ?? 0), 0);

function verdict(log: Log, v: Omit<Verdict, 'window'> & { window: Window }): Verdict {
  const out: Verdict = {
    ...v,
    window: { fromStep: v.window.fromStep ?? null, toStep: v.window.toStep ?? null },
  };
  const { requests: _omit, ...line } = out;
  log({ event: 'network-assertion', ...line });
  return out;
}

/** The requests in a window, optionally of one host class and cache state. */
export function requestsIn(
  rec: NetworkRecord,
  q: Window & { hostClass?: HostClass; fromCache?: boolean },
  log: Log = LOG,
): Verdict {
  const base = { primitive: 'requestsIn', hostClass: q.hostClass ?? null, window: q };
  const b = bounds(rec, q);
  if (typeof b === 'string')
    return verdict(log, {
      ...base,
      count: 0,
      bytes: null,
      verdict: 'fail',
      reason: b,
      requests: [],
    });
  if (q.fromCache !== undefined && rec.unobservable.includes('fromCache'))
    return verdict(log, {
      ...base,
      count: 0,
      bytes: null,
      verdict: 'untested',
      reason: `fromCache is unobservable with ${rec.helper}`,
      requests: [],
    });
  const rs = rec.requests.filter(
    (r) =>
      r.step >= b[0] &&
      r.step <= b[1] &&
      (q.hostClass === undefined || r.hostClass === q.hostClass) &&
      (q.fromCache === undefined || r.fromCache === q.fromCache),
  );
  return verdict(log, {
    ...base,
    count: rs.length,
    bytes: sumBytes(rs),
    verdict: 'pass',
    reason: `${rs.length} request(s)`,
    requests: rs,
  });
}

/** No request of the host class in the window. */
export function assertNoRequests(
  rec: NetworkRecord,
  hostClass: HostClass,
  w: Window = {},
  log: Log = LOG,
): Verdict {
  const base = { primitive: 'assertNoRequests', hostClass, window: w };
  const b = bounds(rec, w);
  if (typeof b === 'string')
    return verdict(log, { ...base, count: 0, bytes: null, verdict: 'fail', reason: b });
  const rs = rec.requests.filter(
    (r) => r.step >= b[0] && r.step <= b[1] && r.hostClass === hostClass,
  );
  return verdict(log, {
    ...base,
    count: rs.length,
    bytes: sumBytes(rs),
    verdict: rs.length ? 'fail' : 'pass',
    reason: rs.length
      ? `${rs.length} ${hostClass} request(s): ${rs.map((r) => r.url).join(', ')}`
      : `no ${hostClass} request`,
  });
}

function seqs(rec: NetworkRecord, s: Selector): number[] {
  if ('step' in s) return rec.steps.filter((x) => x.name === s.step).map((x) => x.seq);
  return rec.requests
    .filter(
      (r) =>
        r.hostClass === s.hostClass &&
        (s.path === undefined || new URL(r.url).pathname.startsWith(s.path)),
    )
    .map((r) => r.seq);
}
const describe = (s: Selector) =>
  'step' in s ? `step ${s.step}` : `${s.hostClass}${s.path ? ` ${s.path}` : ''} request`;

/** Every `before` event precedes the first `after` event; both must have been recorded. */
export function assertOrder(
  rec: NetworkRecord,
  before: Selector,
  after: Selector,
  log: Log = LOG,
): Verdict {
  const a = seqs(rec, before);
  const z = seqs(rec, after);
  const base = {
    primitive: 'assertOrder',
    hostClass: 'hostClass' in after ? after.hostClass : null,
    window: {},
    count: z.length,
    bytes: null,
  };
  if (!a.length)
    return verdict(log, {
      ...base,
      verdict: 'fail',
      reason: `no data: ${describe(before)} was not recorded`,
    });
  if (!z.length)
    return verdict(log, {
      ...base,
      verdict: 'fail',
      reason: `no data: ${describe(after)} was not recorded`,
    });
  const ok = Math.max(...a) < Math.min(...z);
  return verdict(log, {
    ...base,
    verdict: ok ? 'pass' : 'fail',
    reason: ok
      ? `${describe(before)} before ${describe(after)}`
      : `${describe(after)} came before ${describe(before)}`,
  });
}

/** Bytes of a host class in a window; 'untested' when any of those requests' bytes are unobservable. */
export function bytesBy(
  rec: NetworkRecord,
  hostClass: HostClass,
  w: Window = {},
  log: Log = LOG,
): Verdict {
  const base = { primitive: 'bytesBy', hostClass, window: w };
  const b = bounds(rec, w);
  if (typeof b === 'string')
    return verdict(log, { ...base, count: 0, bytes: null, verdict: 'fail', reason: b });
  const rs = rec.requests.filter(
    (r) => r.step >= b[0] && r.step <= b[1] && r.hostClass === hostClass,
  );
  const bytes = rec.unobservable.includes('bytes') ? null : sumBytes(rs);
  return verdict(log, {
    ...base,
    count: rs.length,
    bytes,
    verdict: bytes === null ? 'untested' : 'pass',
    reason:
      bytes === null
        ? `bytes unobservable for ${rs.filter((r) => r.bytes === null).length} request(s)`
        : `${bytes} bytes`,
  });
}
