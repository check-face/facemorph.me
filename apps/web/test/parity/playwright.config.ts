// The parity spec's runner (fm-hn9e): the verified control served at https://next.facemorph.me (global setup), in
// Chromium with the production origin mapped to it and WebGPU switched off, at desktop width with a mouse and at
// phone width with touch. One worker: the control's server has one fixed port. Traces and screenshots are kept on
// failure. Run under the machine's device lease (it synthesizes on the CPU):
//   python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 3600 -- \
//     npx --prefix apps/web playwright test -c apps/web/test/parity/playwright.config.ts
import { defineConfig } from '@playwright/test';
import { chromiumArgs } from './control-server.ts';

const launchOptions = { args: [...chromiumArgs, '--disable-features=WebGPU'] };

export default defineConfig({
  testDir: '.',
  testMatch: 'flow-matrix.spec.ts',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 15 * 60_000,
  outputDir: '../../test-results/parity',
  reporter: [['list'], ['json', { outputFile: '../../test-results/parity/report.json' }]],
  use: { ignoreHTTPSErrors: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 }, launchOptions } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions } },
  ],
});
