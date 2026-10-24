#!/usr/bin/env node
// Morph-frame product driver, maintained revision 2 (fm-qqh). Derived from the frozen product harness of
// autoresearch/candidates/morph-frame-pipeline-v1/ (product.mjs, drive-product.py, run-product.sh; classic b2d945a,
// never edited), which imported runtime.mjs from a source tree. An artifact bundles its runtime, so this revision
// measures the same thing at the product boundary of an exact artifact: two faces, then Create morph through the
// built UI on the declared route, timing every synthesized frame the worker posts ('frame' messages of
// synthesize-frames), every frame handed to the video writer, and the playable video; then Save video for the
// output's digest. Per-frame time counts from the last warm-up frame (3) to the last frame, as revision 1 did.
// Artifacts are verified by digest first (default control: control.json), the run must hold the device lease, a
// WebGPU route needs a hardware adapter (a software one is rejected), every request goes through the interception
// helper, outputs go to a fresh run directory in the durable location and failed samples keep trace and screenshot.
//
//   python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 3600 -- \
//     node autoresearch/drivers/morph-frame-product.mjs --label <fresh> [--route webgpu|cpu|auto] [--mode smoke|paired] \
//       [--control deploy-next --control-digest <sha>] [--candidate <dir> --candidate-digest <sha> --candidate-source <s>] \
//       [--runtime <acquired runtime>] [--out-root <durable dir>]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { adapterVerdict } from './lib/adapter.mjs';
import {
  CONTROL,
  REPO,
  freshRunDir,
  outRoot,
  requireLease,
  verifyArtifact,
} from './lib/artifact.mjs';
import { frameTiming } from './lib/frames.mjs';
import { INSTRUMENT, journey, sha } from './lib/journey.mjs';
import {
  adapterInfo,
  environment,
  finish,
  guardNetwork,
  launch,
  serve,
  verifiedRuntime,
} from './lib/session.mjs';

const DRIVER = {
  name: 'morph-frame-product',
  revision: 2,
  derivedFrom: 'autoresearch/candidates/morph-frame-pipeline-v1/ (product.mjs, drive-product.py)',
};
const WARM = 3;
const { values: opt } = parseArgs({
  options: {
    label: { type: 'string' },
    mode: { type: 'string', default: 'smoke' },
    route: { type: 'string', default: 'webgpu' },
    control: { type: 'string', default: join(REPO, CONTROL.path) },
    'control-digest': { type: 'string', default: CONTROL.treeSha256 },
    'control-source': { type: 'string', default: CONTROL.source },
    candidate: { type: 'string' },
    'candidate-digest': { type: 'string' },
    'candidate-source': { type: 'string' },
    runtime: {
      type: 'string',
      default: process.env.FACEMORPH_RUNTIME ?? join(REPO, '.cache/runtime'),
    },
    'out-root': { type: 'string' },
    'max-load': { type: 'string' },
  },
});
if (!opt.label) throw new Error('--label <fresh run label> is required');
if (!['smoke', 'paired'].includes(opt.mode)) throw new Error('--mode is smoke or paired');
if (!['cpu', 'webgpu', 'auto'].includes(opt.route))
  throw new Error('--route is cpu, webgpu or auto');

// Identity first: a wrong digest is refused before the lease, the server or a browser is touched.
const artifacts = {
  control: { ...verifyArtifact(opt.control, opt['control-digest']), source: opt['control-source'] },
};
artifacts.candidate = opt.candidate
  ? {
      ...verifyArtifact(opt.candidate, opt['candidate-digest']),
      source: opt['candidate-source'] ?? `artifact:${opt['candidate-digest']}`,
    }
  : { ...artifacts.control, note: 'no candidate given: control/control' };
const lease = requireLease();
const lane = opt.route === 'webgpu' ? 'browser-gpu' : 'browser-cpu';
const runtime = verifiedRuntime(resolve(opt.runtime));
const maxLoad = Number(opt['max-load'] ?? (opt.mode === 'paired' ? 4 : Infinity));
if (loadavg()[0] > maxLoad)
  throw new Error(`contended host (load ${loadavg()[0]} > ${maxLoad}): measurement refused`);
const run = freshRunDir(outRoot(opt['out-root']), opt.label);

