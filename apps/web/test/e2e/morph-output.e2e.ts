// fm-j4i8: real built-app Morph controls and output. No fabricated codec/runtime answers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { devices, type Locator, type Page } from 'playwright';
import { readIdentity } from '../../../../scripts/import/build-next.mjs';
import { startControl, chromiumArgs, ORIGIN, REPO } from '../parity/control-server.ts';
import { INSTALL_HOOK } from '../parity/elmish-probe.ts';
import { press } from '../support/operate.ts';
import { corners } from '../support/rendered-frame.ts';
import { launchFreshChromiumProfile } from '../support/browser-profile.ts';

const runtime = process.env['FACEMORPH_RUNTIME_DIR'] ?? join(REPO, '.cache/ci-runtime');
const artifactRoot = process.env['FACEMORPH_MORPH_ARTIFACT'] ?? REPO;
const out = join(REPO, 'apps/web/test-results/morph-output');
type Call = { type: string; value?: string; hashes: string[] };
type Progress = { attempt: number; value: number | null; text: string; time: number };
interface Observer {
  calls: Call[];
  endpoints: string[];
  pending: Promise<unknown>[];
  progress: Progress[];
  attempt: number;
  renderedFrames: number;
}

// Passive observation only. Copy latent bytes before a native transfer can detach them;
// original postMessage still receives its original arguments synchronously and unchanged.
function observe() {
  const w = window as unknown as { __morphProof: Observer };
  const proof: Observer = {
    calls: [],
    endpoints: [],
    pending: [],
    progress: [],
    attempt: 0,
    renderedFrames: 0,
  };
  w.__morphProof = proof;
  const hash = async (values: Float32Array) => {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  };
  const attached = new WeakSet<Worker>();
  const operations = new WeakMap<Worker, Map<number, string>>();
  const native = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (
    this: Worker,
    ...args: Parameters<Worker['postMessage']>
  ) {
    const message = args[0] as {
      id?: number;
      type?: string;
      value?: string;
      values?: Float32Array;
      frames?: Float32Array[];
    } | null;
    if (!attached.has(this)) {
      attached.add(this);
      operations.set(this, new Map());
      this.addEventListener('message', ({ data }) => {
        if (
          data.type === 'frame' &&
          data.rgba instanceof ArrayBuffer &&
          operations.get(this)?.get(data.id) === 'synthesize-frames'
        )
          proof.renderedFrames++;
        if (
          data.type === 'complete' &&
          operations.get(this)?.get(data.id) === 'generate' &&
          data.result?.values instanceof Float32Array
        )
          proof.pending.push(hash(data.result.values).then((h) => proof.endpoints.push(h)));
      });
    }
    if (
      message?.type &&
      ['qualify', 'generate', 'synthesize', 'synthesize-frames', 'encode-aligned'].includes(
        message.type,
      )
    ) {
      operations.get(this)!.set(message.id!, message.type);
      const call: Call = { type: message.type, hashes: [] };
      if (typeof message.value === 'string') call.value = message.value;
      proof.calls.push(call);
      for (const values of message.values ? [message.values] : (message.frames ?? []))
        proof.pending.push(hash(values).then((h) => call.hashes.push(h)));
    }
    return Reflect.apply(native, this, args);
  } as Worker['postMessage'];
  const sample = () => {
    if (!proof.attempt) return;
    const status = document.querySelector('.next-morph-slot .next-status');
    const bar = status?.querySelector('progress');
    if (!bar) return;
    const value = bar.hasAttribute('value') ? bar.value / bar.max : null;
    const text = status?.textContent ?? '';
    const last = proof.progress.at(-1);
    if (
      !last ||
      last.attempt !== proof.attempt ||
      last.value !== value ||
      last.text !== text ||
      performance.now() - last.time >= 200
    )
      proof.progress.push({ attempt: proof.attempt, value, text, time: performance.now() });
  };
  new MutationObserver(sample).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  setInterval(sample, 40);
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const p = (window as unknown as { __morphProof: Observer }).__morphProof;
    await Promise.all(p.pending);
    return {
      calls: p.calls,
      endpoints: p.endpoints,
      progress: p.progress,
      renderedFrames: p.renderedFrames,
    };
  });
}
async function attempt(page: Page, n: number) {
  await page.evaluate((value) => {
    (window as unknown as { __morphProof: Observer }).__morphProof.attempt = value;
  }, n);
}
function monotonic(samples: Progress[], n: number, { failedBeforeFramePlan = false } = {}) {
  const run = samples.filter((p) => p.attempt === n);
  const values = run.flatMap((p) => (p.value === null ? [] : [p.value]));
  assert.ok(run.length >= 2, `attempt ${n} has repeated real DOM progress samples`);
  if (!failedBeforeFramePlan)
    assert.ok(values.length >= 2, `attempt ${n} has measured DOM progress`);
  values.forEach((v, i) => {
    assert.ok(v >= 0 && v <= 1);
    if (i)
      assert.ok(
        v + 0.000001 >= values[i - 1]!,
        `attempt ${n}: DOM progress reset ${values[i - 1]} → ${v}`,
      );
  });
  const firstDeterminate = run.findIndex((p) => p.value !== null);
  if (firstDeterminate < 0) {
    assert.ok(
      failedBeforeFramePlan,
      'only a genuine failure before the frame plan may remain entirely indeterminate',
    );
    return;
  }
  assert.ok(
    run.slice(firstDeterminate).every((p) => p.value !== null),
    'determinate progress never resets to indeterminate',
  );
}

