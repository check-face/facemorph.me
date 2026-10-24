// PLAYWRIGHT_BROWSERS_PATH=~/Work/runs/pw-xb/browsers node run.mjs <port> [chromium,firefox,webkit]: drive page.html in Playwright's Chromium, Firefox and WebKit (headless), print one JSON line each.
import { chromium, firefox, webkit } from '/home/cdilga/Work/runs/pw-xb/node_modules/playwright/index.mjs';
const port = process.argv[2], only = process.argv[3] ? process.argv[3].split(',') : null; // node run.mjs <port> [engines]
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  if (only && !only.includes(name)) continue;
  let browser;
  try {
    browser = await type.launch(name === 'chromium' ? { executablePath: '/usr/bin/chromium' } : {});
    const page = await (await browser.newContext()).newPage();
    await page.goto(`http://localhost:${port}/autoresearch/candidates/opfs-shard-cache-v1/xbrowser/page.html`);
    const result = await page.evaluate(() => window.result);
    console.log(JSON.stringify({ engine: name, version: browser.version(), ...result }));
  } catch (error) { console.log(JSON.stringify({ engine: name, ok: false, error: String(error.message || error).slice(0, 300) })); }
  finally { await browser?.close(); }
}
