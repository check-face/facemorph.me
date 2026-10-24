// Request-interception helper for Playwright (fm-o8xn). Duck-typed: it imports no Playwright package and attaches to
// anything with Playwright's page or browser-context events. Records page, dedicated-worker and service-worker
// requests (initiator, status, failure, response body bytes) and console errors into a network record
// (record.ts). Playwright does not report whether a response came from the HTTP cache, so `fromCache` is declared
// unobservable and claims on it report 'untested'.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  addConsole,
  addRequest,
  LOG,
  newRecord,
  type HostMap,
  type Initiator,
  type Log,
  type NetworkRecord,
  type Request,
  type Verdict,
} from './record.ts';

export const DEFAULT_HOST_MAP = JSON.parse(
  readFileSync(new URL('./host-classes.json', import.meta.url), 'utf8'),
) as HostMap;

interface PwResponse {
  status(): number;
  headers(): Record<string, string>;
  request(): PwRequest;
}
interface PwRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  serviceWorker?(): unknown;
  failure(): { errorText: string } | null;
  sizes(): Promise<{ responseBodySize: number }>;
}
interface PwConsole {
  type(): string;
  text(): string;
}
interface PwWorker {
  url(): string;
  on(event: 'console', fn: (m: PwConsole) => void): unknown;
}
interface PwPage {
  on(event: 'worker', fn: (w: PwWorker) => void): unknown;
}
interface PwTarget {
  on(event: 'request' | 'requestfinished' | 'requestfailed', fn: (r: PwRequest) => void): unknown;
  on(event: 'response', fn: (r: PwResponse) => void): unknown;
  on(event: 'console', fn: (m: PwConsole) => void): unknown;
  on(event: 'page', fn: (p: PwPage) => void): unknown;
  on(event: 'worker', fn: (w: PwWorker) => void): unknown;
  pages?(): PwPage[];
}

export interface Attached {
  readonly rec: NetworkRecord;
  /** Waits until every recorded request has failed, or has its status and its bytes (bounded: a request
   * Playwright never reports finished keeps bytes null after the timeout, and a claim on it reads 'untested'). */
  settled(timeoutMs?: number): Promise<void>;
}

/** Attaches to a page or a browser context (with serviceWorkers allowed for service-worker requests). */
export function attachPlaywright(target: PwTarget, map: HostMap = DEFAULT_HOST_MAP): Attached {
  const rec = newRecord('playwright', map, ['fromCache']);
  const open = new Map<PwRequest, Request>();
  const workers = new Set<string>();
  const pending = new Set<Promise<void>>();
  const track = (p: Promise<void>) => {
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };
  const consoleError = (source: Initiator) => (m: PwConsole) => {
    if (m.type() === 'error') addConsole(rec, 'error', m.text(), source);
  };
  // Dedicated workers: Playwright gives their requests the page's frame, so they are told apart by the referrer,
  // which is the worker's script URL for a same-origin request (a cross-origin one carries only the origin and
  // is attributed to the page). Their console is reported on the worker object.
  const watch = (p: PwPage) =>
    p.on('worker', (w) => {
      workers.add(w.url());
      w.on('console', consoleError('worker'));
    });
  if (target.pages) {
    target.pages().forEach(watch);
    target.on('page', watch);
  } else watch(target);
  const initiator = (r: PwRequest): Initiator =>
    r.serviceWorker?.()
      ? 'service-worker'
      : workers.has(r.headers()['referer'] ?? '')
        ? 'worker'
        : 'page';

  target.on('request', (r) => {
    open.set(
      r,
      addRequest(rec, map, { url: r.url(), method: r.method(), initiator: initiator(r) }),
    );
  });
  target.on('response', (res) => {
    const req = open.get(res.request());
    if (!req) return;
    req.status = res.status();
    const length = Number(res.headers()['content-length']);
    if (req.bytes === null && Number.isFinite(length) && length >= 0) req.bytes = length;
  });
  // Bytes are the response body length: its Content-Length, or else the body size the browser reports when the
  // request finishes (Playwright reports 0 or a negative size for some, and some never finish in its view; a size
  // below zero is unknown).
  target.on('requestfinished', (r) => {
    const req = open.get(r);
    if (!req || req.bytes !== null) return;
    track(
      r.sizes().then(
        (s) => {
          if (req.bytes === null && s.responseBodySize >= 0) req.bytes = s.responseBodySize;
        },
        () => {},
      ),
    );
  });
  target.on('requestfailed', (r) => {
    const req = open.get(r);
    if (!req) return;
    req.failed = true;
    req.errorText = r.failure()?.errorText ?? 'failed';
    req.bytes = 0;
  });
  target.on('console', consoleError('page'));
  return {
    rec,
    async settled(timeoutMs = 10_000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        await Promise.all(pending);
        // Bytes can arrive after the status (no Content-Length: from sizes() when the request finishes).
        if ([...open.values()].every((q) => q.failed || (q.status !== null && q.bytes !== null)))
          return;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

/** A log that appends each assertion line to a JSONL file (the per-assertion log CI uploads) and prints it. */
export function fileLog(path: string): Log {
  mkdirSync(dirname(path), { recursive: true });
  return (line) => {
    appendFileSync(path, JSON.stringify(line) + '\n');
    LOG(line);
  };
}

/** Keeps a screenshot of the page in dir when any verdict failed; returns the file kept, if any. */
export async function keepOnFailure(
  verdicts: readonly Verdict[],
  page: { screenshot(o: { path: string; fullPage: boolean }): Promise<unknown> },
  dir: string,
): Promise<string | null> {
  if (!verdicts.some((v) => v.verdict === 'fail')) return null;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'failure.png');
  await page.screenshot({ path, fullPage: true });
  return path;
}