// Native media controls can consume a touch without dispatching an author-DOM click.
// Read their genuine visible box through CDP, then use real input and playback as
// evidence. Never call play(), dispatch an event, or alter the codec/media APIs.
async function operateNativePlayer(page: Page, video: Locator, touch: boolean) {
  const inputs: unknown[] = [];
  const input = async (name: string, point: { x: number; y: number }) => {
    const hit = await video.evaluate((element, at) => {
      const hit = document.elementFromPoint(at.x, at.y);
      return {
        inside: !!hit && (hit === element || element.contains(hit)),
        tag: hit?.tagName,
        viewport: { width: innerWidth, height: innerHeight },
      };
    }, point);
    assert.ok(
      hit.inside &&
        point.x >= 0 &&
        point.x < hit.viewport.width &&
        point.y >= 0 &&
        point.y < hit.viewport.height,
      `${name}: real visible native player position is uncovered`,
    );
    const before = await video.evaluate((element) => ({
      paused: (element as HTMLVideoElement).paused,
      time: (element as HTMLVideoElement).currentTime,
    }));
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    inputs.push({ name, kind: touch ? 'touch' : 'mouse', point, hit, before });
  };
  await video.scrollIntoViewIfNeeded();
  const box = await video.boundingBox();
  assert.ok(box);
  await input('show native controls', { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (await video.evaluate((element) => (element as HTMLVideoElement).paused)) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('DOM.enable');
      const tree = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      type NativeNode = {
        nodeName: string;
        backendNodeId: number;
        attributes?: string[];
        children?: NativeNode[];
        shadowRoots?: NativeNode[];
      };
      const flatten = (node: NativeNode): NativeNode[] => [
        node,
        ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap(flatten),
      ];
      const target = flatten(tree.root).find((node) => node.nodeName === 'VIDEO');
      assert.ok(target, 'actual native video exists in the document');
      let nativePlay: { label: string; x: number; y: number } | null = null;
      for (const node of flatten(target)) {
        const attrs = Object.fromEntries(
          Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) => [
            node.attributes![i * 2]!,
            node.attributes![i * 2 + 1]!,
          ]),
        );
        if (
          attrs['pseudo'] !== '-webkit-media-controls-play-button' ||
          attrs['aria-hidden'] === 'true'
        )
          continue;
        const model = await cdp
          .send('DOM.getBoxModel', { backendNodeId: node.backendNodeId })
          .catch(() => null);
        if (!model || model.model.width <= 0 || model.model.height <= 0) continue;
        const q = model.model.border;
        nativePlay = {
          label: attrs['aria-label'] ?? '',
          x: (q[0]! + q[2]! + q[4]! + q[6]!) / 4,
          y: (q[1]! + q[3]! + q[5]! + q[7]!) / 4,
        };
        break;
      }
      assert.ok(nativePlay, 'native play control has a real rendered box');
      if (await video.evaluate((element) => (element as HTMLVideoElement).paused)) {
        assert.match(nativePlay.label, /play/i);
        await input('native play control', nativePlay);
      }
    } finally {
      await cdp.detach();
    }
  }
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.next-video-slot video') as HTMLVideoElement | null;
      return !!v && !v.paused && v.currentTime > 0;
    },
    null,
    { timeout: 15_000 },
  );
  return {
    inputs,
    playback: await video.evaluate((element) => ({
      paused: (element as HTMLVideoElement).paused,
      currentTime: (element as HTMLVideoElement).currentTime,
    })),
  };
}

// Verifier regression only: these deliberately planted DOM defects never stand in
// for product output. Product acceptance below still uses genuine model/video results.
test(
  'rendered-corner verifier: normal document scrolling, hidden clipping and overlays',
  { timeout: 60_000 },
  async () => {
    const profile = await launchFreshChromiumProfile({
      args: chromiumArgs,
      viewport: { width: 320, height: 568 },
    });
    try {
      const page = await profile.context.newPage();
      await page.setContent(`<!doctype html><html style="overflow:auto scroll"><body style="margin:0">
      <header style="height:1000px"></header>
      <main id="wrap" style="position:relative;width:280px;margin-left:20px">
        <canvas id="frame" width="280" height="840" style="display:block;width:280px;height:840px"></canvas>
      </main><footer style="height:1000px"></footer></body></html>`);
      await page.locator('#frame').evaluate((element) => {
        const context = (element as HTMLCanvasElement).getContext('2d')!;
        context.fillStyle = '#18794e';
        context.fillRect(0, 0, 280, 840);
        context.fillStyle = '#ffb224';
        for (const [x, y] of [
          [0, 0],
          [264, 0],
          [0, 824],
          [264, 824],
        ])
          context.fillRect(x!, y!, 16, 16);
      });
      assert.equal(
        (await corners(page, page.locator('#frame'))).length,
        4,
        'all real rendered corners reachable through normal document scrolling',
      );
      for (const overflow of ['hidden', 'clip']) {
        await page.locator('#wrap').evaluate((element, value) => {
          const e = element as HTMLElement;
          e.style.height = '200px';
          e.style.overflow = value;
        }, overflow);
        await assert.rejects(
          corners(page, page.locator('#frame')),
          /full source frame stays inside clipping ancestors/,
          `${overflow} ancestor must still reject a cropped frame`,
        );
      }
      await page.locator('#wrap').evaluate((element) => {
        const wrap = element as HTMLElement;
        wrap.style.height = '';
        wrap.style.overflow = 'visible';
        const overlay = document.createElement('button');
        overlay.textContent = 'Overlay';
        overlay.style.cssText = 'position:absolute;left:0;top:0;width:24px;height:24px;z-index:1';
        wrap.append(overlay);
      });
      await assert.rejects(
        corners(page, page.locator('#frame')),
        /rendered corner 0,0 is obscured/,
        'an overlaid real corner must still reject',
      );
    } finally {
      await profile.close();
    }
  },
);

