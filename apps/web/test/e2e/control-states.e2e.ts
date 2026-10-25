// fm-fy2.2: which UI states the pinned control artifact (classic's candidate build, deploy-next/) actually has, read by
// operating it with real pointer input (mouse at 1280x900, touch at 390x844) through the verify harness, and written to
// test/contracts/control-states.json. The record states what was seen, never what was intended: a state the control
// cannot show, or that this run could not reach, is recorded under notReachable with the reason.
//
// The control asks for its production origin (https://next.facemorph.me) and refuses model assets from any other, so the
// page is opened at that origin and every request to it is answered from the digest-bound local serving
// (serveArtifact) and the acquired runtime (.cache/runtime). Nothing leaves the machine: any other host is aborted and
// counted in the record. The model is the real one, run on this machine's CPU (headless Chromium has no WebGPU adapter).
//   npm run build:next (repo root) && node --test --test-timeout=3000000 test/e2e/control-states.e2e.ts
//   (screenshots and the step log in test-results/control-states/)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { CandidateDefect } from '../../src/contracts/ui-states.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Locator, type Page } from 'playwright';
import {
  artifactDigest,
  bindOrigins,
  DEFAULT_HOST_MAP,
  serveArtifact,
} from '../verify/artifact.ts';
import { operatedClick, StepLog, typeOperated } from '../verify/operated.ts';

const repo = new URL('../../../../', import.meta.url).pathname;
const app = new URL('../../', import.meta.url);
const results = new URL('test-results/control-states/', app).pathname;
const outFile = new URL('test/contracts/control-states.json', app).pathname;
const runtimeDir = join(repo, '.cache/runtime');
const classic = join(repo, '../facemorph.me-classic');
const stills = new URL('test/fixtures/verify/stills/', app).pathname;
const ORIGIN = 'https://next.facemorph.me';
const WIDTHS = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
} as const;
type WidthName = keyof typeof WIDTHS;
const MORPH_DEADLINE_MS = Number(process.env['CONTROL_STATES_MORPH_MS'] ?? 330_000);

interface Observed {
  state: string;
  copy: string[];
  controls: string[];
  note: string;
}
interface Surface {
  observed: Observed[];
  notReachable: { state: string; why: string }[];
}
interface Defect extends CandidateDefect {
  width: WidthName;
}
const SURFACES = [
  'main-page',
  'download-modal',
  'photo-crop',
  'multi-face',
  'tiles',
  'names-picker',
  'result-actions',
  'morph-result',
  'modals',
  'file-open',
] as const;
type SurfaceName = (typeof SURFACES)[number];

const surfaces = {} as Record<SurfaceName, Record<WidthName, Surface>>;
for (const s of SURFACES)
  surfaces[s] = {
    desktop: { observed: [], notReachable: [] },
    phone: { observed: [], notReachable: [] },
  };
const defects: Defect[] = [];
const network: Record<string, Record<string, number>> = { desktop: {}, phone: {} };
const wall: Record<string, number> = {};
const pageErrors: Record<string, string[]> = {};

/** Reads what a person sees right now: the lines of each visible layer and the names of its visible controls. */
const SNAPSHOT = `(() => {
  const visible = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const name = (e) => {
    const t = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('value') || '').trim().replace(/\\s+/g, ' ');
    const label = e.tagName === 'INPUT' && e.type === 'text' ? (e.labels && e.labels[0] ? e.labels[0].innerText.trim() : '') + ' [text field: "' + e.value + '"]' : '';
    return (label || t || e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + (e.disabled || e.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : '');
  };
  const lines = (e) => e.innerText.split('\\n').map((l) => l.trim()).filter(Boolean);
  const controls = (root, scope) => [...root.querySelectorAll('button, input:not([type=file]), select, a[href], [role=button], [role=menuitem], [role=option], [role=slider]')].filter(visible).map((e) => scope + name(e));
  const copy = [], ctl = [];
  const layers = [
    ['dialog', '.MuiDialog-paper, [role=dialog]'],
    ['menu', '.MuiMenu-paper, .MuiPopover-paper, [role=menu], [role=listbox]'],
    ['toast', '.MuiSnackbarContent-root'],
    ['error', '.next-error'],
    ['status', '.next-status'],
    ['note', '.next-note, .next-morph-reason, .next-route-caption, .next-frame-count'],
  ];
  const seen = new Set();
  for (const [label, sel] of layers) for (const e of document.querySelectorAll(sel)) {
    if (!visible(e) || seen.has(e) || !e.innerText.trim()) continue;
    seen.add(e);
    const ls = lines(e);
    for (const l of ls.slice(0, 14)) copy.push(label + ': ' + l);
    if (ls.length > 14) copy.push(label + ': (+' + (ls.length - 14) + ' more lines)');
    ctl.push(...controls(e, label + ': ').slice(0, 14));
  }
  const tiles = [...document.querySelectorAll('section.next-face')];
  tiles.forEach((t, i) => {
    if (!visible(t)) return;
    const own = lines(t).filter((l) => !seen.has(t) && l);
    copy.push('tile ' + (i + 1) + ': ' + own.join(' / '));
    ctl.push(...controls(t, 'tile ' + (i + 1) + ': '));
    const img = t.querySelector('img, canvas');
    copy.push('tile ' + (i + 1) + ' picture: ' + (img ? img.tagName.toLowerCase() : 'none'));
  });
  const page = document.querySelector('main.next-product');
  if (page) {
    for (const e of page.querySelectorAll(':scope > .next-primary-action, .next-primary-action, .next-actions button, .next-overflow button, button.next-add-face, .next-slider button, .next-slider-control, .next-result button')) if (visible(e)) ctl.push('page: ' + name(e));
    for (const b of page.querySelectorAll('button')) if (visible(b) && !b.closest('section.next-face, .MuiDialog-root, .MuiSnackbarContent-root, .next-error') && !ctl.includes('page: ' + name(b))) ctl.push('page: ' + name(b));
  }
  return { copy: [...new Set(copy)], controls: [...new Set(ctl)] };
})()`;

