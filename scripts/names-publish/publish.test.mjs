// Real files, recovery envelopes and HTTP; planted producer records are inputs, not inference evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { embedRecovery, recoverEnvelope } from '../../apps/web/src/Next/image-envelope.mjs';
import {
  headerLine,
  rowLine,
  resultSet,
  nameIdentity,
  sha256,
} from '../../tools/names-generator/lib.mjs';
import {
  getPublished,
  prepare,
  retainPrevious,
  verifyPublished,
  list,
  POINTER,
} from './publish.mjs';

async function input(root, label, identityDigit) {
  const generated = join(root, label),
    legacy = join(root, 'legacy');
  mkdirSync(generated, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  const fixture = await recoverEnvelope(
    new Blob([
      readFileSync(
        new URL('../../apps/web/test/fixtures/verify/stills/recovery-v2.webp', import.meta.url),
      ),
    ]),
  );
  const identity = {
    manifestSha256: identityDigit.repeat(64),
    modelSha256: fixture.provenance.modelSha256,
    generationSha256: fixture.generationSha256,
  };
  const set = resultSet(identity),
    name = nameIdentity('Charlotte');
  const wrapped = await embedRecovery(fixture.blob, {
    ...fixture,
    provenance: { ...fixture.provenance, manifestSha256: identity.manifestSha256 },
  });
  const bytes = Buffer.from(await wrapped.blob.arrayBuffer());
  const row = {
    ...name,
    resultSet: set.digest,
    file: 'result.webp',
    bytes: bytes.length,
    fileSha256: sha256(bytes),
    imageSha256: wrapped.baseImageSha256,
    latentSha256: wrapped.latentSha256,
    latentCheck: 'exact',
    referenceLatent: { status: 'pass', maxAbsDiff: 0 },
    synthesisCheck: { status: 'pass', maxRgbDiff: 0 },
  };
  writeFileSync(join(generated, row.file), bytes);
  writeFileSync(join(generated, 'manifest.jsonl'), headerLine(set) + rowLine(row));
  writeFileSync(
    join(legacy, 'catalogue.json'),
    JSON.stringify({
      names: [
        {
          ...name,
          latent: {
            sha256: row.latentSha256,
            modelSha256: identity.modelSha256,
            generationSha256: identity.generationSha256,
          },
        },
      ],
    }),
  );
  return { generated, legacy };
}

test('corruption refuses publication; old manifest and result survive an actual HTTP pointer switch', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm-publication-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = await prepare(await input(root, 'first', 'a'));
  t.after(() => rmSync(first.out, { recursive: true, force: true }));
  writeFileSync(join(first.out, POINTER), first.pointer);
  let served = first.out;
  const server = createServer((req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      res.end(readFileSync(join(served, path)));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  // This is what an already-open consumer retains before the deployment.
  const oldPointer = JSON.parse(await getPublished(new URL(POINTER, origin)));
  const oldManifest = JSON.parse(await getPublished(new URL(oldPointer.manifest.url, origin)));
  let page;
  if (process.env.PUBLICATION_BROWSER) {
    const require = createRequire(
      new URL('../../tools/names-generator/package.json', import.meta.url),
    );
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      executablePath: process.env.PUBLICATION_BROWSER,
      headless: true,
    });
    t.after(() => browser.close());
    page = await browser.newPage();
    await page.goto(new URL(POINTER, origin).href);
    await page.evaluate(async () => {
      const pointer = await (await fetch('/catalogue-v2.json')).json();
      window.retainedManifest = await (await fetch(pointer.manifest.url)).json();
    });
  }
  const nextInput = await input(root, 'second', 'b');
  const prior = await retainPrevious(origin, join(root, 'prior'));
  const second = await prepare({ ...nextInput, previous: prior });
  t.after(() => rmSync(second.out, { recursive: true, force: true }));
  served = second.out; // immutable phase still serves the old pointer
  assert.deepEqual(JSON.parse(await getPublished(new URL(POINTER, origin))), oldPointer);
  await verifyPublished(origin, second, { pointer: false });
  writeFileSync(join(second.out, POINTER), second.pointer);
  assert.equal((await verifyPublished(origin, second)).pointerChecked, true);
  const oldBytes = Buffer.from(
    await getPublished(new URL(oldManifest.names[0].result.url, origin)),
  );
  assert.equal(sha256(oldBytes), oldManifest.names[0].result.sha256);
  assert.notDeepEqual(JSON.parse(second.pointer), oldPointer);
  if (page) {
    const retained = await page.evaluate(async () => {
      const result = window.retainedManifest.names[0].result;
      const bytes = await (await fetch(result.url)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return {
        expected: result.sha256,
        actual: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
      };
    });
    assert.equal(retained.actual, retained.expected);
    console.log('Actual open Chromium tab retained and fetched its old result after switch.');
  }
  const current = (await getPublished(new URL(POINTER, origin))).toString();
  writeFileSync(join(nextInput.generated, 'result.webp'), 'corrupted');
  await assert.rejects(
    prepare({ ...nextInput, previous: prior, out: join(root, 'failed') }),
    /Unqualified result/,
  );
  assert.equal((await getPublished(new URL(POINTER, origin))).toString(), current);
  assert.equal(second.summary.assetCount, list(second.out).length);
  assert.equal(
    second.summary.bytes,
    list(second.out).reduce((n, f) => n + f.bytes, 0),
  );
});

test('symlink assets cannot escape the verified tree', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fm-publication-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync('/etc/hostname', join(root, 'outside'));
  assert.throws(() => list(root), /Symlink asset/);
});
