// fm-fy2.17.1: a face card offers no per-card photo encoder preparation. Early preparation belongs beside the top
// Auto/CPU/WebGPU selector (fm-9kr8 / fm-5kpx), so in every model-cache state (cold, partial, verified, photo
// refused) no card holds a "Prepare encoder" control, and its input row holds only the field and, when an
// operation applies, its Generate/Cancel/Retry control: no reserved blank slot. fm-qh1s additionally requires
// Preparing file / file-preparation Retry in that operation slot; those prepare export bytes, not the encoder.
import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function assertNoCardPreparation(page: Page, where: string): Promise<void> {
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('section.next-face')].map((card) => {
      const preparing = [
        ...card.querySelectorAll('button, a, [role="button"], [role="menuitem"]'),
      ].flatMap((e) => {
        const name = (e.getAttribute('aria-label') || e.textContent || '').trim();
        const filePreparation =
          e.classList.contains('next-file-preparation') &&
          /^(?:Preparing file|Retry file preparation) .+$/.test(name);
        return /prepar/i.test(name) && !filePreparation ? [name] : [];
      });
      const row = card.querySelector('.next-input-row');
      const stray = row
        ? [...row.children]
            .filter((child) => {
              if (child.classList.contains('next-face-generate')) return false;
              if (child.querySelector('input, textarea')) return false;
              const box = child.getBoundingClientRect();
              return box.width > 0 && box.height > 0;
            })
            .map((child) => child.outerHTML.slice(0, 120))
        : ['no .next-input-row'];
      return { face: card.getAttribute('data-next-face'), preparing, stray };
    }),
  );
  assert.ok(cards.length > 0, `${where}: face cards are rendered`);
  for (const c of cards) {
    assert.deepEqual(
      c.preparing,
      [],
      `${where}: ${c.face} has no per-card photo encoder preparation control`,
    );
    assert.deepEqual(
      c.stray,
      [],
      `${where}: ${c.face}'s input row holds only the field and its operation`,
    );
  }
}