const firstLine = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .split('\n')[0]!
    .slice(0, 300);

class Session {
  readonly steps: StepLog;
  readonly page: Page;
  readonly width: WidthName;
  readonly touch: boolean;
  n = 0;
  constructor(page: Page, width: WidthName, touch: boolean, steps: StepLog) {
    this.page = page;
    this.width = width;
    this.touch = touch;
    this.steps = steps;
  }
  get log() {
    return this.steps;
  }
  async see(surface: SurfaceName, state: string, note = '', shot = true) {
    await this.page.waitForTimeout(600);
    const s = (await this.page.evaluate(SNAPSHOT)) as { copy: string[]; controls: string[] };
    surfaces[surface][this.width].observed.push({
      state,
      copy: s.copy,
      controls: s.controls,
      note,
    });
    if (shot)
      await this.page
        .screenshot({
          path: join(
            results,
            `${this.width}-${surface}-${state.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`,
          ),
        })
        .catch(() => undefined);
    return s;
  }
  gone(surface: SurfaceName, state: string, why: string) {
    console.error(`[${this.width}] notReachable ${surface}/${state}: ${why}`);
    surfaces[surface][this.width].notReachable.push({ state, why });
  }
  defect(surface: CandidateDefect['surface'], what: string, evidence: string) {
    if (!defects.some((d) => d.surface === surface && d.width === this.width && d.what === what))
      defects.push({ surface, width: this.width, what, evidence });
  }
  /** One real press (mouse or touch) at the control's visible centre. */
  async press(name: string, control: Locator, settleMs = 3000) {
    this.n += 1;
    return operatedClick(this.page, control, {
      log: this.log,
      touch: this.touch,
      step: `control-states/${this.width}/${String(this.n).padStart(2, '0')}-${name}`,
      settleMs,
    });
  }
  /** A press that may fail because something covers the control; the failure is itself an observation. */
  async tryPress(name: string, control: Locator, settleMs = 3000) {
    try {
      await this.press(name, control, settleMs);
      return null;
    } catch (e) {
      return firstLine(e);
    }
  }
  async choose(name: string, button: Locator, file: string) {
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser', { timeout: 15000 }),
      this.press(name, button),
    ]);
    await chooser.setFiles(file);
  }
  /** Waits until some visible layer text matches, as a person waits; returns elapsed ms or null. */
  async until(re: RegExp, ms: number) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = (await this.page.evaluate(SNAPSHOT)) as { copy: string[] };
      if (s.copy.some((l) => re.test(l))) return Date.now() - t0;
      await this.page.waitForTimeout(700);
    }
    return null;
  }
  tile(i: number) {
    return this.page.locator('section.next-face').nth(i);
  }
  btn(scope: Locator | Page, name: string | RegExp) {
    return scope.getByRole('button', { name });
  }
}

