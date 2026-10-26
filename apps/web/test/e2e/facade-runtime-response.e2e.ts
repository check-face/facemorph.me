// Real HTTP and browser bytes, with generated data rather than inference weights (fm-jx26).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { fulfillRuntime } from '../support/fulfill-runtime.ts';
import { serve } from '../support/serve.ts';

test('runtime HTTP responses retain exact bytes and failure status without inflating action traces', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'facade-runtime-response-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = join(directory, 'runtime');
  mkdirSync(runtime);
  const bytes = Buffer.alloc(4 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 8)) & 255;
  writeFileSync(join(runtime, 'generated.bin'), bytes);
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><title>Runtime response regression</title><h1>Generated runtime bytes</h1>',
  );
  const digest = createHash('sha256').update(bytes).digest('hex');
  const site = await serve(directory, { '/runtime/': runtime });
  t.after(() => site.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: false, sources: true });
  await context.route('https://runtime.example/runtime/**', (route) =>
    fulfillRuntime(route, context.request, site.origin + new URL(route.request().url()).pathname, {
      'content-type': 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    }),
  );
  const page = await context.newPage();
  await page.goto(site.origin);
  const received = await page.evaluate(async () => {
    const response = await fetch('https://runtime.example/runtime/generated.bin');
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      status: response.status,
      length: bytes.byteLength,
      digest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      ),
    };
  });
  assert.deepEqual(received, { status: 200, length: bytes.length, digest });
  const missing = await page.evaluate(async () => {
    const response = await fetch('https://runtime.example/runtime/missing.bin');
    return { status: response.status, length: (await response.arrayBuffer()).byteLength };
  });
  assert.deepEqual(missing, { status: 404, length: 0 }, 'a real missing asset remains missing');
  await page.screenshot();
  const tracePath = join(directory, 'trace.zip');
  await context.tracing.stop({ path: tracePath });
  const trace = execFileSync('unzip', ['-p', tracePath, 'trace.trace'], {
    maxBuffer: 16 * 1024 * 1024,
  }).toString();
  assert.ok(
    Buffer.byteLength(trace) < 256 * 1024,
    `action trace is ${Buffer.byteLength(trace)} bytes for a 4 MiB response`,
  );
  const events = trace
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const fulfills = events.filter(
    (event) => event.type === 'before' && event.class === 'Route' && event.method === 'fulfill',
  );
  assert.equal(fulfills.length, 2, 'both actual HTTP responses are traced');
  assert.ok(
    fulfills.every((event) => !('body' in event.params)),
    'no binary body is inlined in action arguments',
  );
  assert.ok(
    events.some((event) => event.type === 'before' && event.method === 'goto'),
    'navigation actions are retained',
  );
  assert.ok(
    events.some((event) => event.type === 'screencast-frame'),
    'screenshots are retained',
  );
  t.diagnostic(`4 MiB SHA-256 ${digest}; action trace ${Buffer.byteLength(trace)} bytes`);
});
