import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContextOptions } from 'playwright';

const engines = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))(
  'playwright',
) as typeof import('playwright');

/** One real engine per process so existing cases retain their isolation and network records. */
export async function componentBrowser() {
  const engine = process.env['FACEMORPH_MANAGER_ENGINE'] ?? 'chromium';
  if (engine !== 'chromium' && engine !== 'firefox' && engine !== 'webkit')
    throw new Error(`Unknown manager browser: ${engine}`);
  try {
    const browser = await engines[engine].launch(
      engine === 'chromium' && process.env['CHROMIUM_PATH']
        ? { executablePath: process.env['CHROMIUM_PATH'] }
        : {},
    );
    console.info(`# manager browser ${engine} ${browser.version()}`);
    return {
      engine,
      browser,
      unavailable: false as const,
      async newContext(options: BrowserContextOptions = {}) {
        if (engine !== 'webkit') return browser.newContext(options);
        // WebKit denies OPFS in ephemeral sessions. This cell exercises durable storage,
        // so give each session a real, isolated profile and delete only that profile on close.
        const profile = mkdtempSync(join(tmpdir(), 'manager-webkit-'));
        try {
          const context = await engines.webkit.launchPersistentContext(profile, options);
          context.once('close', () => rmSync(profile, { recursive: true, force: true }));
          return context;
        } catch (error) {
          rmSync(profile, { recursive: true, force: true });
          throw error;
        }
      },
    };
  } catch (error) {
    const unavailable = `untested: ${engine} cannot start: ${String(error)}`;
    if (process.env['FACEMORPH_REQUIRE_MANAGER_BROWSER'] === '1') throw new Error(unavailable);
    return { engine, browser: null, unavailable };
  }
}
