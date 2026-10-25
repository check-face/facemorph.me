// Real browsers, real WASM/WebGPU, elapsed wall time and real Web Locks. No model/runtime fixture.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import { serve } from '../support/serve.ts';
import type { checkDevice } from '../../src/preflight/checker.ts';
import type { createGpuSample, admitsGpuSample } from '../../src/preflight/gpu-sample.ts';
import type { CheckResult, GpuAdapter, GpuDevice, Scratch } from '../../src/preflight/types.ts';

interface Surface {
  checkDevice: typeof checkDevice;
  createGpuSample: typeof createGpuSample;
  admitsGpuSample: typeof admitsGpuSample;
  Scratch: typeof Scratch;
}
declare global {
  interface Window {
    preflight: Surface;
    preflightPending: Promise<CheckResult>;
  }
}
const out = new URL('../../test-results/preflight/', import.meta.url).pathname;
const evidence: unknown[] = [];
function clean(result: CheckResult) {
  assert.equal(result.resourcesRemaining, 0);
  assert.ok(result.scratchPeakBytes <= 16 * 1024 * 1024);
  assert.equal(result.estimate.kind, 'no-reliable-estimate');
  assert.ok(
    result.routes.every(
      (route) =>
        route.eligibility === 'not-eligible' ||
        route.eligibility === 'eligible-model-check-pending',
    ),
  );
  evidence.push(result);
}
async function surface(page: Page, origin: string) {
  await page.goto(`${origin}/preflight-check.html`);
  await page.waitForFunction(() => !!window.preflight);
}