test(
  'Morph output: operated intent, cancel/failure retries, complete frames and absent-frame restore',
  { timeout: 1_200_000 },
  async (t) => {
    if (!existsSync(join(runtime, 'manifest.json'))) {
      const reason = `untested: real runtime absent at ${runtime}; owner fm-j4i8`;
      if (process.env['FACEMORPH_REQUIRE_RUNTIME'] === '1') throw Error(reason);
      t.skip(reason);
      return;
    }
    const artifact = readIdentity(artifactRoot);
    assert.deepEqual(artifact.findings, []);
    mkdirSync(out, { recursive: true });
    rmSync(join(out, 'report.json'), { force: true });
    const faultFile = join(out, 'http-fault.json');
    const worker = readdirSync(join(artifactRoot, 'deploy-next/assets')).find((name) =>
      /^video-worker-.*\.js$/.test(name),
    );
    assert.ok(worker, 'actual built video worker');
    const workerPath = '/assets/' + worker;
    rmSync(faultFile, { force: true });
    const site = await startControl({
      runtime,
      artifact: join(artifactRoot, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
      faultFile,
    });
    const evidence: unknown[] = [];
    try {
      for (const width of [1280, 390]) {
        for (const suffix of ['failure.json', 'FAILED.png'])
          rmSync(join(out, `${width}-${suffix}`), { force: true });
        const profile = await launchFreshChromiumProfile({
          args: [...chromiumArgs, '--disable-features=WebGPU'],
          ...(width === 390 ? devices['Pixel 7'] : {}),
          viewport: { width, height: 900 },
          ignoreHTTPSErrors: true,
        });
        const { context } = profile;
        await context.addInitScript(INSTALL_HOOK);
        await context.addInitScript(observe);
        const page = await context.newPage();
        const errors: string[] = [],
          models: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (
            /^\/runtime\/(assets|chunks|encoder-stream|photo)\//.test(
              new URL(request.url()).pathname,
            )
          )
            models.push(request.url());
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        const operate = async (control: Locator) =>
          assert.ok((await press(page, control, { touch: width === 390 })).inside);
        const shot = async (name: string) =>
          page.screenshot({ path: join(out, `${width}-${name}.png`), fullPage: true });
        const tiles = page.locator('section.next-face'),
          create = page.locator('.next-primary-action');
        const status = page.locator('.next-morph-slot .next-status');
        const type = async (i: number, value: string) => {
          await operate(tiles.nth(i).locator('.next-field input'));
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText(value);
        };
        const idle = () =>
          page.waitForFunction(
            () => !document.querySelector('.next-product[data-next-busy=true]'),
            null,
            { timeout: 240_000 },
          );
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        try {
          await page.goto(ORIGIN);
          await tiles.nth(1).waitFor();
          for (const control of [
            page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
            page.getByRole('button', { name: 'Ask me later' }),
          ])
            if (await control.isVisible())
              await operate(control).catch(async (error: unknown) => {
                // Optional setup toasts may expire while the real pointer is scrolling.
                if (await control.isVisible()) throw error;
              });
          // Face counts are real UI edits. No generation or hidden controller dispatch.
          await operate(tiles.nth(1).getByRole('button', { name: /^Remove / }));
          assert.equal(await tiles.count(), 1);
          assert.ok(await create.isDisabled());
          assert.match(await page.locator('.next-morph-reason').innerText(), /second face/i);
          await create.scrollIntoViewIfNeeded();
          const oneFaceBox = await create.boundingBox();
          assert.ok(oneFaceBox);
          const oneFacePoint = {
            x: oneFaceBox.x + oneFaceBox.width / 2,
            y: oneFaceBox.y + oneFaceBox.height / 2,
          };
          const oneFaceHit = await create.evaluate((element, point) => {
            const hit = document.elementFromPoint(point.x, point.y);
            return {
              related: !!hit && (hit === element || element.contains(hit) || hit.contains(element)),
              tag: hit?.tagName,
            };
          }, oneFacePoint);
          assert.ok(
            oneFaceHit.related,
            'disabled one-face action is at the visible input position',
          );
          if (width === 390) await page.touchscreen.tap(oneFacePoint.x, oneFacePoint.y);
          else await page.mouse.click(oneFacePoint.x, oneFacePoint.y);
          assert.equal(await page.locator('.next-product[data-next-busy=true]').count(), 0);
          assert.deepEqual(
            (await snapshot(page)).calls,
            [],
            'one-face negative input starts no work',
          );
          await shot('one-face');
          for (const count of [2, 3, 8]) {
            while ((await tiles.count()) < count)
              await operate(page.getByRole('button', { name: 'Add face', exact: true }));
            assert.ok(await create.isDisabled(), 'unfinished blank inputs cannot start Morph');
            for (let i = 0; i < count; i++) await type(i, `availability face ${i + 1}`);
            assert.ok(await create.isEnabled());
            await shot(`${count}-faces`);
          }
          while ((await tiles.count()) > 2)
            await operate(tiles.last().getByRole('button', { name: /^Remove / }));
          await type(0, 'hello');
          await type(1, 'hello');
          await operate(create);
          await page.waitForFunction(
            () =>
              /Faces 1 and 2 are the same/.test(
                document.querySelector('.next-morph-slot .next-status')?.textContent ?? '',
              ),
            null,
            { timeout: 30_000 },
          );
          assert.doesNotMatch(await status.innerText(), /invalid.*unsupported|Error:|Exception/);
          assert.deepEqual(models, []);
          assert.deepEqual((await snapshot(page)).calls, []);
          await shot('identical-neighbours');
          await type(0, 'morph output proof alpha');
          await type(1, 'morph output proof beta');
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          assert.ok(
            await page
              .getByLabel('Morph shape', { exact: true })
              .locator('option[value=linear]')
              .count(),
          );
          await page.getByLabel('Morph shape', { exact: true }).selectOption('linear'); // setup
          await page.getByLabel('Morph length', { exact: true }).selectOption('custom'); // setup
          await page.getByRole('textbox', { name: 'Frames per face', exact: true }).fill('8'); // setup: leave time to cancel after a real interior frame
          assert.equal(
            await page.getByRole('button', { name: /^(plain blend|50\/50 blend)$/i }).count(),
            0,
          );
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          const enabledStyle = await create.evaluate((el) => {
            const s = getComputedStyle(el);
            return { color: s.color, background: s.backgroundColor, opacity: s.opacity };
          });
          writeFileSync(faultFile, JSON.stringify({ path: workerPath, delaySeconds: 15 }));
          const workerStarted = page.waitForRequest(
            (r) => new URL(r.url()).pathname === workerPath,
            { timeout: 240_000 },
          );
          await attempt(page, 1);
          await operate(create);
          await page.waitForFunction(
            () => (document.querySelector('.next-primary-action') as HTMLButtonElement)?.disabled,
            null,
            { timeout: 10_000 },
          );
          let consents = 0;
          const approval = page.locator('.next-download-accept');
          if (
            await approval.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            )
          ) {
            await operate(approval);
            consents++;
          }
          await workerStarted;
          await tiles
            .nth(0)
            .getByRole('button', { name: 'Save image', exact: true })
            .waitFor({ timeout: 240_000 });
          await tiles
            .nth(1)
            .getByRole('button', { name: 'Save image', exact: true })
            .waitFor({ timeout: 240_000 });
          assert.ok(await create.isDisabled());
          const disabledStyle = await create.evaluate((el) => {
            const s = getComputedStyle(el);
            return { color: s.color, background: s.backgroundColor, opacity: s.opacity };
          });
          assert.notDeepEqual(
            disabledStyle,
            enabledStyle,
            'disabled Morph visibly changes colour/opacity',
          );
          const announcedReason = await create.evaluate((el) =>
            (el.getAttribute('aria-describedby') ?? '')
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' '),
          );
          assert.match(
            announcedReason,
            /morph|working|progress|cancel|wait|running/i,
            'disabled reason is associated for announcement',
          );
          const active = await page.evaluate(() => {
            const s = (
              window as unknown as {
                __elmish: {
                  model: { JobId: number; PendingJobs: unknown[]; PendingMorph: boolean };
                };
              }
            ).__elmish.model;
            return { id: s.JobId, pending: s.PendingJobs.length, morph: s.PendingMorph };
          });
          // Negative input targets the actual disabled position; it cannot emit the operated
          // helper's positive click event because disabled buttons suppress it natively.
          await create.scrollIntoViewIfNeeded();
          const b = await create.boundingBox();
          assert.ok(b);
          for (let i = 0; i < 3; i++) {
            if (width === 390) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
            else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
          }
          assert.deepEqual(
            await page.evaluate(() => {
              const s = (
                window as unknown as {
                  __elmish: {
                    model: { JobId: number; PendingJobs: unknown[]; PendingMorph: boolean };
                  };
                }
              ).__elmish.model;
              return { id: s.JobId, pending: s.PendingJobs.length, morph: s.PendingMorph };
            }),
            active,
            'disabled repeated clicks queue no duplicate intent',
          );
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          for (const label of ['Morph shape', 'Morph length', 'Video size'])
            assert.ok(await page.getByLabel(label, { exact: true }).isDisabled());
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          const cancel = status.getByRole('button', { name: 'Cancel', exact: true });
          const cancelGeometry = await cancel.evaluate((el) => {
            const row = el.closest('.next-progress-row');
            const bar = row?.querySelector('.next-progress');
            const c = el.getBoundingClientRect(),
              p = bar?.getBoundingClientRect();
            return {
              sameRow: !!row,
              right:
                !!p &&
                c.left >= p.right - 1 &&
                Math.abs((c.top + c.bottom) / 2 - (p.top + p.bottom) / 2) < c.height,
            };
          });
          assert.deepEqual(cancelGeometry, { sameRow: true, right: true });
          const completed = await tiles.evaluateAll((elements) =>
            elements.map((e) => ({
              id: e.getAttribute('data-next-face'),
              state: e.getAttribute('data-next-state'),
            })),
          );
          await page.waitForFunction(
            () => (window as unknown as { __morphProof: Observer }).__morphProof.renderedFrames > 0,
            null,
            { timeout: 240_000 },
          );
          await shot('active-disabled-cancel');
          await operate(cancel);
          await idle();
          assert.equal(
            await page.locator('.next-video-slot video').count(),
            0,
            'cancelled partial morph is never complete',
          );
          assert.deepEqual(
            await tiles.evaluateAll((elements) =>
              elements.map((e) => ({
                id: e.getAttribute('data-next-face'),
                state: e.getAttribute('data-next-state'),
              })),
            ),
            completed,
          );
          await shot('cancelled-retry');
          const beforeRetry = await snapshot(page),
            callOffset = beforeRetry.calls.length;
          assert.equal(
            beforeRetry.calls.filter((c) => c.type === 'generate').length,
            2,
            'one intent generated both typed faces',
          );
          assert.equal(
            new Set(beforeRetry.endpoints).size,
            2,
            'actual completed endpoint latents observed',
          );
          assert.ok(
            beforeRetry.renderedFrames > 0,
            'one accepted intent generated both typed faces and actual morph frames',
          );
          writeFileSync(
            faultFile,
            JSON.stringify({ path: workerPath, delaySeconds: 2, status: 503 }),
          );
          const failed = page.waitForResponse(
            (r) => new URL(r.url()).pathname === workerPath && r.status() === 503,
          );
          await attempt(page, 2);
          await operate(status.getByRole('button', { name: 'Retry', exact: true }));
          await failed;
          await idle();
          await status.getByRole('button', { name: 'Retry', exact: true }).waitFor();
          assert.doesNotMatch(await status.innerText(), /Error:|Exception|at \w+\s*\(/);
          assert.deepEqual(
            await tiles.evaluateAll((elements) =>
              elements.map((e) => ({
                id: e.getAttribute('data-next-face'),
                state: e.getAttribute('data-next-state'),
              })),
            ),
            completed,
          );
          await shot('http-failure-retry');
          rmSync(faultFile, { force: true });
          await attempt(page, 3);
          await operate(status.getByRole('button', { name: 'Retry', exact: true }));
          const video = page.locator('.next-video-slot video');
          await video.waitFor({ timeout: 240_000 });
          await idle();
          await page.waitForFunction(
            () => {
              const v = document.querySelector('.next-video-slot video') as HTMLVideoElement;
              return v?.readyState >= 2 && v.videoWidth > 0;
            },
            null,
            { timeout: 60_000 },
          );
          assert.ok(
            await video.evaluate((el) => {
              const v = el as HTMLVideoElement;
              return !v.autoplay && v.paused && v.currentTime === 0 && v.controls;
            }),
          );
          await page.locator('[data-next-video-width="512"]').waitFor();
          const proof = await snapshot(page),
            retries = proof.calls.slice(callOffset);
          assert.equal(
            retries.filter((c) => ['generate', 'encode-aligned'].includes(c.type)).length,
            0,
            'retries generate no completed face',
          );
          assert.ok(
            retries.some((c) => c.type === 'synthesize-frames' || c.type === 'synthesize'),
            'real morph frame inference happened',
          );
          for (const call of retries)
            for (const h of call.hashes)
              assert.ok(
                !proof.endpoints.includes(h),
                'completed endpoints are reused without synthesizing them',
              );
          assert.ok(consents <= 1);
          assert.equal(await approval.count(), 0);
          for (const n of [1, 2, 3])
            monotonic(proof.progress, n, { failedBeforeFramePlan: n === 2 });
          await shot('complete');
          const layout: unknown[] = [];
          for (const viewport of [
            { width: 320, height: 900 },
            { width: 390, height: 900 },
            { width: 1024, height: 900 },
            { width: 1920, height: 900 },
            { width: 390, height: 568 },
          ]) {
            await page.setViewportSize(viewport);
            for (const media of [
              tiles.nth(0).locator('.next-face-img'),
              tiles.nth(1).locator('.next-face-img'),
              video,
            ])
              layout.push({
                viewport,
                media: await media.getAttribute('class'),
                corners: await corners(page, media),
              });
            await shot(`full-frame-${viewport.width}x${viewport.height}`);
            assert.ok(
              (
                await press(page, page.getByRole('button', { name: 'More options', exact: true }), {
                  touch: width === 390,
                })
              ).inside,
              'actions remain reachable with normal scrolling',
            );
            await operate(page.getByRole('button', { name: 'More options', exact: true }));
          }
          await page.setViewportSize({ width, height: 900 });
          // The original two-face observations above are frozen before these independent
          // count cases. Operate the accepted action and wait for a different, decoded
          // video; an old visible result or an enabled button is not a count-case pass.
          let previousVideo = await video.getAttribute('src');
          assert.ok(previousVideo, 'snapshot actual prior output before settings invalidate it');
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          await page.getByLabel('Morph shape', { exact: true }).selectOption('linear'); // setup
          await page.getByLabel('Morph length', { exact: true }).selectOption('custom'); // setup
          await page.getByRole('textbox', { name: 'Frames per face', exact: true }).fill('2'); // shortest real morph
          await operate(page.getByRole('button', { name: 'More options', exact: true }));
          const countEvidence: unknown[] = [];
          for (const count of [3, 8]) {
            const previousCount = await tiles.count();
            const before = await snapshot(page);
            while ((await tiles.count()) < count) {
              await operate(page.getByRole('button', { name: 'Add face', exact: true }));
              await type(
                (await tiles.count()) - 1,
                `operated count proof face ${await tiles.count()}`,
              );
            }
            const attemptNumber = count === 3 ? 4 : 5;
            await attempt(page, attemptNumber);
            await operate(create);
            await page.waitForFunction(
              () => !!document.querySelector('.next-product[data-next-busy=true]'),
              null,
              { timeout: 30_000 },
            );
            assert.ok(await create.isDisabled(), `${count}-face intent is accepted once`);
            await shot(`operated-${count}-faces-active`);
            await page.waitForFunction(
              (previous) => {
                const v = document.querySelector(
                  '.next-video-slot video',
                ) as HTMLVideoElement | null;
                return (
                  !!v && v.getAttribute('src') !== previous && v.readyState >= 2 && v.videoWidth > 0
                );
              },
              previousVideo,
              { timeout: 240_000 },
            );
            await idle();
            assert.equal(await tiles.count(), count);
            assert.equal(
              await tiles.getByRole('button', { name: 'Save image', exact: true }).count(),
              count,
              'every selected face has a completed result',
            );
            assert.ok(
              await video.evaluate((element) => {
                const v = element as HTMLVideoElement;
                return (
                  v.controls &&
                  !v.autoplay &&
                  v.paused &&
                  v.duration > 0 &&
                  v.videoWidth === 512 &&
                  v.videoHeight === 512
                );
              }),
            );
            const after = await snapshot(page),
              calls = after.calls.slice(before.calls.length);
            assert.equal(
              calls.filter((call) => call.type === 'generate').length,
              count - previousCount,
              'only newly added unfinished faces generate',
            );
            assert.ok(
              calls.some((call) => ['synthesize', 'synthesize-frames'].includes(call.type)),
              'accepted count case performs real morph inference',
            );
            assert.ok(
              after.renderedFrames > before.renderedFrames,
              'accepted count case produces actual synthesized frames',
            );
            for (const call of calls)
              for (const hash of call.hashes)
                assert.ok(
                  !before.endpoints.includes(hash),
                  'existing completed faces remain reusable in count case',
                );
            monotonic(after.progress, attemptNumber);
            await shot(`operated-${count}-faces-complete`);
            previousVideo = await video.getAttribute('src');
            countEvidence.push({
              count,
              attempt: attemptNumber,
              progress: after.progress.filter((sample) => sample.attempt === attemptNumber),
              newFaceGenerations: count - previousCount,
              calls,
              renderedFrames: after.renderedFrames - before.renderedFrames,
              video: await video.evaluate((element) => {
                const v = element as HTMLVideoElement;
                return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
              }),
            });
          }
          await operate(page.getByRole('checkbox', { name: 'Use Slider', exact: true }));
          await page.locator('.next-slider canvas').waitFor();
          assert.equal(
            await page.evaluate(
              () => JSON.parse(localStorage.getItem('facemorph-slider-v1') ?? '{}').enabled,
            ),
            true,
            'operated slider preference is actually retained',
          );
          const retainedIds = await tiles.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-next-face')),
          );
          const retainedVideoSha256 = await page.evaluate(
            async (url) =>
              Array.from(
                new Uint8Array(
                  await crypto.subtle.digest('SHA-256', await (await fetch(url!)).arrayBuffer()),
                ),
                (byte) => byte.toString(16).padStart(2, '0'),
              ).join(''),
            previousVideo,
          );
          // Wait for the actual, integrity-checked session video. Then remove only optional
          // scrub data, with the application unloaded so retention cannot repopulate it.
          await page.waitForFunction(
            async ({ ids, videoSha256 }) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const r = indexedDB.open('checkface-originals-v1');
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              try {
                return await new Promise<boolean>((resolve, reject) => {
                  const r = db
                    .transaction('originals')
                    .objectStore('originals')
                    .get('last-generated-session-v2');
                  r.onsuccess = () =>
                    resolve(
                      r.result?.video instanceof Blob &&
                        r.result.video.size > 0 &&
                        r.result.videoSha256 === videoSha256 &&
                        JSON.stringify(r.result.ids) === JSON.stringify(ids),
                    );
                  r.onerror = () => reject(r.error);
                });
              } finally {
                db.close();
              }
            },
            { ids: retainedIds, videoSha256: retainedVideoSha256 },
            { timeout: 60_000 },
          );
          const beforeRestore = models.length;
          await page.goto(ORIGIN + '/runtime/manifest.json');
          const evicted = await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const r = indexedDB.open('checkface-originals-v1');
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            const info = await new Promise<{ videoBytes: number; frames: number }>(
              (resolve, reject) => {
                const tx = db.transaction('originals', 'readwrite'),
                  store = tx.objectStore('originals'),
                  r = store.get('last-generated-session-v2');
                let info: { videoBytes: number; frames: number };
                r.onsuccess = () => {
                  const session = r.result;
                  if (!(session?.video instanceof Blob)) {
                    tx.abort();
                    return;
                  }
                  info = { videoBytes: session.video.size, frames: session.frames.length };
                  store.put(
                    { ...session, frames: [], frameHashes: [] },
                    'last-generated-session-v2',
                  );
                };
                tx.oncomplete = () => resolve(info);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(Error('No actual retained video to restore'));
              },
            );
            db.close();
            await new Promise<void>((resolve, reject) => {
              const r = indexedDB.deleteDatabase('checkface-morph-frames-v1');
              r.onsuccess = () => resolve();
              r.onerror = () => reject(r.error);
              r.onblocked = () => reject(Error('Frame store remains held open'));
            });
            return info;
          });
          assert.ok(evicted.videoBytes > 0);
          await page.goto(ORIGIN);
          await video.waitFor({ timeout: 60_000 });
          await page.locator('.next-slider-empty').waitFor();
          await page.waitForFunction(
            () => {
              const v = document.querySelector('.next-video-slot video') as HTMLVideoElement | null;
              return !!v && v.readyState >= 2 && v.videoWidth === 512 && v.videoHeight === 512;
            },
            null,
            { timeout: 60_000 },
          );
          assert.deepEqual(
            await tiles.evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('data-next-face')),
            ),
            retainedIds,
            'the exact completed face set restores',
          );
          assert.equal(
            await video.evaluate(async (element) =>
              Array.from(
                new Uint8Array(
                  await crypto.subtle.digest(
                    'SHA-256',
                    await (await fetch((element as HTMLVideoElement).src)).arrayBuffer(),
                  ),
                ),
                (byte) => byte.toString(16).padStart(2, '0'),
              ).join(''),
            ),
            retainedVideoSha256,
            'the exact last video restores after optional frame eviction',
          );
          assert.ok(
            await page.getByRole('checkbox', { name: 'Use Slider', exact: true }).isDisabled(),
          );
          assert.equal(await page.locator('.next-slider canvas').count(), 0);
          const restoredPlayback = await operateNativePlayer(page, video, width === 390);
          assert.equal(
            models.length,
            beforeRestore,
            'absent-frame restore makes zero model requests',
          );
          assert.deepEqual(
            (await snapshot(page)).calls,
            [],
            'absent-frame restore dispatches zero inference',
          );
          await shot('absent-frames-player');
          assert.deepEqual(errors, []);
          evidence.push({
            width,
            consents,
            enabledStyle,
            disabledStyle,
            announcedReason,
            completed,
            progress: proof.progress,
            httpFailureProgress: {
              kind: 'failed-before-frame-plan',
              samples: proof.progress.filter((sample) => sample.attempt === 2).length,
              determinateSamples: proof.progress.filter(
                (sample) => sample.attempt === 2 && sample.value !== null,
              ).length,
            },
            calls: proof.calls,
            countCases: countEvidence,
            layout,
            evicted,
            retainedIds,
            retainedVideoSha256,
            restoredPlayback,
          });
        } catch (error) {
          await page
            .screenshot({ path: join(out, `${width}-FAILED.png`), fullPage: true, timeout: 5000 })
            .catch(() => {});
          writeFileSync(
            join(out, `${width}-failure.json`),
            JSON.stringify(
              {
                artifact: artifact.identity.deploySource,
                error: String(error),
                status: await status.innerText({ timeout: 2000 }).catch(() => ''),
                observer: await Promise.race([
                  snapshot(page).catch(() => null),
                  new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
                ]),
                errors,
                models,
              },
              null,
              2,
            ) + '\n',
          );
          throw error;
        } finally {
          rmSync(faultFile, { force: true });
          await context.tracing.stop({ path: join(out, `${width}-trace.zip`) });
          await profile.close();
        }
      }
      writeFileSync(
        join(out, 'report.json'),
        JSON.stringify({ artifact: artifact.identity.deploySource, cases: evidence }, null, 2) +
          '\n',
      );
    } finally {
      await site.stop();
      rmSync(faultFile, { force: true });
    }
  },
);