/** Runs one surface step; any failure is recorded as not reachable, with why, and the journey carries on. */
async function attempt(s: Session, surface: SurfaceName, state: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    s.gone(surface, state, firstLine(e));
    await s.page.keyboard.press('Escape');
    await s.page.keyboard.press('Escape');
    await s.page
      .screenshot({
        path: join(
          results,
          `${s.width}-FAILED-${state.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`,
        ),
      })
      .catch(() => undefined);
  }
}

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'control-states-'));
  const seed = join(dir, 'seed-0.png');
  writeFileSync(
    seed,
    execFileSync('git', ['-C', classic, 'show', 'a42829b:photo-runtime/fixtures/seed-0.png'], {
      maxBuffer: 1 << 26,
    }),
  );
  const out = { seed, noFace: '', multi: '' };
  for (const [key, file] of [
    ['noFace', 'no-face.png'],
    ['multi', 'multiple-faces.png'],
  ] as const) {
    out[key] = join(dir, file);
    writeFileSync(
      out[key],
      execFileSync('git', ['-C', classic, 'show', `a42829b:photo-runtime/fixtures/${file}`], {
        maxBuffer: 1 << 26,
      }),
    );
  }
  return {
    ...out,
    recovery: join(stills, 'recovery-v2.png'),
    damaged: join(stills, 'damaged-v1.png'),
  };
}

