// Full original-checkpoint parity through the same clean consumer used by all package gates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { withBrowserPage } from './browser.mjs';
import { assertNoRequests, requestsIn, step } from '../../ci/intercept/record.ts';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const filesUnder = (root, prefix = '') =>
  readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(root, join(prefix, entry.name)) : [join(prefix, entry.name)],
  );
const hostClasses = [
  'app',
  'model-host',
  'names-host',
  'collector',
  'analytics',
  'third-party',
  'local',
];
const runtimeManifestSha256 = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
async function bounded(operation, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(label + ' timed out')), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runConvertedGate({
  outDir,
  convertedDir,
  runtimeDir,
  evidenceDir,
  packages,
  executablePath,
  timeoutMs = 600000,
} = {}) {
  evidenceDir = resolve(evidenceDir ?? join(dirname(outDir), 'converted-gate'));
  mkdirSync(evidenceDir, { recursive: true });
  const report = {
    ok: false,
    packages,
    tolerance: { rawFloat: 0.002, rgb: 1 },
    assertions: [],
    errors: [],
  };
  let observation;
  try {
    const entries = filesUnder(outDir).filter((file) =>
      /(?:^|\/)converted(?:[-.][^/]*)?\.js$/.test(file),
    );
    assert.equal(entries.length, 1, 'Expected one emitted clean-consumer converted entry');
    report.entry = entries[0];
    const manifestBytes = readFileSync(join(convertedDir, 'manifest.json'));
    const unpublished = JSON.parse(manifestBytes);
    const reference = readJson(join(convertedDir, 'reference/reference.json'));
    const verification = readJson(join(convertedDir, 'verify.json'));
    const runtimeBytes = readFileSync(join(runtimeDir, 'manifest.json'));
    assert.equal(
      sha(runtimeBytes),
      runtimeManifestSha256,
      'Runtime manifest must match its independent pin',
    );
    assert.equal(verification.manifestSha256, sha(manifestBytes));
    assert.equal(verification.passed, true, 'Pinned native converter verification must pass');
    assert.equal(verification.reference.checkpointSha256, unpublished.modelSourceSha256);
    assert.equal(reference.checkpointSha256, unpublished.modelSourceSha256);
    assert.equal(reference.container, verification.container.image);
    assert.match(reference.container, /@sha256:[a-f0-9]{64}$/);
    assert.deepEqual(
      reference.cases.map((row) => row.seed),
      [0, 1, 42],
    );
    assert.deepEqual(reference.tolerance, { rawFloat: 0.002, rgb: 1 });
    assert.deepEqual(reference.truncation, { psi: 0.7, cutoff: 8 });
    report.manifestSha256 = sha(manifestBytes);
    report.referenceSha256 = sha(readFileSync(join(convertedDir, 'reference/reference.json')));
    report.container = verification.container;
    report.reference = reference;
    report.nativeVerification = verification;
    await withBrowserPage(
      {
        outDir,
        roots: { '/converted/': convertedDir, '/runtime/': runtimeDir },
        evidenceDir,
        executablePath,
        timeoutMs,
      },
      async (session) => {
        const { page, context, origin } = session;
        observation = session.observation;
        report.serverRequests = session.serverRequests;
        page.on('pageerror', (error) => report.errors.push(String(error.stack || error)));
        let phase = 'bootstrap';
        step(observation.rec, phase);
        await context.route(/^https?:\/\//, (route) => {
          const allowed =
            ['bootstrap', 'acquire'].includes(phase) &&
            new URL(route.request().url()).origin === origin;
          return allowed ? route.continue() : route.abort('blockedbyclient');
        });
        await page.goto(origin + '/');
        await bounded(
          page.evaluate(async (entry) => {
            window.__converted = await import('/' + entry);
          }, report.entry),
          timeoutMs,
          'Converted consumer import',
        );
        const locate = (asset) => {
          const { file, chunks, ...rest } = asset;
          return {
            ...rest,
            url: origin + '/converted/' + file,
            ...(chunks ? { chunks: chunks.map(locate) } : {}),
          };
        };
        const model = {
          ...unpublished,
          mapping: locate(unpublished.mapping),
          synthesis: locate(unpublished.synthesis),
          average: locate(unpublished.average),
          noise: unpublished.noise.map(locate),
        };
        const runtime = JSON.parse(runtimeBytes).runtime;
        const locateRuntime = (asset) => ({
          ...asset,
          url: origin + '/runtime/' + asset.url.split('/runtime/')[1],
        });
        runtime.moduleUrl = origin + '/runtime/' + runtime.moduleUrl.split('/runtime/')[1];
        runtime.assets = runtime.assets.map(locateRuntime);
        phase = 'acquire';
        step(observation.rec, phase);
        try {
          report.acquisition = await bounded(
            page.evaluate((config) => window.__converted.acquireConverted(config), {
              unpublished,
              model,
              runtime,
              reference,
              manifestSha256: report.manifestSha256,
            }),
            timeoutMs,
            'Converted asset/reference acquisition',
          );
          await observation.settled(3000);
          phase = 'inference';
          step(observation.rec, phase);
          report.inference = await bounded(
            page.evaluate(() => window.__converted.inferConverted()),
            timeoutMs,
            'Converted FFHQ inference',
          );
        } finally {
          phase = 'cleanup';
          step(observation.rec, phase);
          report.cleanup = await bounded(
            page.evaluate(() => window.__converted.cleanupConverted()),
            15000,
            'Converted consumer cleanup',
          );
        }
        await page.waitForTimeout(100);
        await observation.settled(3000);
        for (const name of ['inference', 'cleanup']) {
          const window = { fromStep: name, toStep: name };
          for (const hostClass of hostClasses) {
            const verdict = assertNoRequests(observation.rec, hostClass, window, (value) =>
              report.assertions.push(value),
            );
            assert.equal(verdict.verdict, 'pass', name + ': unexpected ' + hostClass + ' request');
          }
          assert.equal(
            requestsIn(observation.rec, window, (value) => report.assertions.push(value)).count,
            0,
            name + ': unexpected request outside declared host classes',
          );
        }
        assert.equal(report.inference.samples.length, 3);
        assert.equal(report.cleanup.liveSessionsAfterDispose, 0);
        assert.equal(observation.rec.console.length, 0, 'Browser reported console errors');
        assert.deepEqual(report.errors, [], 'Browser reported uncaught errors');
      },
    );
    report.ok = true;
  } catch (error) {
    report.errors.push(String(error.stack || error));
  }
  report.network = observation?.rec ?? null;
  writeFileSync(join(evidenceDir, 'converted.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(evidenceDir, 'network.json'), JSON.stringify(report.network, null, 2) + '\n');
  writeFileSync(
    join(evidenceDir, 'assertions.jsonl'),
    report.assertions.map((value) => JSON.stringify(value)).join('\n') + '\n',
  );
  return report;
}
