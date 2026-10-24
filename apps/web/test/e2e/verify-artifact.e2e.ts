// The artifact fixture and the per-keystroke helper (fm-48bj) for real: the pinned control artifact (deploy-next/
// from `npm run build:next`) is served only at its digest, with the run tagged by it; a wrong digest or a changed
// byte aborts before any browser starts; and a field that fetches on a keystroke fails the per-keystroke check.
//   npm run build:next && node --test test/e2e/verify-artifact.e2e.ts
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { serve } from '../support/serve.ts';
import {
  artifactDigest,
  bindOrigins,
  classOf,
  DigestMismatch,
  serveArtifact,
} from '../verify/artifact.ts';
import { operatedClick, StepLog, typeOperated } from '../verify/operated.ts';

const app = new URL('../../', import.meta.url);
const repo = new URL('../../../../', import.meta.url).pathname;
const identity = JSON.parse(readFileSync(join(repo, 'next-site-identity.json'), 'utf8'));
const digest = artifactDigest(identity.files);

test('the control artifact is served at its digest and the run is tagged with it', async (t) => {
  assert.ok(
    existsSync(join(repo, 'deploy-next')),
    'no deploy-next/: run `npm run build:next` first',
  );
  const site = await serveArtifact(repo, digest);
  t.after(() => site.close());
  assert.equal(site.tag.digest, digest);
  assert.equal(site.tag.kind, 'control');
  const log = new StepLog(
    (url) => classOf(bindOrigins({}, { app: [site.origin] }), url),
    site.tag as unknown as Record<string, string>,
  );
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(site.origin);
  assert.match(log.text(), new RegExp(`"digest":"${digest}"`), 'the step log names the digest');
  assert.ok(await page.title(), 'the control loaded');
});

test('a digest that is not the run’s aborts before serving', async () => {
  await assert.rejects(serveArtifact(repo, '0'.repeat(64)), DigestMismatch);
  await assert.rejects(serveArtifact(repo, '0'.repeat(64)), /run aborted/);
});

test('one changed byte in the artifact aborts the run', async (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'verify-artifact-'));
  t.after(() => {});
  cpSync(join(repo, 'deploy-next'), join(copy, 'deploy-next'), { recursive: true });
  for (const name of ['next-site-identity.json', 'next-site-SHA256SUMS', 'next-site-source.txt'])
    cpSync(join(repo, name), join(copy, name));
  const victim = join(copy, 'deploy-next/index.html');
  const bytes = readFileSync(victim);
  bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
  writeFileSync(victim, bytes);
  await assert.rejects(serveArtifact(copy, digest), /not what its identity says.*index\.html/);
});

test('a keystroke that makes a request fails the per-keystroke check; a quiet field passes', async (t) => {
  const site = await serve(new URL('test/fixtures', app).pathname);
  t.after(() => site.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${site.origin}/verify/typing.html`);
  const log = new StepLog((url) => classOf(bindOrigins({}, { app: [site.origin] }), url));
  await operatedClick(page, page.locator('#quiet'), {
    log,
    step: 'verify.harness/typing/focus-quiet',
  });
  const quiet = await typeOperated(page, 'hello', { log, step: 'verify.harness/typing/quiet' });
  assert.equal(quiet.length, 5);
  assert.ok(quiet.every((s) => s.ok && Object.keys(s.requests).length === 0));
  await operatedClick(page, page.locator('#chatty'), {
    log,
    step: 'verify.harness/typing/focus-chatty',
  });
  await assert.rejects(
    typeOperated(page, 'hello', { log, step: 'verify.harness/typing/chatty' }),
    /verify\.harness\/typing\/chatty\/key-3: keystroke 3 \("l"\) made requests: \{"app":\{"count":1/,
  );
});
