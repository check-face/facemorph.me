// Records the golden for the spike's sample flow (fm-hn9e) from the verified control: on a fresh visit, type a
// synthetic word into Morph to, press Generate at its visible centre, accept the download dialog the same way, and
// wait for the face on the CPU route. Run it under the machine's device lease (it synthesizes on the CPU):
//   python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 900 -- node apps/web/test/parity/record-sample.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { writeIndex } from '../goldens/index-file.ts';
import { press } from '../support/operate.ts';
import {
  chromiumArgs,
  ORIGIN,
  ORIGIN_HOST,
  PROJECT_HOSTS,
  REPO,
  startControl,
} from './control-server.ts';
import { INSTALL_HOOK } from './elmish-probe.ts';
import { Recorder } from './recorder.ts';

export const SAMPLE_ROW = 'words.generate-cpu';
const WORD = 'parity sample'; // synthetic

const control = await startControl();
const record = JSON.parse(readFileSync(`${REPO}/import/control-artifact.json`, 'utf8'));
const deployNext = record.files
  .filter((f: { path: string }) => f.path.startsWith('deploy-next/'))
  .map((f: { path: string; sha256: string }) => `${f.sha256}  ${f.path}\n`)
  .join('');
const browser = await chromium.launch({ args: [...chromiumArgs, '--disable-features=WebGPU'] });
try {
  const viewport = { width: 1280, height: 900 };
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === ORIGIN_HOST ||
      PROJECT_HOSTS.includes(url.hostname) ||
      url.protocol === 'data:'
      ? route.continue()
      : route.abort();
  });
  await context.addInitScript(INSTALL_HOOK);
  const page = await context.newPage();
  const r = new Recorder(page, SAMPLE_ROW);
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(
    'window.__elmish.commits > 0 && document.querySelectorAll(".next-face").length === 2',
    null,
    { timeout: 60_000 },
  );
  await r.record('first-visit', { kind: 'load', target: `${ORIGIN}/` });
  const tile = page.locator('.next-face').nth(1);
  const field = await press(page, tile.locator('.next-field input'));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(WORD, { delay: 20 });
  await r.record('type-word', {
    kind: 'type',
    target: 'Morph to field',
    at: { x: field.x, y: field.y },
    text: WORD,
  });
  const generate = await press(page, tile.locator('.next-face-generate'));
  await page.locator('.next-download-dialog .next-download-accept').waitFor({ timeout: 15_000 });
  await r.record('press-generate', {
    kind: 'press',
    target: 'Generate Morph to',
    at: { x: generate.x, y: generate.y },
  });
  const accept = await press(page, page.locator('.next-download-dialog .next-download-accept'));
  await r.record('accept-download', {
    kind: 'press',
    target: 'Download and continue',
    at: { x: accept.x, y: accept.y },
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.next-face')[1]?.getAttribute('data-next-state') === 'filled',
    null,
    { timeout: 600_000 },
  );
  await page.waitForFunction(
    'window.__elmish.model && window.__elmish.model.Busy === false',
    null,
    { timeout: 60_000 },
  );
  const done = await r.record('completed', {
    kind: 'wait',
    target: 'Morph to shows its generated face',
  });
  assert.match(
    JSON.stringify(done.model),
    /"Route":"cpu"/,
    'the face was generated on the CPU route',
  );
  const files = r.write();
  writeIndex('flows', {
    control: {
      label: record.label,
      commit: record.source.commit,
      release_sha256: record.release.sha256,
      deploy_next_sha256: createHash('sha256').update(deployNext).digest('hex'),
      runtime_manifest_sha256: control.manifestSha256,
    },
    recorder: {
      command:
        'python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 900 -- node apps/web/test/parity/record-sample.ts',
      browser: `chromium ${browser.version()}`,
      viewport,
      provider: 'cpu (WebGPU disabled at launch)',
      oracle:
        'journey-step snapshots: the Elmish model read through a React DevTools hook on every commit (elmish-probe.ts) plus the DOM a person sees (faces area, dialogs, toasts, notes) and the focused element',
      blind_spots: [
        'Messages are not observable (Elmish dispatch is private): a step is the model after an input, not the message sequence.',
        'Commits between steps are counted, not kept.',
        'Pixels are not compared: generated images, canvases and video are reduced to their elements; raw synthesis parity belongs to the numerics checks.',
        'Blob URLs, durations and times are normalized; their values are not compared.',
        'Photo bytes and latents never enter the goldens (files reduced to size and type, typed arrays to length).',
      ],
      privacy:
        'no photo bytes, latents or typed inputs beyond the synthetic fixture words and seeds',
    },
    rows: [
      {
        id: SAMPLE_ROW,
        freeze: 'parity',
        note: 'Golden spike sample flow: type a word, Generate, accept the download, Completed on CPU.',
        files,
      },
    ],
  });
  console.log(
    JSON.stringify({ row: SAMPLE_ROW, steps: r.steps.map((s) => [s.step, s.commits]), files }),
  );
} finally {
  await browser.close();
  await control.stop();
}
