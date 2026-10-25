// Request-interception helper, TypeScript side (fm-o8xn). The primitives are checked on the shared vectors (the
// Python helper's tests use the same file); the Playwright helper on real Chromium runs of the fixture page:
// worker and service-worker attribution, failed requests with status, the console error, the model only after
// Approve, the early variant failing, a window without data failing, fromCache 'untested', and a screenshot kept
// on failure. Each run writes its per-assertion JSONL log (INTERCEPT_LOG_DIR, default a temporary directory).
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pageUrl, startFixture } from './fixture.ts';
import { attachPlaywright, fileLog, keepOnFailure } from './playwright.ts';
import {
  assertNoRequests,
  assertOrder,
  bindOrigins,
  bytesBy,
  classify,
  requestsIn,
  step,
  template,
  type HostClass,
  type HostMap,
  type NetworkRecord,
  type Selector,
  type Verdict,
  type Window,
} from './record.ts';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
interface Case {
  record: string;
  call: 'requestsIn' | 'assertNoRequests' | 'assertOrder' | 'bytesBy';
  args: unknown[];
  verdict: string;
  count: number;
  bytes: number | null;
}
const V = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8')) as {
  records: Record<string, NetworkRecord>;
  cases: Case[];
  classify: [string, HostClass][];
  template: [string, string][];
};
const MAP = JSON.parse(readFileSync(join(HERE, 'host-classes.json'), 'utf8')) as HostMap;
const quiet = () => {};

export function run(c: Case, rec: NetworkRecord): Verdict {
  const a = c.args;
  if (c.call === 'requestsIn')
    return requestsIn(rec, a[0] as Window & { hostClass?: HostClass }, quiet);
  if (c.call === 'assertNoRequests')
    return assertNoRequests(rec, a[0] as HostClass, a[1] as Window, quiet);
  if (c.call === 'assertOrder') return assertOrder(rec, a[0] as Selector, a[1] as Selector, quiet);
  return bytesBy(rec, a[0] as HostClass, a[1] as Window, quiet);
}

test('shared vectors: every primitive gives the declared verdict, count and bytes', () => {
  for (const c of V.cases) {
    const r = run(c, structuredClone(V.records[c.record]!));
    assert.deepEqual(
      { verdict: r.verdict, count: r.count, bytes: r.bytes },
      { verdict: c.verdict, count: c.count, bytes: c.bytes },
      JSON.stringify(c),
    );
  }
  for (const [url, cls] of V.classify) assert.equal(classify(url, MAP), cls, url);
  for (const [url, t] of V.template) assert.equal(template(url), t, url);
});

test('a run binds its own origins ahead of the default map', () => {
  const run = bindOrigins(MAP, {
    app: ['http://127.0.0.1:8443'],
    'model-host': ['https://models.preview.example'],
  });
  assert.equal(classify('http://127.0.0.1:8443/runtime/manifest.json', run), 'app');
  assert.equal(classify('https://models.preview.example/a.bin', run), 'model-host');
  assert.equal(classify('https://models.facemorph.me/a.bin', run), 'model-host');
  assert.equal(classify('http://127.0.0.1:9000/x', run), 'third-party');
});

test('each primitive logs one JSON line with primitive, host class, window, count, bytes and verdict', () => {
  const lines: Record<string, unknown>[] = [];
  assertNoRequests(V.records['early']!, 'model-host', { toStep: 'load' }, (l) => lines.push(l));
  assert.deepEqual(lines, [
    {
      event: 'network-assertion',
      primitive: 'assertNoRequests',
      hostClass: 'model-host',
      window: { fromStep: null, toStep: 'load' },
      count: 1,
      bytes: 4096,
      verdict: 'fail',
      reason: '1 model-host request(s): https://models.facemorph.me/model.bin',
    },
  ]);
});

const { chromium } = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as {
  chromium: {
    executablePath(): string;
    launchServer(o?: object): Promise<BrowserServer>;
    connect(
      endpoint: string,
      o?: object,
    ): Promise<{
      newContext(o?: object): Promise<Context>;
      close(): Promise<void>;
    }>;
  };
};
interface BrowserServer {
  wsEndpoint(): string;
  process(): ChildProcess;
  close(): Promise<void>;
  kill(): Promise<void>;
}

// Settle the explicitly owned context (including service workers and pending
// artifacts) before asking the browser server to exit. Both steps share one bound;
// a stuck browser still fails, and only this fixture's process group is killed.
async function closeBrowser(server: BrowserServer, context?: Context) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await context?.close();
        await server.close();
      })(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          reject(new Error('Chromium shutdown exceeded 5 seconds; owned process killed'));
        }, 5_000);
      }),
    ]);
  } catch (error) {
    // Playwright kills the owned process group, not just Chromium's parent.
    // Do not let cleanup mask the original failure or extend the shutdown bound.
    void server.kill().catch(() => server.process().kill('SIGKILL'));
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

interface Page {
  goto(u: string): Promise<unknown>;
  click(s: string): Promise<void>;
  waitForFunction(f: string): Promise<unknown>;
  screenshot(o: { path: string; fullPage: boolean }): Promise<unknown>;
}
interface Context {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  on(event: 'close', listener: () => void): void;
}

async function journey(early: boolean, logDir: string) {
  const f = await startFixture();
  let server: BrowserServer | undefined;
  let context: Context | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  try {
    server = await chromium.launchServer({
      executablePath: process.env['CHROMIUM_PATH'],
      timeout: 30_000,
    });
    lifetime = setTimeout(() => {
      void server!.kill().catch(() => server!.process().kill('SIGKILL'));
    }, 90_000);
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: 30_000 });
    context = await browser.newContext({ serviceWorkers: 'allow' });
    const att = attachPlaywright(context as never, f.hostMap);
    const page = await context.newPage();
    step(att.rec, 'load');
    await page.goto(pageUrl(f, early));
    await page.waitForFunction("document.title === 'ready'");
    step(att.rec, 'approve');
    await page.click('#approve');
    await page.waitForFunction("document.title === 'approved'");
    await att.settled();
    const log = fileLog(join(logDir, `playwright-${early ? 'early' : 'approved'}.jsonl`));
    const verdicts = [
      assertNoRequests(att.rec, 'model-host', { toStep: 'load' }, log),
      assertOrder(att.rec, { step: 'approve' }, { hostClass: 'model-host' }, log),
      bytesBy(att.rec, 'model-host', { fromStep: 'approve' }, log),
      requestsIn(att.rec, { hostClass: 'app', fromCache: true }, log),
      assertNoRequests(att.rec, 'model-host', { fromStep: 'consent' }, log),
    ];
    const shot = await keepOnFailure(verdicts, page, join(logDir, early ? 'early' : 'approved'));
    return { rec: att.rec, verdicts, shot };
  } finally {
    try {
      if (server) await closeBrowser(server, context);
    } finally {
      clearTimeout(lifetime);
      await f.stop();
    }
  }
}