async function openControl(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  width: WidthName,
  site: { origin: string },
) {
  const touch = width === 'phone';
  const context = await browser.newContext({
    viewport: WIDTHS[width],
    hasTouch: touch,
    isMobile: touch,
    acceptDownloads: true,
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const seen = network[width]!;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'next.facemorph.me') {
      seen[url.host] = (seen[url.host] ?? 0) + 1;
      return route.abort();
    }
    if (url.pathname.startsWith('/runtime/')) {
      const file = join(runtimeDir, url.pathname.slice('/runtime/'.length));
      if (!file.startsWith(runtimeDir) || !existsSync(file) || !statSync(file).isFile())
        return route.fulfill({ status: 404 });
      const body = readFileSync(file);
      const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
      if (range) {
        const from = Number(range[1]);
        const to = range[2] ? Number(range[2]) : body.length - 1;
        return route.fulfill({
          status: 206,
          headers: { ...headers, 'content-range': `bytes ${from}-${to}/${body.length}` },
          body: body.subarray(from, to + 1),
        });
      }
      return route.fulfill({ headers, body });
    }
    return route.fulfill({
      response: await route.fetch({ url: site.origin + url.pathname + url.search }),
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { context, page, touch, errors };
}

// It needs the acquired runtime and the pinned control: without them (a hosted runner) it is reported untested.
const UNTESTED = !existsSync(join(runtimeDir, 'manifest.json'))
  ? 'untested: no acquired runtime at .cache/runtime'
  : !existsSync(join(repo, 'deploy-next'))
    ? 'untested: no deploy-next/ (npm run build:next)'
    : false;
test(
  'the control’s states, operated with real pointer input at phone and desktop width',
  { skip: UNTESTED },
  async (t) => {
    assert.ok(
      existsSync(join(repo, 'deploy-next')),
      'no deploy-next/: run `npm run build:next` first',
    );
    mkdirSync(results, { recursive: true });
    const identity = JSON.parse(readFileSync(join(repo, 'next-site-identity.json'), 'utf8'));
    const digest = artifactDigest(identity.files);
    const site = await serveArtifact(repo, digest);
    t.after(() => site.close());
    const fx = fixtures();
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const steps = new StepLog({
      map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }),
      run: { ...site.tag },
    });
    const started = Date.now();

    for (const width of (process.env['CONTROL_STATES_WIDTHS']?.split(',') ?? [
      'phone',
      'desktop',
    ]) as WidthName[]) {
      const t0 = Date.now();
      const { context, page, touch, errors } = await openControl(browser, width, site);
      const s = new Session(page, width, touch, steps);
      try {
        await journey(s, fx, errors);
      } finally {
        await context.tracing
          .stop({ path: join(results, `${width}-trace.zip`) })
          .catch(() => undefined);
        await context.close();
        wall[width] = Math.round((Date.now() - t0) / 1000);
      }
    }
    steps.write(join(results, 'steps.jsonl'));

    const record = {
      schema: 'facemorph.control-states/1',
      control: {
        commit: identity.deploySource.commit,
        buildId: identity.deploySource.buildId,
        deploy_next_sha256: digest,
        identityFile: 'next-site-identity.json',
      },
      browser: `chromium ${browser.version()} (Playwright, headless, CPU only: no WebGPU adapter)`,
      capturedAt: new Date().toISOString().slice(0, 10),
      widths: WIDTHS,
      input: { desktop: 'real mouse', phone: 'real touch taps (emulated touch, not a phone cell)' },
      method:
        'Every press through operatedClick/operatedTap; typing through typeOperated. Origin https://next.facemorph.me answered from the digest-bound local artifact and the acquired runtime; other hosts aborted. observed.copy lines are prefixed by the layer they were read from (dialog, menu, toast, error, status, note, tile N).',
      externalRequestsAborted: network,
      wallSeconds: { ...wall, total: Math.round((Date.now() - started) / 1000) },
      pageErrors,
      surfaces,
      defects,
    };
    writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
    assert.ok(
      Object.values(WIDTHS).length === 2 &&
        surfaces['main-page'].phone.observed.length +
          surfaces['main-page'].desktop.observed.length >
          0,
      'the control was read',
    );
  },
);

const ANY = ['local', 'app', 'names-host', 'third-party', 'model-host', 'collector'];
const BUSY = /generating|downloading|preparing|detecting|encoding|finding/i;

/** Waits, as a person does, until nothing is working and a result or an error shows; returns what ended it. */
async function settle(s: Session, ms: number, tile?: number) {
  const t0 = Date.now();
  await s.page.waitForTimeout(2500);
  while (Date.now() - t0 < ms) {
    const snap = (await s.page.evaluate(SNAPSHOT)) as { copy: string[] };
    const busy = snap.copy.some((l) => BUSY.test(l) && !l.startsWith('dialog:'));
    const error = snap.copy.find((l) => l.startsWith('error:'));
    const saved = snap.copy.some((l) =>
      (tile === undefined
        ? /^tile \d+:.*SAVE IMAGE/
        : new RegExp(`^tile ${tile + 1}:.*SAVE IMAGE`)
      ).test(l),
    );
    if (!busy && error) return 'error';
    if (!busy && saved) return 'saved';
    await s.page.waitForTimeout(800);
  }
  return null;
}

async function journey(s: Session, fx: ReturnType<typeof fixtures>, errors: string[]) {
  const { page } = s;
  // The consent toast's own Not now (a dialog opened behind it may carry another).
  const consentNotNow = () => s.btn(page.locator('.MuiSnackbarContent-root').first(), /^not now$/i);
  const field = (i: number) => s.tile(i).locator('input[type=text], input:not([type])').first();
  const tileCount = () => page.locator('section.next-face').count();
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('section.next-face');
  await page.waitForTimeout(2500);

  // 1. Main page, first visit: one filled preview tile, one empty tile, and the model-consent toast.
  await s.see(
    'main-page',
    'empty-first-visit',
    'One filled preview tile ("Cached preview") and one empty tile; the model-consent toast is open.',
  );

  // A toast must not cover an action: press what the toast sits over.
  const cover = await s.tryPress('names-under-toast', s.btn(s.tile(0), 'Browse names'), 1500);
  if (cover) {
    s.defect(
      'main',
      'The first-visit model-consent toast covers a face control; a real press cannot reach it.',
      cover,
    );
    await s.see('main-page', 'toast-covering-controls', `Pressing Browse names failed: ${cover}`);
  } else {
    await s.see(
      'modals',
      'names-opened-with-consent-toast-up',
      'Browse names was pressable with the consent toast open at this width.',
    );
    await page.keyboard.press('Escape');
  }
  const coverMode = await s.tryPress('mode-under-toast', s.btn(s.tile(0), 'Change mode'), 1500);
  if (coverMode) s.defect('main', 'The first-visit consent toast covers Change mode.', coverMode);
  else await page.keyboard.press('Escape');

  await s.press('not-now', consentNotNow());
  await s.see(
    'main-page',
    'after-consent-not-now',
    'Consent toast dismissed with Not now; the test-reports toast follows.',
  );
  const reportsNo = s.btn(page, /^no thanks$/i);
  if (await reportsNo.isVisible().catch(() => false)) {
    await s.press('reports-no-thanks', reportsNo);
    await s.see(
      'main-page',
      'after-reports-no-thanks',
      'Debug-report prompt declined; no toast left.',
    );
  }

  // 1. Where the source menu is.
  await attempt(s, 'main-page', 'mode-menu', async () => {
    await s.press('change-mode', s.btn(s.tile(0), 'Change mode'));
    await s.see(
      'main-page',
      'tile-mode-menu',
      'The per-tile source menu (Change mode) on the tile.',
    );
    await page.keyboard.press('Escape');
  });

  // 6. Names picker: open, search, empty search, pick, dismiss.
  await attempt(s, 'names-picker', 'open', async () => {
    await s.press('browse-names', s.btn(s.tile(0), 'Browse names'));
    await page.waitForTimeout(2000);
    const contrast = await page.evaluate(() => {
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g)!.map(Number);
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!);
      };
      const bgOf = (e: Element | null) => {
        for (let n = e; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(.*, 0\)|transparent/.test(c)) return c;
        }
        return 'rgb(255, 255, 255)';
      };
      const out: Record<string, string> = {};
      for (const [label, el] of [
        [
          'Close',
          [...document.querySelectorAll('button')].find((b) => /^close$/i.test(b.innerText.trim())),
        ],
        [
          'Browse names title',
          [...document.querySelectorAll('h1,h2,h3,h6,p,span,div')].find(
            (e) =>
              e.children.length === 0 &&
              /^browse names$/i.test((e as HTMLElement).innerText?.trim() ?? ''),
          ),
        ],
      ] as const) {
        if (!el) continue;
        const fg = getComputedStyle(el).color,
          bg = bgOf(el);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
        out[label] = `text ${fg} on ${bg}: ${((a + 0.05) / (b + 0.05)).toFixed(2)} to 1`;
      }
      return out;
    });
    for (const [label, value] of Object.entries(contrast)) {
      const ratio = Number(/: ([\d.]+) to 1/.exec(value)?.[1]);
      if (ratio < 4.5)
        s.defect('namesPicker', `${label} in the names dialog is below 4.5 to 1 contrast.`, value);
    }
    await s.see(
      'names-picker',
      'opened',
      `External hosts aborted: ${JSON.stringify(network[s.width])}. Name tiles trimmed to the first 12 in the record.`,
    );
    const search = page.getByPlaceholder('Search names');
    await s.press('names-search-focus', search);
    await typeOperated(page, 'ol', {
      log: s.log,
      step: `control-states/${s.width}/names-search`,
      allow: ANY,
    });
    await s.see('names-picker', 'search-ol', 'Typed "ol" in the search field.');
    await page.keyboard.press('Control+A');
    await typeOperated(page, 'zzqqxx', {
      log: s.log,
      step: `control-states/${s.width}/names-search-none`,
      allow: ANY,
    });
    await s.see('names-picker', 'search-empty-result', 'Typed a string that matches no name.');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    const pick = page.getByRole('button', { name: /^charlotte$/i }).first();
    await s.press('names-pick', pick);
    await s.see('names-picker', 'after-pick', 'A name pressed: the dialog and the tile after it.');
    await s.press('browse-names-2', s.btn(s.tile(0), 'Browse names'));
    await page.waitForTimeout(1200);
    await s.press('names-close', s.btn(page, /^close$/i).first());
    await s.see('names-picker', 'dismissed-by-close', 'Close pressed.');
    await s.press('browse-names-3', s.btn(s.tile(0), 'Browse names'));
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await s.see('modals', 'names-after-escape', 'Escape pressed with the names picker open.');
  });

  // 2. Cold download modal.
  await attempt(s, 'download-modal', 'open', async () => {
    await s.press('generate-1', s.btn(s.tile(0), /^generate/i));
    await s.until(/^dialog:/, 8000);
    await s.see(
      'download-modal',
      'cold-face-model-dialog',
      'Generate pressed before any model is on the device.',
    );
    const focusIn = await page.evaluate(
      () => document.activeElement?.textContent?.trim() ?? document.activeElement?.tagName,
    );
    await page.keyboard.press('Escape');
    await s.see(
      'modals',
      'download-dialog-after-escape',
      `Escape pressed with the download dialog open (focus was on "${focusIn}" while open).`,
    );
    const focusBack = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent?.trim() ??
        document.activeElement?.tagName,
    );
    surfaces['modals'][s.width].observed.push({
      state: 'focus-after-dialog-closed',
      copy: [`focus: ${focusBack}`],
      controls: [],
      note: 'Where focus is after the dialog closed by Escape.',
    });
    await s.press('generate-2', s.btn(s.tile(0), /^generate/i));
    await s.until(/^dialog:/, 8000);
    await s.press('download-cancel-button', s.btn(page, /^cancel$/i));
    await s.see(
      'download-modal',
      'cancelled',
      'Cancel pressed: dialog gone, tile unchanged, nothing downloaded.',
    );
    await s.press('generate-3', s.btn(s.tile(0), /^generate/i));
    await s.until(/^dialog:/, 8000);
    await s.press('download-continue', s.btn(page, /download and continue/i));
    await s.until(/MB of/, 20000);
    await s.see('download-modal', 'in-progress', 'Download and continue pressed.');
    const cancel = await s.tryPress(
      'tile-cancel-during-download',
      s.btn(s.tile(0), /^cancel$/i),
      800,
    );
    if (!cancel) {
      await s.see(
        'download-modal',
        'cancelled-while-downloading',
        'Tile Cancel pressed while the model downloads.',
      );
      await s.press('generate-4', s.btn(s.tile(0), /^generate/i));
      const again = await s.until(/^dialog:/, 4000);
      await s.see(
        'download-modal',
        again === null
          ? 'generate-after-cancelled-download-no-dialog'
          : 'generate-after-cancelled-download-dialog',
        'Generate pressed again after cancelling the download.',
      );
      if (again !== null)
        await s.press('download-continue-2', s.btn(page, /download and continue/i));
    } else s.gone('download-modal', 'cancel while downloading', cancel);
  });

  // 1/5. Generating on CPU, then completed.
  await attempt(s, 'tiles', 'generating', async () => {
    await s.until(/generating/i, 60000);
    await s.see(
      'tiles',
      'active-generating',
      'The tile that is making its face (progress copy below the picture).',
    );
    if ((await settle(s, 240000, 0)) !== 'saved')
      throw new Error('the first face did not complete within 4 minutes');
    await s.see(
      'main-page',
      'one-face-completed',
      'One tile generated; the second tile still empty.',
    );
  });

  // 7. Save and Share.
  await attempt(s, 'result-actions', 'save-image', async () => {
    const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await s.press('save-image', s.btn(s.tile(0), /save image/i).first());
    const d = await download;
    if (!d) throw new Error('Save image pressed; no download started within 15 s');
    surfaces['result-actions'][s.width].observed.push({
      state: 'save-image-pressed',
      copy: [`download: ${d.suggestedFilename()}`],
      controls: [],
      note: 'A real download was started.',
    });
    await s.see('result-actions', 'after-save-image', 'After Save image.');
  });
  await attempt(s, 'result-actions', 'share-image', async () => {
    const canShare = await page.evaluate(() => typeof navigator.share === 'function');
    await s.press('share-image', s.btn(s.tile(0), /share image/i).first());
    await s.see(
      'result-actions',
      'after-share-image',
      `navigator.share is ${canShare ? 'present' : 'absent'} in this browser; no copy appeared in response to the press.`,
    );
    if (!canShare)
      s.gone(
        'result-actions',
        'native share sheet',
        'headless Chromium has no share sheet (navigator.share absent): only the control’s own response could be seen',
      );
    await page.keyboard.press('Escape');
  });

  // 5. Second face by typing (its field starts with a date-based word), generated; tile 1 asked again meanwhile.
  await attempt(s, 'tiles', 'second-face', async () => {
    await s.press('focus-second-field', field(1));
    await page.keyboard.press('Control+A');
    await typeOperated(page, 'world', {
      log: s.log,
      step: `control-states/${s.width}/type-world`,
      allow: ANY,
    });
    await s.see(
      'tiles',
      'second-face-typed-before-generate',
      'Words typed in the second tile (its field held a date-based default before); nothing generated yet.',
    );
    await s.press('generate-world', s.btn(s.tile(1), /^generate/i));
    await s.until(/generating/i, 20000);
    const other = await s.tryPress(
      'generate-tile1-while-tile2-works',
      s.btn(s.tile(0), /^generate/i),
      800,
    );
    await s.see(
      'tiles',
      'second-tile-generating',
      other
        ? `Second tile generating; Generate on tile 1 could not be pressed: ${other}`
        : 'Second tile generating; Generate on tile 1 was pressed meanwhile.',
    );
    if ((await settle(s, 240000, 1)) !== 'saved')
      throw new Error('the second face did not complete within 4 minutes');
    await s.see(
      'main-page',
      'two-faces-completed',
      'Both tiles completed; Create morph, More options and Add face are offered.',
    );
  });
  s.gone(
    'tiles',
    'queued',
    'A tile waiting behind another showed no queued copy in any observation above; the working tile shows Generating, the others only a disabled or enabled Generate.',
  );

  // 1. The CPU/WebGPU selector.
  await attempt(s, 'main-page', 'processing-mode-selector', async () => {
    await s.press('more-options', s.btn(page, /more options/i));
    await s.see('main-page', 'more-options-open', 'Shape, length and pinch options.');
    await s.press('advanced', page.locator('.next-advanced summary'));
    await s.see(
      'main-page',
      'advanced-processing-mode',
      'Advanced: the only place the processing choice is offered.',
    );
    const mode = page.getByLabel('Processing mode');
    surfaces['main-page'][s.width].observed.push({
      state: 'processing-mode-options',
      copy: await mode.locator('option').allInnerTexts(),
      controls: ['Processing mode'],
      note: 'Options of the native select inside More options > Advanced.',
    });
  });

  // 7. Morph at the shortest length, then invalidate it by editing a face.
  await attempt(s, 'morph-result', 'create-morph', async () => {
    const length = page.getByLabel('Morph length');
    await s.press('morph-length', length);
    await page.keyboard.press('Escape');
    surfaces['morph-result'][s.width].observed.push({
      state: 'morph-length-options',
      copy: await length.locator('option').allInnerTexts(),
      controls: ['Morph length'],
      note: 'Options of the native select in More options.',
    });
    const options = await length
      .locator('option')
      .evaluateAll((o) => (o as HTMLOptionElement[]).map((x) => x.value));
    await length.selectOption(options[0]!);
    await s.press('create-morph', page.locator('.next-primary-action'));
    await s.until(/generating|frame|morph/i, 30000);
    await s.see('morph-result', 'morph-generating', 'Create morph pressed at the shortest length.');
    const t0 = Date.now();
    let finished = false;
    while (Date.now() - t0 < MORPH_DEADLINE_MS) {
      const snap = (await page.evaluate(SNAPSHOT)) as { controls: string[] };
      if (snap.controls.some((c) => /use slider|play|save video|share video/i.test(c))) {
        finished = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    if (!finished) {
      await s.see(
        'morph-result',
        'morph-progress-at-deadline',
        `Not finished after ${Math.round(MORPH_DEADLINE_MS / 1000)} s on CPU.`,
      );
      s.gone(
        'morph-result',
        'play, scrub, invalidation by a face change',
        `the morph did not finish within the ${Math.round(MORPH_DEADLINE_MS / 1000)} s budget on this CPU`,
      );
      const cancel = s.btn(page, /^cancel$/i).last();
      if (await cancel.isVisible().catch(() => false)) {
        await s.press('morph-cancel', cancel);
        await s.see('morph-result', 'morph-cancelled', 'Cancel pressed during morph generation.');
      }
      return;
    }
    await s.see(
      'morph-result',
      'morph-complete',
      `A finished morph after ${Math.round((Date.now() - t0) / 1000)} s.`,
    );
    const useSlider = s.btn(page, /use slider/i).first();
    if (await useSlider.isVisible().catch(() => false)) {
      await s.press('use-slider', useSlider);
      await s.see('morph-result', 'slider-shown', 'Use Slider pressed.');
    }
    const play = s.btn(page, /^play/i).first();
    if (await play.isVisible().catch(() => false)) {
      await s.press('play', play);
      await s.see('morph-result', 'playing', 'Play pressed.');
    }
    const rail = page.locator('.next-slider-control');
    if (await rail.count()) {
      const box = await rail.boundingBox();
      if (box) {
        await s.press('scrub-slider', rail);
        await s.see('morph-result', 'scrubbed', 'Slider pressed at its centre.');
      }
    }
    await s.press('focus-first-field', field(0));
    await typeOperated(page, 'x', {
      log: s.log,
      step: `control-states/${s.width}/invalidate-typing`,
      allow: ANY,
    });
    await s.see(
      'morph-result',
      'after-face-text-changed',
      'First face text edited after a morph exists.',
    );
    await s.press('generate-changed', s.btn(s.tile(0), /^generate/i));
    await s.until(/^dialog:/, 3000);
    if ((await settle(s, 120000, 0)) !== 'saved')
      s.gone(
        'morph-result',
        'result after regenerating the changed face',
        'tile 1 did not complete within 2 minutes',
      );
    await s.see(
      'morph-result',
      'after-changed-face-regenerated',
      'The changed face regenerated: does the morph survive?',
    );
  });

  // 3. Photo flow on a third tile.
  await attempt(s, 'tiles', 'third-tile', async () => {
    await s.press('add-face', s.btn(page, /^add face$/i));
    await s.see('tiles', 'three-tiles', 'Add face pressed once.');
  });
  const lastTile = async () => s.tile((await tileCount()) - 1);
  const choose = async (name: string, file: string) =>
    s.choose(name, s.btn(await lastTile(), /choose photo/i).first(), file);
  await attempt(s, 'photo-crop', 'choose-photo', async () => {
    await choose('choose-photo', fx.seed);
    await s.until(/^dialog:/, 15000);
    await s.see(
      'photo-crop',
      'encoder-dialog-cold',
      'A clear single-face photo chosen with the photo encoder missing: the control asks to download the encoder first; no crop confirmation, Adjust Crop or OK appears.',
    );
    await s.see('download-modal', 'cold-encoder-dialog', 'The photo-encoder download dialog.');
    await s.press('encoder-cancel', s.btn(page, /^cancel$/i));
    await s.see(
      'download-modal',
      'encoder-cancelled',
      'Encoder dialog cancelled; the chosen photo name stays in the tile.',
    );
    await s.press('generate-photo-tile', s.btn(await lastTile(), /^generate/i));
    await s.until(/^dialog:/, 8000);
    await s.press('encoder-download', s.btn(page, /download and continue/i));
    await s.until(/MB of/, 30000);
    await s.see('download-modal', 'encoder-in-progress', 'Encoder download in progress.');
    if ((await settle(s, 420000, (await tileCount()) - 1)) !== 'saved')
      throw new Error('the photo was not encoded within 7 minutes');
    await s.see(
      'photo-crop',
      'photo-encoded',
      'The photo became a face; Crop photo and Hold to compare are on the tile.',
    );
  });
  s.gone(
    'photo-crop',
    'crop confirmation, Adjust Crop, OK',
    'No such step is shown: a clear photo goes straight to the encoder dialog or to encoding. The only crop entry is the Crop photo button under the tile, and its editor offers Cancel crop / Use this crop.',
  );

  await attempt(s, 'photo-crop', 'crop-editor', async () => {
    await s.press('crop-photo', s.btn(await lastTile(), /crop photo/i));
    await page.waitForTimeout(1500);
    await s.see('photo-crop', 'crop-editor-open', 'Crop photo pressed on an encoded photo.');
    await page.keyboard.press('Escape');
    await s.see('modals', 'crop-editor-after-escape', 'Escape with the crop editor open.');
    await s.press('crop-photo-2', s.btn(await lastTile(), /crop photo/i));
    await page.waitForTimeout(1200);
    await s.press('crop-cancel', s.btn(page, /cancel crop/i));
    await s.see(
      'photo-crop',
      'crop-editor-cancelled',
      'Cancel crop pressed: editor gone, photo unchanged.',
    );
    await s.press('crop-photo-3', s.btn(await lastTile(), /crop photo/i));
    await page.waitForTimeout(1200);
    await s.press('use-this-crop', s.btn(page, /use this crop/i));
    await s.see('photo-crop', 'after-use-this-crop', 'Use this crop pressed.');
    const r = await settle(s, 180000, (await tileCount()) - 1);
    await s.see('photo-crop', 'after-use-this-crop-settled', `Settled: ${r}.`);
  });

  // 3/4. No face and several faces.
  await attempt(s, 'photo-crop', 'no-face', async () => {
    await choose('choose-no-face', fx.noFace);
    const r = await settle(s, 120000);
    await s.see('photo-crop', 'no-face-photo', `no-face.png chosen; settled: ${r}.`);
    await s.see('tiles', 'failed-among-completed', 'A failed tile with completed tiles beside it.');
    const retry = s.btn(page, /try again/i);
    if (await retry.isVisible().catch(() => false)) {
      await s.press('retry-after-failure', retry);
      await settle(s, 120000);
      await s.see('tiles', 'after-retry', 'Try again pressed on the failure.');
    } else s.gone('tiles', 'retry', 'no Try again control was visible after the failure');
    const dismiss = s.btn(page, /^dismiss$/i);
    if (await dismiss.isVisible().catch(() => false)) {
      await s.press('dismiss-failure', dismiss);
      await s.see('tiles', 'failure-dismissed', 'Dismiss pressed.');
    }
  });
  await attempt(s, 'multi-face', 'several-faces', async () => {
    await choose('choose-multiple-faces', fx.multi);
    const r = await settle(s, 120000);
    await s.see('multi-face', 'multiple-faces-photo', `multiple-faces.png chosen; settled: ${r}.`);
  });

  // 9. File open: recovery-bearing, damaged and plain stills.
  for (const [state, file, note] of [
    ['recovery-v2-still', fx.recovery, 'A still saved by the app with recovery metadata.'],
    ['damaged-v1-still', fx.damaged, 'A schema-1 still with one metadata byte flipped.'],
    ['plain-image', fx.seed, 'A plain image with no recovery metadata, chosen the same way.'],
  ] as const)
    await attempt(s, 'file-open', state, async () => {
      await choose(`open-${state}`, file);
      const r = await settle(s, 150000);
      await s.see('file-open', state, `${note} Settled: ${r}.`);
    });

  // 8. Browser Back with the names picker open (last: a Back that leaves the page ends the session's state).
  await attempt(s, 'modals', 'names-browser-back', async () => {
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector('section.next-face');
    await page.waitForTimeout(2000);
    const toast = consentNotNow();
    if (await toast.isVisible().catch(() => false)) await s.press('not-now-again', toast);
    const no = s.btn(page, /^no thanks$/i);
    if (await no.isVisible().catch(() => false)) await s.press('no-thanks-again', no);
    await s.press('browse-names-back-test', s.btn(s.tile(0), 'Browse names'));
    await page.waitForTimeout(1500);
    const before = page.url();
    const historyLength = await page.evaluate(() => history.length);
    await page.goBack({ timeout: 5000 }).catch(() => undefined);
    await s.see(
      'modals',
      'names-after-browser-back',
      `Browser Back pressed with the names picker open. history length ${historyLength}; url before ${before}, after ${page.url()}.`,
    );
  });

  if (errors.length) pageErrors[s.width] = errors.slice(0, 5).map((e) => e.slice(0, 300));
}
