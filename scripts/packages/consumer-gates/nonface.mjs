#!/usr/bin/env node
// fm-tqub: joint proof using the exact retained release packs, outside the app/workspace.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { verifyUnpacked } from '../../ci/fetch-artifact.ts';
import { assertNoRequests, requestsIn, step } from '../../ci/intercept/record.ts';
import { bounded, withBrowserPage } from './browser.mjs';
import { installConsumer } from './run.mjs';
import { verifyNonfaceInputs } from './nonface-handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const classes = [
  'app',
  'model-host',
  'names-host',
  'collector',
  'analytics',
  'third-party',
  'local',
];
const runtimeSha = 'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c';
const files = (root) =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)],
  );

/** No request for a detector/encoder is hidden by sharing the developer's model host. */
export function assertOnlyDeclaredRequests(record, origin, allowedPaths) {
  const allowed = new Set(allowedPaths);
  for (const request of record.requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, origin, 'Non-face proof requested an undeclared origin');
    assert.ok(
      allowed.has(url.pathname),
      'Non-face proof requested an undeclared asset: ' + url.pathname,
    );
  }
  return {
    outcome: 'pass',
    detectorRequests: 0,
    encoderRequests: 0,
    requests: record.requests.length,
  };
}

function localAsset(asset, prefix, origin) {
  const { file, chunks, ...rest } = asset;
  return {
    ...rest,
    url: origin + prefix + file,
    ...(chunks ? { chunks: chunks.map((chunk) => localAsset(chunk, prefix, origin)) } : {}),
  };
}
function assetPaths(asset, prefix) {
  return [
    prefix + asset.file,
    ...(asset.chunks ?? []).flatMap((chunk) => assetPaths(chunk, prefix)),
  ];
}