test(
  'open-source Chromium: genuine unavailable H264 probe and qualified fallback disclosure',
  { timeout: 300_000 },
  async (t) => {
    const executablePath = process.env['FACEMORPH_MORPH_CHROMIUM'] ?? '/usr/bin/chromium';
    if (!existsSync(executablePath) || !existsSync(join(runtime, 'manifest.json'))) {
      t.skip(`untested: actual Chromium/runtime unavailable (${executablePath}, ${runtime})`);
      return;
    }
    const version = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim();
    assert.match(version, /Chromium/);
    const artifact = readIdentity(artifactRoot);
    assert.deepEqual(artifact.findings, []);
    mkdirSync(out, { recursive: true });
    const site = await startControl({
      runtime,
      artifact: join(artifactRoot, 'deploy-next'),
      source: artifact.identity.deploySource.buildId,
    });
    const profile = await launchFreshChromiumProfile({
      executablePath,
      args: [...chromiumArgs, '--disable-features=WebGPU'],
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });
    try {
      const { context } = profile;
      await context.addInitScript(observe);
      const page = await context.newPage();
      await page.goto(ORIGIN);
      const probe = await page.evaluate(async () => {
        const encoder = (
          globalThis as unknown as {
            VideoEncoder?: {
              isConfigSupported: (config: object) => Promise<{ supported?: boolean }>;
            };
          }
        ).VideoEncoder;
        const results = [];
        for (const codec of ['avc1.64002A', 'avc1.42002A']) {
          try {
            results.push({
              codec,
              supported: !!(
                await encoder?.isConfigSupported({
                  codec,
                  width: 512,
                  height: 512,
                  framerate: 16,
                  bitrate: 4_000_000,
                  latencyMode: 'realtime',
                  avc: { format: 'avc' },
                })
              )?.supported,
            });
          } catch (error) {
            results.push({ codec, supported: false, error: String(error) });
          }
        }
        return {
          encode: results,
          nativeH264Playback: document
            .createElement('video')
            .canPlayType('video/mp4; codecs="avc1.42002A"'),
        };
      });
      writeFileSync(
        join(out, 'real-codec-probe.json'),
        JSON.stringify({ version, executablePath, probe }, null, 2) + '\n',
      );
      if (probe.encode.some((p) => p.supported)) {
        t.skip(
          `untested unsupported-codec cell: actual ${version} offers H264 encoding; measured probe saved, no API override`,
        );
        return;
      }
      const operate = async (control: Locator) => assert.ok((await press(page, control)).inside);
      for (const control of [
        page.locator('.next-model-toast').getByRole('button', { name: 'Not now' }),
        page.getByRole('button', { name: 'Ask me later' }),
      ])
        if (await control.isVisible())
          await operate(control).catch(async (error: unknown) => {
            if (await control.isVisible()) throw error;
          });
      await page.locator('section.next-face').nth(1).waitFor();
      for (const [i, word] of ['codec proof alpha', 'codec proof beta'].entries())
        await page.locator('section.next-face').nth(i).locator('.next-field input').fill(word);
      await operate(page.getByRole('button', { name: 'More options', exact: true }));
      await page.getByLabel('Morph length', { exact: true }).selectOption('custom');
      await page.getByRole('textbox', { name: 'Frames per face', exact: true }).fill('2');
      const plannedSummary = await page.locator('#next-custom-frames-note').innerText();
      const plannedFrames = Number(
        plannedSummary.match(/^([\d,]+) frames total/)?.[1]?.replaceAll(',', ''),
      );
      assert.ok(
        Number.isSafeInteger(plannedFrames) && plannedFrames > 0,
        'actual DOM plan names the complete frame count',
      );
      await operate(page.getByRole('button', { name: 'More options', exact: true }));
      await operate(page.locator('.next-primary-action'));
      const approval = page.locator('.next-download-accept');
      if (
        await approval.waitFor({ timeout: 8000 }).then(
          () => true,
          () => false,
        )
      )
        await operate(approval);
      await page.waitForFunction(
        () =>
          /512\s*[×x]\s*512/.test(
            document.querySelector('.next-morph-slot .next-status')?.textContent ?? '',
          ),
        null,
        { timeout: 30_000 },
      );
      assert.equal(
        await page.locator('.next-video-slot video').count(),
        0,
        'fallback disclosure precedes finished Morph',
      );
      assert.equal(
        (await snapshot(page)).calls.filter((call) =>
          ['synthesize', 'synthesize-frames'].includes(call.type),
        ).length,
        0,
        'known fallback disclosure appears before morph frame inference',
      );
      await page.screenshot({ path: join(out, 'chromium-codec-before-morph.png'), fullPage: true });
      await page.locator('.next-video-slot video').waitFor({ timeout: 240_000 });
      const save = page.getByRole('button', { name: 'Save video', exact: true });
      await save.waitFor({ timeout: 60_000 });
      await page.waitForFunction(
        (element) => !(element as HTMLButtonElement).disabled,
        await save.elementHandle(),
        { timeout: 60_000 },
      );
      assert.match(
        await page
          .locator('.next-video-slot .next-video-disclosure:has(+ .next-actions)')
          .innerText(),
        /512\s*[×x]\s*512/,
        'qualified fallback size is disclosed beside the result actions',
      );
      const waiting = page.waitForEvent('download');
      await operate(save);
      const download = await waiting;
      assert.match(download.suggestedFilename(), /\.mp4$/);
      const file = join(out, 'chromium-codec-fallback.mp4');
      await download.saveAs(file);
      const inspected = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height,codec_name,nb_frames,duration',
            '-of',
            'json',
            file,
          ],
          { encoding: 'utf8', timeout: 30_000 },
        ),
      ) as {
        streams: {
          width: number;
          height: number;
          codec_name: string;
          nb_frames: string;
          duration: string;
        }[];
      };
      const stream = inspected.streams[0];
      assert.ok(stream);
      assert.equal(stream.width, 512);
      assert.equal(stream.height, 512);
      assert.equal(stream.codec_name, 'h264');
      assert.equal(
        Number(stream.nb_frames),
        plannedFrames,
        'fallback preserves the complete planned animation',
      );
      assert.ok(Number(stream.duration) > 0);
      execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 30_000 });
      writeFileSync(
        join(out, 'codec-fallback-report.json'),
        JSON.stringify(
          {
            artifact: artifact.identity.deploySource,
            version,
            executablePath,
            probe,
            plannedSummary,
            plannedFrames,
            filename: download.suggestedFilename(),
            inspected,
            downloadedFileFullyDecodedByFfmpeg: true,
            browserPlayback: probe.nativeH264Playback
              ? 'not measured in this codec case'
              : 'untested: this actual Chromium lacks native H264 decoding',
          },
          null,
          2,
        ) + '\n',
      );
      await page.screenshot({
        path: join(out, 'chromium-codec-fallback-result.png'),
        fullPage: true,
      });
    } finally {
      await profile.close();
      await site.stop();
    }
  },
);