const report = {
  driver: { ...DRIVER, sha256: sha(readFileSync(import.meta.filename)) },
  label: opt.label,
  mode: opt.mode,
  run,
  lease,
  at: new Date().toISOString(),
  scope:
    'Morph frame throughput of an exact artifact through its built UI on one route and device; consent and the download dialog answered by the driver. Not physical-phone, other-browser, paint or total-memory qualification; frames are not compared numerically here.',
  policy: {
    route: opt.route,
    lane,
    warmFrames: WARM,
    network:
      'origin served locally from the verified artifact; only the origin and project hosts resolve',
    samples:
      opt.mode === 'paired'
        ? 'one discarded warmup per side, then ABBA x3'
        : 'smoke: one sample per side, no warmup; not an evaluated outcome',
    boundaries:
      'Create morph to playable 1024x1024 video with the product idle; per-frame from the last warm-up frame to the last synthesized frame',
  },
  artifacts,
  runtime: { dir: runtime.dir, files: runtime.files, manifestSha256: runtime.manifestSha256 },
  privacy:
    'report.json is shareable (typed words only, no photos). Traces and screenshots of failed samples are local-only raw files.',
  environmentBefore: environment(),
  samples: [],
  errors: [],
};
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');

async function sample(side, caseId, warmup) {
  if (loadavg()[0] > maxLoad)
    throw new Error('contention during the paired run: measurement refused');
  const dir = join(run, 'samples', `${String(report.samples.length).padStart(2, '0')}-${side}`);
  mkdirSync(dir, { recursive: true });
  const entry = { side, caseId, warmup, loadBefore: loadavg(), steps: [] };
  report.samples.push(entry);
  save();
  const a = artifacts[side];
  const server = await serve({
    artifact: a.dir,
    source: a.source,
    runtime: runtime.dir,
    log: join(dir, 'server.log'),
  });
  const context = await launch({ profile: join(run, 'profiles', side), route: opt.route });
  let failed = true;
  try {
    entry.network = await guardNetwork(context);
    await context.addInitScript(INSTRUMENT);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (e) => (entry.pageErrors ??= []).push(e.message));
    const j = journey(page, entry, {
      save,
      log: (fields) => console.log(JSON.stringify({ side, caseId, warmup, ...fields })),
    });
    await j.open(opt.route);
    entry.adapter = await adapterInfo(page);
    entry.adapterVerdict = adapterVerdict(entry.adapter, lane);
    if (!entry.adapterVerdict.ok)
      throw new Error(`${lane} refused: ${entry.adapterVerdict.reason}`);
    for (const i of [0, 1]) await j.face(i, `morph-frame-${caseId}-${i}`);
    const m = await j.morph('morph');
    Object.assign(entry, { video: m.video, frames: frameTiming(m.events, WARM), route: m.route });
    if (!entry.frames.synthesizedFrames) throw new Error('no synthesized frame was observed');
    const saved = await j.download(
      'video-download',
      page.locator('.next-video-slot').getByRole('button', { name: 'Save video' }),
    );
    entry.output = { file: saved.filename, bytes: saved.bytes, sha256: saved.sha256 };
    if (entry.pageErrors?.length) throw new Error('browser page errors');
    entry.passed = true;
    failed = false;
  } catch (error) {
    entry.passed = false;
    entry.error = error.message;
    throw error;
  } finally {
    entry.evidence = await finish(context, { failed, dir });
    await server.stop();
    entry.loadAfter = loadavg();
    save();
  }
}

try {
  if (opt.mode === 'smoke') {
    await sample('control', 0, false);
    await sample('candidate', 0, false);
  } else {
    await sample('control', -1, true);
    await sample('candidate', -1, true);
    for (let block = 0; block < 3; block++)
      for (const [j, side] of ['control', 'candidate', 'candidate', 'control'].entries())
        await sample(side, block * 2 + (j >= 2 ? 1 : 0), false);
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errors.push(error.message);
} finally {
  // Profiles (each side's retained models, hundreds of MB) live only for the run.
  rmSync(join(run, 'profiles'), { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.environmentAfter = environment();
  save();
}
console.log(
  JSON.stringify({
    summary: {
      driver: 'morph-frame-product/2',
      passed: report.passed,
      run,
      route: opt.route,
      samples: report.samples.length,
      perFrameMs: report.samples.map((s) => s.frames?.perFrameMs ?? null),
      controlDigest: artifacts.control.treeSha256,
      candidateDigest: artifacts.candidate.treeSha256,
      errors: report.errors,
    },
  }),
);
if (!report.passed) process.exitCode = 1;
