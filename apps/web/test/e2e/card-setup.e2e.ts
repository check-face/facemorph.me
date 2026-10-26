// Browser-lane regression: fm-fy2.17.1 bans per-card encoder setup,
// while fm-qh1s requires file preparation in the existing operation slot, without a reserved blank slot.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { assertNoCardPreparation } from '../support/card-setup.ts';

test('card preparation distinguishes required file states from encoder setup and empty slots', async (t) => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const render = (operation: string) =>
      page.setContent(`<section class="next-face" data-next-face="face-1">
        <div class="next-input-row"><label><input aria-label="Morph from"></label>${operation}</div>
      </section>`);
    for (const operation of ['', 'Generate', 'Cancel', 'Retry']) {
      await t.test(`accepts input row with ${operation || 'no operation'}`, async () => {
        await render(operation ? `<button class="next-face-generate">${operation}</button>` : '');
        await assertNoCardPreparation(page, operation || 'idle');
      });
    }
    for (const name of ['Preparing file Morph from', 'Retry file preparation Morph from']) {
      await t.test(`accepts required ${name} control`, async () => {
        await render(`<button class="next-face-generate next-file-preparation"
          aria-label="${name}">${name.startsWith('Preparing') ? 'Preparing file…' : 'Retry'}</button>`);
        await assertNoCardPreparation(page, name);
      });
    }
    for (const [name, className] of [
      ['Prepare encoder', 'next-face-generate'],
      ['Preparing model', 'next-face-generate'],
      ['Prepare encoder', 'next-face-generate next-file-preparation'],
      ['Preparing model', 'next-face-generate next-file-preparation'],
      ['Preparing file Morph from', 'next-face-generate'],
      ['Retry file preparation Morph from', 'next-face-generate'],
      ['Preparing file', 'next-face-generate next-file-preparation'],
    ] as const) {
      await t.test(`rejects ${name} with classes ${className}`, async () => {
        await render(`<button class="${className}" aria-label="${name}">Retry</button>`);
        await assert.rejects(
          assertNoCardPreparation(page, name),
          /has no per-card photo encoder preparation control/,
        );
      });
    }
    await t.test(
      'rejects a visible reserved blank slot beside an allowed file control',
      async () => {
        await render(`<button class="next-face-generate next-file-preparation"
        aria-label="Preparing file Morph from" disabled>Preparing file…</button>
        <span style="display:inline-block;width:24px;height:24px"></span>`);
        await assert.rejects(
          assertNoCardPreparation(page, 'reserved slot'),
          /input row holds only the field and its operation/,
        );
      },
    );
  } finally {
    await browser.close();
  }
});
