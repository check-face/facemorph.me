#!/usr/bin/env node
// Sampled typed-vs-catalogue check (bead fm-a40f, acceptance 3). For a deterministic sample of the generator's
// valid rows, in a fresh browser profile (nothing cached from the generation run): type the name through the
// candidate's typed-name path, read the catalogue file's recovery envelope with the candidate's own reader, and
// require the same latent (SHA-256, exact), the same generation and model identity, and the catalogue latent's
// raw synthesis within the frozen RGBA tolerance of the typed result's lossless output. Every browser request is
// recorded by host; a request to an API host fails the check.
//
//   node sample-check.mjs --out=<generator output dir> [--samples=25] [--seed=fm-a40f] [--route=cpu]
//                         [--classic=<path>] [--chromium=<path>] [--cache=<dir>]
// Run it under the machine's device lease. Exit 0 when every sampled row passes, 1 otherwise, 2 usage.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openHarness, prepareClassic, PINNED, serve } from './generate.mjs';
import { isApiHost, parseManifest, sampleRows, sampleVerdict } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export async function main(argv) {
  const a = Object.fromEntries(
    argv
      .map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2))
      .map(([k, v]) => [k, v ?? true]),
  );
  if (!a.out) {
    console.error(
      'usage: sample-check.mjs --out=<generator output dir> [--samples=25] [--seed=fm-a40f]',
    );
    return 2;
  }
  const log = (o) => console.log(JSON.stringify(o));
  const out = resolve(a.out);
  const cache = resolve(a.cache ?? join(homedir(), '.cache', 'facemorph-names-generator'));
  const classic = prepareClassic(
    resolve(a.classic ?? join(here, '../../../facemorph.me-classic')),
    PINNED.commit,
    cache,
  );
  const { recoverEnvelope } = await import(
    pathToFileURL(join(classic.dir, 'src/Next/image-envelope.mjs')).href
  );
  const manifest = parseManifest(readFileSync(join(out, 'manifest.jsonl'), 'utf8'));
  const valid = [...manifest.rows.values()].filter(
    (r) =>
      r.latentCheck === 'exact' &&
      r.referenceLatent?.status === 'pass' &&
      r.synthesisCheck?.status !== 'fail' &&
      existsSync(join(out, r.file)),
  );
  const seed = a.seed ?? 'fm-a40f';
  const sample = sampleRows(valid, Number(a.samples ?? 25), seed);
  log({ event: 'sample', valid: valid.length, sampled: sample.length, seed });

  const pw = await import('playwright');
  const { server, origin } = await serve(classic.dir);
  const profile = mkdtempSync(join(tmpdir(), 'names-sample-check-'));
  const hosts = {};
  const route = a.route ?? 'cpu';
  const chromium =
    a.chromium ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const verdicts = [];
  let harness;
  try {
    harness = await openHarness(pw, { origin, route, chromium, profile, hosts });
    log({ event: 'typed-path', route, setup: harness.setup.status });
    for (const row of sample) {
      const typed = await harness.page.evaluate(
        (v) => window.generateName(v, { withPng: true }),
        row.value,
      );
      const file = readFileSync(join(out, row.file));
      const env = await recoverEnvelope(new Blob([file], { type: 'image/webp' }));
      const envelope =
        env && !env.legacy
          ? {
              latentSha256: env.latentSha256,
              generationSha256: env.generationSha256,
              modelSha256: env.provenance?.modelSha256 ?? null,
            }
          : null;
      // The catalogue latent through the typed page's own runtime, against what typing produced.
      const latentB64 = env?.latent
        ? Buffer.from(Float32Array.from(env.latent.values).buffer).toString('base64')
        : null;
      const synthesis = latentB64
        ? await harness.page.evaluate(([l, p]) => window.reference(l, p), [latentB64, typed.png])
        : null;
      const v = sampleVerdict(row, {
        typed: {
          latentSha256: typed.latentSha256,
          generationSha256: typed.generationSha256,
          modelSha256: typed.provenance?.modelSha256 ?? null,
        },
        envelope,
        synthesis,
      });
      verdicts.push(v);
      log({ event: 'row', ...v });
    }
  } finally {
    await harness?.context.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
  const apiRequests = Object.keys(hosts).filter((h) => isApiHost(h.split(':')[0]));
  const failed = verdicts.filter((v) => !v.ok);
  log({
    event: 'summary',
    sampled: verdicts.length,
    passed: verdicts.length - failed.length,
    failed: failed.map((v) => v.value),
    maxRgbDiff: Math.max(0, ...verdicts.map((v) => v.maxRgbDiff ?? 255)),
    hosts,
    apiRequests: apiRequests.length,
  });
  return failed.length || apiRequests.length || !verdicts.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