async function visibilityBrowser() {
  // Playwright normally enables focus emulation, which keeps every tab "visible".
  // A plain Chrome process + documented noDefaults CDP attachment retains real visibility.
  const directory = mkdtempSync(join(tmpdir(), 'preflight-browser-'));
  const child = spawn(
    chromium.executablePath(),
    [
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--remote-debugging-port=0',
      `--user-data-dir=${directory}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Chrome CDP startup deadline')), 10_000);
      let output = '';
      child.stderr.on('data', (bytes: Buffer) => {
        output += bytes.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]!);
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Chrome exited before attachment'));
      });
    });
    const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    if (!context) throw Error('Chrome default context missing');
    return {
      browser,
      context,
      async close() {
        await browser.close();
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once('exit', () => resolve());
        });
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test(
  'model-free browser checker: real null adapter, bounds, reuse, cancellation, background and five-second deadline',
  { timeout: 40_000 },
  async (t) => {
    const site = await serve(
      process.env['FACEMORPH_PREFLIGHT_SITE'] ?? new URL('../../dist', import.meta.url).pathname,
    );
    const plain = await visibilityBrowser();
    const context = plain.context;
    const requests: string[] = [];
    await context.route('**/*', (route) => {
      requests.push(route.request().url());
      return route.continue();
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    // Other desktop workers may change window focus during the unrelated timing cases.
    // Disable this protection explicitly for the real visibilitychange case below.
    const focus = await context.newCDPSession(page);
    await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    mkdirSync(out, { recursive: true });
    t.after(async () => {
      if (t.error) await page.screenshot({ path: join(out, 'cpu-failure.png') }).catch(() => {});
      await context.tracing.stop({ path: join(out, 'cpu-trace.zip') });
      writeFileSync(join(out, 'cpu.json'), JSON.stringify({ evidence, requests }, null, 2));
      await plain.close();
      await site.close();
    });
    await surface(page, site.origin);
    const result = await page.evaluate(() => window.preflight.checkDevice({ rerun: true }));
    clean(result);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.evidence.cpuSample.state, 'known');
    assert.equal(
      result.evidence.webgpuAdapter.state,
      'failed',
      'launch flags produce a real null adapter',
    );
    assert.equal(result.evidence.gpuSample.state, 'failed');
    assert.ok(result.samplingMs >= 1800 && result.samplingMs < 2400, JSON.stringify(result));
    assert.ok(result.elapsedMs < 5000);
    assert.equal(result.evidence.deviceMemoryGiB.state, 'unknown');
    const reused = await page.evaluate(() => window.preflight.checkDevice());
    clean(reused);
    assert.equal(reused.reused, true);
    const skip = await page.evaluate(() => window.preflight.checkDevice({ skip: true }));
    clean(skip);
    assert.equal(skip.outcome, 'skip');
    assert.equal(skip.scratchPeakBytes, 0);
    const cancelled = await page.evaluate(async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      return window.preflight.checkDevice({ rerun: true, signal: controller.signal });
    });
    clean(cancelled);
    assert.equal(cancelled.outcome, 'skip');
    assert.ok(cancelled.elapsedMs < 1000);
    // Wait on an actual occupied Web Lock as the app-idle boundary: the real UI timer must win.
    const timeout = await page.evaluate(async () => {
      let unlock!: () => void, acquired!: () => void;
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const holder = navigator.locks.request('preflight-idle-test', async () => {
        acquired();
        await new Promise<void>((resolve) => {
          unlock = resolve;
        });
      });
      await ready;
      const idle = navigator.locks.request('preflight-idle-test', () => {});
      const result = await window.preflight.checkDevice({ rerun: true, idle });
      unlock();
      await Promise.all([holder, idle]);
      return result;
    });
    clean(timeout);
    assert.equal(timeout.outcome, 'timeout');
    assert.ok(timeout.elapsedMs >= 4900 && timeout.elapsedMs < 5700, JSON.stringify(timeout));
    assert.equal(timeout.scratchPeakBytes, 0);
    // A second actual foreground tab produces visibilitychange (no document property override).
    await focus.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible');
    await page.evaluate(() => {
      window.preflightPending = window.preflight.checkDevice({ rerun: true });
    });
    await page.waitForTimeout(100);
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    const hidden = await page.evaluate(() => document.visibilityState);
    assert.equal(hidden, 'hidden', 'actual browser backgrounding');
    const background = await page.evaluate(() => window.preflightPending);
    clean(background);
    assert.equal(background.outcome, 'skip');
    assert.ok(background.elapsedMs < 1500);
    assert.ok(requests.length >= 2, 'document, checker and worker really requested');
    assert.ok(
      requests.every(
        (url) =>
          new URL(url).origin === site.origin &&
          !/runtime|model|detector|photo|ort-wasm/.test(new URL(url).pathname),
      ),
      JSON.stringify(requests),
    );
  },
);

test(
  'real GPU sampling, device loss and validation failure destroy only checker-owned resources',
  { timeout: 40_000 },
  async (t) => {
    const site = await serve(
      process.env['FACEMORPH_PREFLIGHT_SITE'] ?? new URL('../../dist', import.meta.url).pathname,
    );
    // Software Vulkan is still a real browser GPUDevice, not a mocked API or inference pass.
    const browser = await chromium.launch({
      args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: string[] = [];
    await context.route('**/*', (route) => {
      requests.push(route.request().url());
      return route.continue();
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    t.after(async () => {
      mkdirSync(out, { recursive: true });
      if (t.error) await page.screenshot({ path: join(out, 'gpu-failure.png') }).catch(() => {});
      await context.tracing.stop({ path: join(out, 'gpu-trace.zip') });
      await browser.close();
      await site.close();
    });
    await surface(page, site.origin);
    const result = await page.evaluate(() => window.preflight.checkDevice({ rerun: true }));
    clean(result);
    assert.equal(result.evidence.webgpuAdapter.state, 'known', 'actual browser adapter required');
    assert.equal(result.evidence.gpuSample.state, 'known', JSON.stringify(result));
    assert.equal(result.evidence.cpuSample.state, 'known');
    const loss = await page.evaluate(async () => {
      const gpu = (
        navigator as unknown as { gpu: { requestAdapter(): Promise<GpuAdapter | null> } }
      ).gpu;
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw Error('Actual GPU adapter required');
      const prototype = Object.getPrototypeOf(adapter) as {
        requestDevice: (this: GpuAdapter) => Promise<GpuDevice>;
      };
      const nativeRequestDevice = prototype.requestDevice;
      // Instrument native device creation only; the returned device and loss are real.
      prototype.requestDevice = async function (this: GpuAdapter) {
        const device = await nativeRequestDevice.call(this);
        setTimeout(() => device.destroy(), 100);
        return device;
      };
      try {
        return await window.preflight.checkDevice({ rerun: true });
      } finally {
        prototype.requestDevice = nativeRequestDevice;
      }
    });
    clean(loss);
    assert.equal(loss.outcome, 'gpu-lost');
    assert.equal(loss.evidence.cpuSample.state, 'known', 'GPU failure preserves CPU evidence');
    const lifecycle = await page.evaluate(async () => {
      const gpu = (
        navigator as unknown as { gpu: { requestAdapter(): Promise<GpuAdapter | null> } }
      ).gpu;
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw Error('Real GPU adapter required');
      const sentinel = await adapter.requestDevice();
      const results = [];
      try {
        for (const kind of ['loss', 'validation']) {
          const scratch = new window.preflight.Scratch();
          const checkAdapter = await gpu.requestAdapter();
          if (!checkAdapter) throw Error('Checker adapter unavailable');
          const session = await window.preflight.createGpuSample(
            checkAdapter,
            new AbortController().signal,
            scratch,
          );
          const began = performance.now();
          const pending = session.run(began + 1000);
          const duplicate = await session.run(performance.now() + 500);
          if (duplicate.state !== 'failed') throw Error('GPU session accepted duplicate run');
          setTimeout(() => {
            if (kind === 'loss') session.device.destroy();
            else session.device.createBuffer({ size: 4, usage: 0 }); // real invalid WebGPU descriptor
          }, 50);
          const sample = await pending;
          // This independent device remains valid after the checker device fails.
          sentinel.pushErrorScope('validation');
          const buffer = sentinel.createBuffer({ size: 4, usage: 128 });
          await sentinel.queue.onSubmittedWorkDone();
          buffer.destroy();
          results.push({
            kind,
            sample,
            elapsedMs: performance.now() - began,
            resources: scratch.resources,
            bytes: scratch.current,
            sentinelError: await sentinel.popErrorScope(),
          });
        }
        return results;
      } finally {
        sentinel.destroy();
      }
    });
    for (const cell of lifecycle) {
      assert.equal(cell.sample.state, 'failed', JSON.stringify(cell));
      assert.equal(cell.resources, 0);
      assert.equal(cell.bytes, 0);
      assert.equal(cell.sentinelError, null);
      assert.ok(
        cell.elapsedMs < 700,
        `GPU failure must end the sample early: ${JSON.stringify(cell)}`,
      );
    }
    assert.ok(
      requests.every(
        (url) =>
          new URL(url).origin === site.origin &&
          !/runtime|model|detector|photo|ort-wasm/.test(new URL(url).pathname),
      ),
    );
    writeFileSync(
      join(out, 'gpu.json'),
      JSON.stringify({ result, loss, lifecycle, requests }, null, 2),
    );
  },
);
