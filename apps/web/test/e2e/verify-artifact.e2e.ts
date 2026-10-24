// The artifact fixture and the per-keystroke helper (fm-48bj) for real: the pinned control artifact (deploy-next/
// from `npm run build:next`) is served only at its digest, with the run tagged by it; a wrong digest or a changed
// byte aborts before any browser starts; a field that fetches on a keystroke fails the per-keystroke check; and on the
// control, a model-host request injected into a step fails the interception helper's assertNoRequests (fm-o8xn).
//   npm run build:next && node --test test/e2e/verify-artifact.e2e.ts
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { serve } from '../support/serve.ts';
import { assertNoRequests, step } from '../../../../scripts/ci/intercept/record.ts';
import {
  artifactDigest,
  bindOrigins,
  DEFAULT_HOST_MAP,
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
  const log = new StepLog({
    map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }),
    run: { ...site.tag },
  });

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
  const log = new StepLog({ map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin] }) });
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

test('sample journey on the control at its digest: an injected model-host request fails assertNoRequests', async (t) => {
  const site = await serveArtifact(repo, digest);
  t.after(() => site.close());
  // A second real local origin, bound as the model host for this run: the page's own fetch reaches it.
  const models = await serve(new URL('test/fixtures', app).pathname);
  t.after(() => models.close());
  const log = new StepLog({
    map: bindOrigins(DEFAULT_HOST_MAP, { app: [site.origin], 'model-host': [models.origin] }),
    run: { ...site.tag },
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const rec = log.record(page);
  const quiet = () => {};
  step(rec, 'verify.harness/sample/open');
  await page.goto(site.origin);
  await log.attach(page).settled();
  assert.equal(
    assertNoRequests(
      rec,
      'model-host',
      { fromStep: 'verify.harness/sample/open', toStep: 'verify.harness/sample/open' },
      quiet,
    ).verdict,
    'pass',
  );
  assert.equal(
    assertNoRequests(
      rec,
      'third-party',
      { fromStep: 'verify.harness/sample/open', toStep: 'verify.harness/sample/open' },
      quiet,
    ).verdict,
    'pass',
    'the control makes no third-party request',
  );
  step(rec, 'verify.harness/sample/injected');
  await page.evaluate(
    (u) => fetch(u, { mode: 'no-cors' }).then(() => null),
    `${models.origin}/verify/typing.html`,
  );
  await log.attach(page).settled();
  const v = assertNoRequests(
    rec,
    'model-host',
    { fromStep: 'verify.harness/sample/injected', toStep: 'verify.harness/sample/injected' },
    quiet,
  );
  assert.equal(v.verdict, 'fail');
  assert.match(v.reason, /1 model-host request/);
  assert.match(log.text(), new RegExp(`"digest":"${digest}"`), 'the run is tagged with the digest');
});