const logDir = process.env['INTERCEPT_LOG_DIR'] ?? mkdtempSync(join(tmpdir(), 'intercept-log-'));
// Missing browser installations are explicitly untested; launch/shutdown failures
// of an installed browser fail the test instead of silently skipping CI coverage.
const NO_BROWSER = existsSync(process.env['CHROMIUM_PATH'] ?? chromium.executablePath())
  ? false
  : 'untested: Chromium executable is not installed';

test(
  'Playwright helper on the fixture page: attribution, failures, console and the approved model',
  { skip: NO_BROWSER },
  async () => {
    const { rec, verdicts } = await journey(false, logDir);
    const at = (path: string) => rec.requests.filter((r) => new URL(r.url).pathname === path);
    assert.equal(at('/worker-data.json')[0]?.initiator, 'worker');
    assert.equal(at('/sw-asset.json')[0]?.initiator, 'service-worker');
    assert.equal(at('/app.json')[0]?.initiator, 'page');
    assert.equal(at('/cached.json').length, 2);
    // No Content-Length: settled() waits until the browser has counted its bytes (the transfer size, chunk
    // framing included, so at least the 26-byte body).
    assert.ok((at('/streamed.json')[0]?.bytes ?? 0) >= 26, JSON.stringify(at('/streamed.json')));
    assert.deepEqual(
      [at('/missing.json')[0]?.status, at('/missing.json')[0]?.failed],
      [404, false],
    );
    const unreachable = at('/unreachable.json')[0];
    assert.equal(unreachable?.failed, true);
    assert.match(unreachable?.errorText ?? '', /ERR_CONNECTION_REFUSED/);
    assert.ok(rec.console.some((c) => c.text === 'fixture console error' && c.source === 'page'));
    const model = rec.requests.filter((r) => r.hostClass === 'model-host');
    assert.deepEqual(
      model.map((r) => [rec.steps[r.step]?.name, r.status, r.bytes]),
      [['approve', 200, 4096]],
    );
    assert.deepEqual(
      verdicts.map((v) => v.verdict),
      ['pass', 'pass', 'pass', 'untested', 'fail'], // fromCache is unobservable; 'consent' has no data
    );
    assert.ok(existsSync(join(logDir, 'playwright-approved.jsonl')));
  },
);

test(
  'Playwright helper: the model requested before approval fails, and the failure keeps a screenshot',
  { skip: NO_BROWSER },
  async () => {
    const { verdicts, shot } = await journey(true, logDir);
    assert.equal(verdicts[0]?.verdict, 'fail');
    assert.equal(verdicts[0]?.count, 1);
    assert.equal(verdicts[1]?.verdict, 'fail');
    assert.ok(shot && existsSync(shot));
  },
);

test(
  'an unresponsive owned Chromium fails shutdown and its process group is killed',
  { skip: NO_BROWSER },
  async () => {
    const server = await chromium.launchServer({
      executablePath: process.env['CHROMIUM_PATH'],
      timeout: 30_000,
    });
    try {
      const browser = await chromium.connect(server.wsEndpoint(), { timeout: 30_000 });
      const context = await browser.newContext();
      await context.newPage();
      const child = server.process();
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      assert.ok(child.pid);
      process.kill(child.pid, 'SIGSTOP');
      await assert.rejects(closeBrowser(server, context), /shutdown exceeded 5 seconds/);
      await exited;
      assert.equal(child.signalCode, 'SIGKILL');
    } finally {
      await server.kill();
    }
  },
);

test(
  'owned context closes before the browser server exits normally',
  { skip: NO_BROWSER },
  async () => {
    const server = await chromium.launchServer({
      executablePath: process.env['CHROMIUM_PATH'],
      timeout: 30_000,
    });
    try {
      const browser = await chromium.connect(server.wsEndpoint(), { timeout: 30_000 });
      const context = await browser.newContext();
      await context.newPage();
      let contextClosed = false;
      context.on('close', () => {
        contextClosed = true;
      });
      const child = server.process();
      child.once('exit', () => assert.equal(contextClosed, true));
      await closeBrowser(server, context);
      assert.equal(contextClosed, true);
      assert.equal(child.exitCode, 0);
      assert.equal(child.signalCode, null);
    } finally {
      await server.kill();
    }
  },
);
