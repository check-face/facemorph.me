// The operated click and tap (fm-48bj) on the defect-1 regression page, in real Chromium, Firefox and WebKit: the
// covered, clipped and off-screen controls fail with the element actually hit, a visible control passes, scrolled,
// transformed and nested controls are found, a press outside the declared region fails, a small target is reported,
// and the step log records the step ID, point, hit element and the step's requests.
//   node --test test/e2e/verify-operated.e2e.ts      (FACEMORPH_E2E_ENGINES=webkit to run one engine)
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import { serve, type Served } from '../support/serve.ts';
import { bindOrigins, DEFAULT_HOST_MAP } from '../verify/artifact.ts';
import { operatedClick, operatedTap, StepLog } from '../verify/operated.ts';

const app = new URL('../../', import.meta.url);
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const only = process.env['FACEMORPH_E2E_ENGINES']?.split(',');

let site: Served;
before(async () => {
  site = await serve(new URL('test/fixtures', app).pathname, {
    '/fixtures/': new URL('test/fixtures', app).pathname,
  });
});
after(async () => {
  await site?.close();
});

for (const [engine, type] of Object.entries(ENGINES)) {
  if (only && !only.includes(engine)) continue;
  test(`${engine}: operated input on the defect-1 regression page`, async (t) => {
    const browser = await type.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${site.origin}/verify/operated.html?late=1`);
    const pressed = () => page.locator('#pressed').textContent();
    const log = new StepLog({ map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }) });
    const fast = { log, settleMs: 300 };

    // Defect 1: the covered Remove fails, naming the mode-menu button actually hit, and nothing is pressed.
    await assert.rejects(
      operatedClick(page, page.getByLabel('Remove face 1'), {
        ...fast,
        step: 'verify.harness/defect-1/press-remove',
        region: { within: page.locator('#face-covered'), part: 'top-right' },
      }),
      (e: Error) => {
        assert.match(e.message, /verify\.harness\/defect-1\/press-remove/);
        assert.match(e.message, /not the control but <button id="mode-menu"/);
        assert.match(e.message, /step log:/);
        return true;
      },
    );
    assert.equal(await pressed(), '', 'the failed check pressed nothing');
    const covered = log.entries.at(-1)!;
    assert.equal(covered.ok, false);
    assert.match(covered.hit ?? '', /^<button id="mode-menu"/);
    assert.ok(covered.point && covered.point.x > 0 && covered.point.y > 0, 'the point is logged');

    // The visible Remove, in the top-right quadrant of its image, is pressed for real; its request is counted.
    const visible = await operatedClick(page, page.getByLabel('Remove face 2'), {
      log,
      step: 'verify.harness/defect-1/press-visible-remove',
      region: { within: page.locator('#face-visible'), part: 'top-right' },
      effect: () => page.waitForResponse((r) => r.url().endsWith('?after-press')),
    });
    assert.equal(await pressed(), 'remove-visible');
    assert.equal(visible.requests['app']?.count, 1, 'the press caused one request');
    assert.ok((visible.requests['app']?.bytes ?? 0) > 0, 'its bytes are summed');
    assert.deepEqual(visible.target, { width: 32, height: 32 });
    assert.equal(visible.smallTarget, true, 'a 32 px target is reported under 44 px');

    // The same control with a region it is not in fails: Remove is not in the image's bottom-left quadrant.
    await assert.rejects(
      operatedClick(page, page.getByLabel('Remove face 2'), {
        ...fast,
        step: 'verify.harness/region/wrong-quadrant',
        region: { within: page.locator('#face-visible'), part: 'bottom-left' },
      }),
      /outside the bottom-left of/,
    );

    // Clipped by its container, and off screen: both fail.
    await assert.rejects(
      operatedClick(page, page.locator('#clipped'), {
        ...fast,
        step: 'verify.harness/clipped/press',
      }),
      /elementFromPoint at its centre is not the control/,
    );
    await assert.rejects(
      operatedClick(page, page.locator('#off-screen'), {
        ...fast,
        step: 'verify.harness/off-screen/press',
      }),
      /outside the viewport/,
    );

    // Transformed, nested and far down the page (scrolled into view first) are found and pressed.
    for (const id of ['transformed', 'nested', 'scrolled', 'small']) {
      const r = await operatedClick(page, page.locator(`#${id}`), {
        log,
        step: `verify.harness/${id}/press`,
      });
      assert.equal(await pressed(), id, `${engine}: ${id} pressed`);
      assert.equal(
        r.smallTarget,
        id === 'small',
        `${id}: small target reported only for the 24 px one`,
      );
      if (id === 'scrolled')
        assert.ok(
          (await page.evaluate(() => scrollY)) > 1000,
          'the scrolled control was scrolled into view',
        );
    }

    // Every step is in the log with its ID, point and hit element.
    const steps = log.entries.map((e) => e.step);
    assert.ok(steps.includes('verify.harness/defect-1/press-remove'));
    for (const e of log.entries.filter((x) => x.ok))
      assert.ok(e.point && e.hit && e.target, `${e.step} has point, hit and target`);
    // The pre-input centre is correct, but a real pointerdown reveals an overlay before pointerup/click.
    // A geometry-only helper passes this while the intended control receives no click.
    await page.setContent(
      '<button id="race" style="width:120px;height:60px">Press</button><div id="cover" style="display:none;position:fixed;inset:0;background:red"></div>',
    );
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('#race')!;
      button.addEventListener('pointerdown', () => {
        document.querySelector<HTMLElement>('#cover')!.style.display = 'block';
      });
      button.addEventListener('click', () => {
        button.dataset['clicked'] = 'true';
      });
    });
    await assert.rejects(
      operatedClick(page, page.locator('#race'), {
        ...fast,
        step: 'verify.harness/race/late-overlay',
      }),
      /trusted click landed outside the control/,
    );
    assert.equal(
      await page.locator('#race').getAttribute('data-clicked'),
      null,
      'real input did not click the intended control',
    );
    assert.equal(log.entries.at(-1)?.ok, false);
    assert.ok(log.entries.at(-1)?.hit, 'the actual late target is recorded');
    log.write(new URL(`test-results/verify/${engine}-operated.log`, app).pathname);
  });

  test(`${engine}: operated tap at phone width`, async (t) => {
    const browser = await type.launch();
    t.after(() => browser.close());
    // Firefox has no isMobile; hasTouch is what the tap needs.
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      ...(engine === 'firefox' ? {} : { isMobile: true }),
    });
    await page.goto(`${site.origin}/verify/operated.html`);
    const log = new StepLog({ map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }) });
    const r = await operatedTap(page, page.locator('#nested'), {
      log,
      step: 'verify.harness/tap/nested',
    });
    assert.equal(r.input, 'touch');
    assert.equal(await page.locator('#pressed').textContent(), 'nested');
    await assert.rejects(
      operatedTap(page, page.getByLabel('Remove face 1'), {
        log,
        settleMs: 300,
        step: 'verify.harness/tap/covered',
      }),
      /not the control but <button id="mode-menu"/,
    );
  });
}
