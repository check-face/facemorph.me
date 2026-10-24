// The built-UI journey vocabulary shared by the maintained drivers (fm-qqh), written against the control's DOM
// contract (section.next-face with data-next-state, .next-product data-next-busy, .next-route-caption): worker
// message instrumentation, timed steps with their worker events, the settle condition of a face, downloads with
// their bytes and digest, the processing-route choice and a playable morph video.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORIGIN } from './session.mjs';

export const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Init script: every worker message (in and out) with its time, product busy transitions, and the driver
 * answering consent, the model toast and the download dialog the moment they show. */
export const INSTRUMENT = () => {
  window.__pair = { events: [], workers: 0, busyChanges: 0, mark: 0, markAt: 0 };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...args) {
      super(...args);
      window.__pair.workers++;
      this.addEventListener('message', ({ data: d }) => {
        if (d && typeof d === 'object')
          window.__pair.events.push({
            at: performance.now(),
            type: d.type,
            stage: d.stage,
            provider: d.provider,
            routeOutcome: d.routeOutcome,
          });
      });
    }
    postMessage(m, ...a) {
      window.__pair.events.push({ at: performance.now(), posted: m?.type });
      return super.postMessage(m, ...a);
    }
  };
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => window.__pair.busyChanges++).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-next-busy'],
    });
    setInterval(() => {
      document.querySelector('.next-download-dialog .next-download-accept')?.click();
      document.querySelector('.next-consent-toast button[aria-label="Ask me later"]')?.click();
      [...document.querySelectorAll('.next-model-toast button')]
        .find((b) => b.textContent.trim() === 'Not now')
        ?.click();
    }, 30);
  });
};

/** Journey helpers on one page; entry.steps receives each timed step, save() persists the report. */
export function journey(page, entry, { save, log }) {
  const tile = (i) => page.locator('section.next-face').nth(i);

  async function step(name, action, done) {
    const before = await page.evaluate(() => {
      const p = window.__pair;
      p.mark = p.busyChanges;
      p.markAt = performance.now();
      return { at: p.markAt, n: p.events.length, w: p.workers };
    });
    const s = { name };
    entry.steps.push(s);
    save();
    await action();
    await done();
    Object.assign(
      s,
      await page.evaluate(
        ({ at, n, w }) => ({
          ms: performance.now() - at,
          newWorkers: window.__pair.workers - w,
          events: window.__pair.events.slice(n).map((e) => ({ ...e, at: e.at - at })),
          route: document.querySelector('.next-route-caption')?.innerText ?? '',
        }),
        before,
      ),
    );
    s.passed = true;
    log({ step: name, ms: Math.round(s.ms) });
    save();
    return s;
  }

  // A face is settled when its tile is in `state` (a typed or seeded face is 'filled', a photo face 'photo') and the
  // product is idle after this step's run: a run that went busy must have come back, and one that never went busy
  // (a cached face) is given 2 s to start. An error, or a crop dialog this journey did not ask for, fails the step.
  const settled =
    (i, state = 'filled') =>
    () =>
      page.waitForFunction(
        ({ i, state }) => {
          const err = document.querySelector('.next-error');
          if (err?.innerText) throw new Error(err.innerText);
          if (document.querySelector('.next-crop-view'))
            throw new Error(
              'the crop dialog opened: this journey expects a face the detector finds',
            );
          const p = window.__pair;
          const started = p.busyChanges > p.mark || performance.now() - p.markAt > 2000;
          return (
            started &&
            document.querySelector('.next-product')?.getAttribute('data-next-busy') === 'false' &&
            document.querySelectorAll('section.next-face')[i]?.getAttribute('data-next-state') ===
              state
          );
        },
        { i, state },
        { timeout: 600_000, polling: 10 },
      );

  async function download(name, button) {
    let file;
    const s = await step(
      name,
      async () => {
        const pending = page.waitForEvent('download', { timeout: 120_000 });
        await button.click();
        file = await pending;
      },
      async () => {
        const failure = await file.failure();
        if (failure) throw new Error(failure);
      },
    );
    const bytes = readFileSync(await file.path());
    return Object.assign(s, {
      bytes: bytes.length,
      sha256: sha(bytes),
      filename: file.suggestedFilename(),
    });
  }

  /** Opens the origin, checks the page is visible and cross-origin isolated, and selects the processing route. */
  async function open(route) {
    await page.goto(`${ORIGIN}/`);
    await tile(1).waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelector('.next-product')?.getAttribute('data-next-busy') === 'false',
      null,
      { timeout: 60_000 },
    );
    entry.navigation = await page.evaluate(() => ({
      visibility: document.visibilityState,
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
      isolation: crossOriginIsolated,
      workers: window.__pair.workers,
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    }));
    if (entry.navigation.visibility !== 'visible' || !entry.navigation.isolation)
      throw new Error('invalid visible/isolation state');
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.locator('.next-advanced').evaluate((e) => (e.open = true));
    await page.getByLabel('Processing mode').selectOption(route);
    await page.keyboard.press('Escape');
  }

  /** Types `text` into a face's field and generates it. */
  async function face(i, text, name = `new-face-${i + 1}`) {
    await tile(i).locator('.next-field input').fill(text);
    return step(name, () => tile(i).locator('.next-face-generate').click(), settled(i));
  }

  /** Create morph, done at a playable 1024x1024 video with the product idle. */
  async function morph(name = 'video') {
    const s = await step(
      name,
      () => page.locator('.next-primary-action').click(),
      () =>
        page.waitForFunction(
          () => {
            const err = document.querySelector('.next-error');
            if (err?.innerText) throw new Error(err.innerText);
            const v = document.querySelector('video.next-video');
            return (
              v?.readyState >= 2 &&
              v.videoWidth === 1024 &&
              v.videoHeight === 1024 &&
              Number.isFinite(v.duration) &&
              document.querySelector('.next-product')?.getAttribute('data-next-busy') === 'false'
            );
          },
          null,
          { timeout: 900_000, polling: 10 },
        ),
    );
    s.video = await page.locator('video.next-video').evaluate((v) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      readyState: v.readyState,
    }));
    return s;
  }

  return { tile, step, settled, download, open, face, morph };
}
