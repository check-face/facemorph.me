import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const script = readFileSync(
  new URL('../../scripts/check-next-artifact.sh', import.meta.url),
  'utf8',
);
const probe = script.match(/CANVAS_PROBE = """([\s\S]*?)"""/)![1]!;

test('compiled canvas checks the full source frame with controls, clipping and actual corner hits', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const run = async (css: string) => {
      await page.setContent(`<style>
        .next-face-image { position:relative; width:416px; padding-top:48px }
        canvas { display:block; width:100%; height:auto; aspect-ratio:1 }
        .next-face-close { position:absolute; top:2px; right:2px; width:44px; height:44px }
        ${css}</style><div class="clip"><div class="next-face-image">
        <img alt="original"><button class="next-face-close">Remove</button></div></div>`);
      const result = (await page.evaluate(probe)) as { fitsTile: boolean; corners: boolean[] };
      assert.equal(await page.locator('.next-face-image > img').count(), 1, 'source restored');
      assert.equal(await page.locator('canvas').count(), 0, 'probe cleaned up');
      return result;
    };
    assert.equal((await run('')).fitsTile, true, 'full source below Remove band');
    assert.equal(
      (await run('.next-face-image{padding-top:0}.next-face-close{display:none}')).fitsTile,
      true,
      'classic square',
    );
    for (const css of [
      'canvas{width:200px}',
      'canvas{height:200px}',
      '.clip{height:200px;overflow:hidden}',
      '.next-face-close{top:60px}',
      '.next-face-image::after{content:"";position:absolute;inset:48px 0 0;background:red}',
    ])
      assert.equal((await run(css)).fitsTile, false, css);
  } finally {
    await browser.close();
  }
});