export async function runNonfaceProof({ inputs, out, timeoutMs = 900000 }) {
  out = resolve(out);
  mkdirSync(out, { recursive: true });
  const report = {
    schema: 'facemorph.verify.packages/1',
    outcome: 'fail',
    source: inputs.release?.commit,
    artifactDigest: inputs.release?.artifactDigest,
    harnessSource: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: here,
      encoding: 'utf8',
    }).trim(),
    hosting: { class: 'developer-controlled-loopback-https', appIndependent: true },
    cells: {
      cleanConsumer: { outcome: 'untested' },
      conversion: { outcome: 'untested' },
      nonface: { outcome: 'untested' },
    },
    assertions: [],
    errors: [],
  };
  let work, observation;
  try {
    // All identity and byte admission precedes npm installation or browser construction.
    assert.equal(
      sha(readFileSync(inputs.handoff.archive)),
      inputs.handoff.sha256,
      'Hand-off archive digest mismatch',
    );
    const release = verifyUnpacked(inputs.releaseArtifact, inputs.release.commit);
    assert.equal(release.digest, inputs.release.artifactDigest, 'Release artifact digest mismatch');
    const admitted = await verifyNonfaceInputs({
      handoffDir: inputs.handoff.dir,
      modelDir: inputs.modelDir,
      checkpoint: inputs.checkpoint,
      consumerDir: inputs.consumerDir,
      referenceDir: inputs.referenceDir,
      morphReferenceDir: inputs.morphReferenceDir,
      expectedRelease: inputs.release,
      handoffIdentity: inputs.handoff,
    });
    report.admission = admitted;
    if (admitted.outcome === 'unqualified') {
      report.outcome = 'untested';
      report.cells.nonface = {
        outcome: 'untested',
        support: 'unqualified',
        blocker: admitted.blocker,
      };
      return report;
    }
    const schemaLog = execFileSync(
      'npx',
      [
        '--yes',
        'ajv-cli@5.0.0',
        'validate',
        '--spec=draft2020',
        '-s',
        resolve(
          here,
          '../../../packages/browser-model-manager/schema/model-manifest.v1.schema.json',
        ),
        '-d',
        join(inputs.handoff.dir, 'manifest.json'),
        '--errors=text',
      ],
      { cwd: resolve(here, '../../..'), encoding: 'utf8', timeout: 120000 },
    );
    writeFileSync(join(out, 'manifest-schema.log'), schemaLog);
    const runtimeBytes = readFileSync(join(inputs.runtimeDir, 'manifest.json'));
    assert.equal(sha(runtimeBytes), runtimeSha, 'Pinned runtime manifest digest mismatch');
    report.runtimeSha256 = runtimeSha;
    report.packages = admitted.packages;
    report.cells.cleanConsumer = {
      outcome: 'pass',
      source: admitted.source,
      release: admitted.release,
    };
    report.cells.conversion = {
      outcome: 'pass',
      scope: 'reverified qualified hand-off, no new conversion claim',
      checkpoint: admitted.checkpoint,
      container: admitted.nativeVerification.container,
      tolerance: admitted.nativeVerification.tolerance,
      schema: schemaLog.trim(),
    };

    work = mkdtempSync(join(tmpdir(), 'facemorph-nonface-consumer-'));
    const consumer = join(work, 'consumer');
    installConsumer(
      consumer,
      admitted.packages.map((pack) => join(inputs.consumerDir, 'packs', pack.file)),
    );
    const entry = join(consumer, 'nonface.js');
    cpSync(join(here, 'consumer/bundle/nonface.js'), entry);
    const outDir = join(work, 'bundle');
    await build({
      root: consumer,
      configFile: false,
      publicDir: false,
      logLevel: 'warn',
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        modulePreload: false,
        rolldownOptions: { input: { nonface: entry }, preserveEntrySignatures: 'exports-only' },
      },
    });
    const builtEntry = files(outDir).find((path) => /nonface[^/]*\.js$/.test(path));
    assert.ok(builtEntry, 'Clean consumer non-face entry missing');
    const relativeEntry = builtEntry.slice(outDir.length + 1);
    const manifest = admitted.manifest;
    const modelAssets = [manifest.mapping, manifest.synthesis, manifest.average, ...manifest.noise];
    const runtime = readJson(join(inputs.runtimeDir, 'manifest.json')).runtime;
    // The existing independently qualified references need not have the same conversion metadata.
    const reference = admitted.reference;
    const morphReference = admitted.morphReference;
    const allowedPaths = [
      '/',
      ...files(outDir).map((path) => '/' + path.slice(outDir.length + 1)),
      ...modelAssets.flatMap((asset) => assetPaths(asset, '/converted/')),
      ...reference.cases.flatMap((row) =>
        ['z', 'w', 'raw'].map((key) => '/reference/' + row[key].file),
      ),
      '/morph-reference/latents.f32',
      ...morphReference.frames.map((frame) => '/morph-reference/' + frame.file),
      new URL(runtime.moduleUrl).pathname,
      ...runtime.assets.map((asset) => new URL(asset.url).pathname),
    ];
    await withBrowserPage(
      {
        outDir,
        roots: {
          '/converted/': inputs.modelDir,
          '/reference/': inputs.referenceDir ?? join(inputs.modelDir, 'reference'),
          '/morph-reference/': inputs.morphReferenceDir ?? join(inputs.modelDir, 'morph-reference'),
          '/runtime/': inputs.runtimeDir,
        },
        evidenceDir: out,
        timeoutMs,
      },
      async (session) => {
        observation = session.observation;
        const { page, context, origin } = session;
        // The retained interception record templates hash path segments. Admission
        // compares transient raw URLs so two distinct asset digests cannot alias.
        const rawRequests = [];
        context.on('request', (request) => rawRequests.push({ url: request.url() }));
        let phase = 'bootstrap';
        step(observation.rec, phase);
        await context.route(/^https?:\/\//, (route) => {
          const url = new URL(route.request().url());
          return ['bootstrap', 'acquire'].includes(phase) &&
            url.origin === origin &&
            allowedPaths.includes(url.pathname)
            ? route.continue()
            : route.abort('blockedbyclient');
        });
        page.on('pageerror', (error) => report.errors.push(String(error.stack || error)));
        await page.goto(origin + '/');
        await bounded(
          () =>
            page.evaluate(async (entryPath) => {
              window.__nonface = await import('/' + entryPath);
            }, relativeEntry),
          timeoutMs,
          'Non-face consumer import',
        );
        const config = {
          unpublished: manifest,
          model: {
            ...manifest,
            mapping: localAsset(manifest.mapping, '/converted/', origin),
            synthesis: localAsset(manifest.synthesis, '/converted/', origin),
            average: localAsset(manifest.average, '/converted/', origin),
            noise: manifest.noise.map((asset) => localAsset(asset, '/converted/', origin)),
          },
          manifestSha256: inputs.handoff.manifestSha256,
          runtime: {
            ...runtime,
            moduleUrl: origin + new URL(runtime.moduleUrl).pathname,
            assets: runtime.assets.map((asset) => ({
              ...asset,
              url: origin + new URL(asset.url).pathname,
            })),
          },
          reference: {
            ...reference,
            cases: reference.cases.map((row) => ({
              ...row,
              ...Object.fromEntries(
                ['z', 'w', 'raw'].map((key) => [
                  key,
                  { ...row[key], url: origin + '/reference/' + row[key].file },
                ]),
              ),
            })),
          },
          morphReference: {
            ...morphReference,
            latents: {
              ...morphReference.latents,
              file: 'latents.f32',
              url: origin + '/morph-reference/latents.f32',
            },
            frames: morphReference.frames.map((frame) => ({
              ...frame,
              url: origin + '/morph-reference/' + frame.file,
            })),
          },
        };
        try {
          phase = 'acquire';
          step(observation.rec, phase);
          report.acquisition = await bounded(
            () => page.evaluate((value) => window.__nonface.acquireNonface(value), config),
            timeoutMs,
            'Non-face acquisition',
          );
          await observation.settled(3000);
          phase = 'inference';
          step(observation.rec, phase);
          report.inference = await bounded(
            () => page.evaluate(() => window.__nonface.inferNonface()),
            timeoutMs,
            'Non-face inference/morph/export/reopen',
          );
        } finally {
          phase = 'cleanup';
          step(observation.rec, phase);
          report.cleanup = await bounded(
            () => page.evaluate(() => window.__nonface.cleanupNonface()),
            15000,
            'Non-face cleanup',
          );
        }
        await observation.settled(3000);
        for (const phaseName of ['inference', 'cleanup']) {
          const window = { fromStep: phaseName, toStep: phaseName };
          for (const hostClass of classes)
            assert.equal(
              assertNoRequests(observation.rec, hostClass, window, (value) =>
                report.assertions.push(value),
              ).verdict,
              'pass',
            );
          assert.equal(requestsIn(observation.rec, window).count, 0, phaseName + ': no request');
        }
        report.networkScope = assertOnlyDeclaredRequests(
          { requests: rawRequests },
          origin,
          allowedPaths,
        );
        assert.deepEqual(report.errors, [], 'Browser errors during non-face proof');
        assert.equal(
          observation.rec.console.length,
          0,
          'Browser console errors during non-face proof',
        );
        report.browser = { family: 'chromium', version: session.browser.version() };
      },
    );
    for (const image of report.inference.exports ?? []) {
      assert.match(image.filename, /^afhq[-a-z0-9]+\.(png|webp)$/);
      const bytes = Buffer.from(image.bytesBase64, 'base64');
      writeFileSync(join(out, image.filename), bytes);
      image.sha256 = sha(bytes);
      image.size = bytes.length;
      delete image.bytesBase64;
    }
    report.cells.nonface = {
      outcome: 'pass',
      loadPaths: ['manager', 'caller-owned-bytes'],
      scope:
        'CPU AFHQ cat512; seed mapping, synthesis, multi-input morph, PNG/lossless-WebP export/reopen',
      platform: report.browser,
    };
    report.outcome = 'pass';
  } catch (error) {
    report.errors.push(String(error.stack || error));
    report.cells.nonface = { outcome: 'fail', reason: report.errors.at(-1) };
  } finally {
    report.network = observation?.rec ?? null;
    writeFileSync(join(out, 'sub-result-3.json'), JSON.stringify(report, null, 2) + '\n');
    if (work) rmSync(work, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  assert.ok(
    args.includes('--inputs') && args.includes('--out'),
    'Usage: nonface.mjs --inputs inputs.json --out evidence-directory',
  );
  const report = await runNonfaceProof({
    inputs: readJson(resolve(value('--inputs'))),
    out: value('--out'),
  });
  console.log(
    JSON.stringify({
      event: 'nonface-joint-proof',
      outcome: report.outcome,
      cells: report.cells,
      errors: report.errors,
    }),
  );
  process.exitCode = report.outcome === 'fail' ? 1 : 0;
}
