import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json' };

/** Real static file server over dist/ (no fakes: the built prototypes are served as-is). */
export async function serve() {
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(root, 'dist', p === '/' ? 'index.html' : p);
      if (!file.startsWith(join(root, 'dist'))) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

export const engines = { chromium, firefox, webkit };
export const PROTOS = ['hand', 'rac'];
export const VIEWPORTS = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false },
};

export async function open(browser, base, proto, width, img = 'scene-o1.jpg', extra = {}, query = '') {
  const vp = VIEWPORTS[width];
  const opts = { ...vp };
  // isMobile / hasTouch are Chromium-only context options
  if (browser.browserType().name() !== 'chromium') { delete opts.isMobile; delete opts.hasTouch; }
  const context = await browser.newContext({ ...opts, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/${proto}.html?img=${img}${query}`);
  await page.waitForFunction(() => window.__cropper);
  await page.evaluate(() => window.__cropper.whenReady());
  await page.waitForTimeout(700);
  return { context, page, errors };
}