test(
  'native-player operator verifier: actual saved H264, mouse and touch playback',
  { timeout: 60_000 },
  async () => {
    const file =
      process.env['FACEMORPH_MORPH_NATIVE_PROBE'] ??
      join(REPO, 'apps/web/test/fixtures/morph/morph.mp4');
    assert.ok(existsSync(file), `actual native-player verifier input exists: ${file}`);
    const bytes = [...readFileSync(file)],
      evidence: unknown[] = [];
    for (const width of [1280, 390]) {
      const profile = await launchFreshChromiumProfile({
        ...(width === 390 ? devices['Pixel 7'] : {}),
        viewport: { width, height: 900 },
      });
      try {
        const page = await profile.context.newPage();
        await page.setContent(
          '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div style="height:1000px"></div><div class="next-video-slot"><video controls loop playsinline style="width:332px;height:332px;max-width:100%"></video></div><div style="height:1000px"></div>',
        );
        await page.evaluate((saved) => {
          document.querySelector('video')!.src = URL.createObjectURL(
            new Blob([new Uint8Array(saved)], { type: 'video/mp4' }),
          );
        }, bytes);
        await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
        evidence.push({
          width,
          operation: await operateNativePlayer(page, page.locator('video'), width === 390),
        });
      } finally {
        await profile.close();
      }
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, 'native-player-verifier.json'),
      JSON.stringify({ actualSavedFile: file, cases: evidence }, null, 2) + '\n',
    );
  },
);
