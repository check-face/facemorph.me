// Real model journeys need normal browser storage. Chromium's private-context cache is a random fraction of
// RAM, which can be smaller than the 1.3 GB encoder on portable runners even when storage.estimate reports more.
// A new persistent profile gives each journey cold storage without changing the browser's quota or the tests.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

export async function launchFreshChromiumProfile(
  options: Parameters<typeof chromium.launchPersistentContext>[1] = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'facemorph-browser-profile-'));
  try {
    const context = await chromium.launchPersistentContext(directory, options);
    return {
      context,
      directory,
      async close() {
        try {
          await context.close();
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export type FreshChromiumProfile = Awaited<ReturnType<typeof launchFreshChromiumProfile>>;
