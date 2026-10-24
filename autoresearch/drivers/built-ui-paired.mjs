#!/usr/bin/env node
// Built-UI paired driver, maintained revision 2 (fm-qqh). Derived from the frozen
// autoresearch/candidates/direct-rgba-media-v1/built-ui-paired.mjs (classic b2d945a, never edited): the same journey
// (two new faces, first Save, the same face again, repeat Save with identical bytes, a 32-frame morph to playable
// video, Save video, then a first and a next photo with real encoder events and Save) through the built UI of exact
// artifacts. Changes from revision 1: artifacts are verified by digest before anything runs (default control: the
// pinned control artifact, control.json); the run must hold the device lease; every request goes through the
// interception helper; each side is served by the parity specs' control server with the verified acquired runtime;
// outputs go to a fresh run directory in the durable location (never overwritten); a failed sample keeps its trace
// and screenshot; selectors follow the control's current DOM contract (section.next-face, data-next-state,
// data-next-busy).
//
// The driver accepts consent and the download dialog itself and supplies files programmatically, so it cannot
// establish native chooser latency (that needs the evaluator's adapters). Not user analytics, hardware GPU, physical
// phone, compositor paint, total memory or OS share qualification.
//
//   python3 autoresearch/run.py --lane browser-cpu --device eris --timeout 3600 -- \
//     node autoresearch/drivers/built-ui-paired.mjs --label <fresh> [--mode smoke|paired] \
//       [--control deploy-next --control-digest <sha>] [--candidate <dir> --candidate-digest <sha> --candidate-source <s>] \
//       [--runtime <acquired runtime>] [--out-root <durable dir>] [--route cpu|webgpu|auto]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CONTROL,
  REPO,
  freshRunDir,
  outRoot,
  requireLease,
  verifyArtifact,
} from './lib/artifact.mjs';
import {
  environment,
  finish,
  guardNetwork,
  launch,
  serve,
  verifiedRuntime,
} from './lib/session.mjs';
import { INSTRUMENT, journey, sha } from './lib/journey.mjs';

const DRIVER = {
  name: 'built-ui-paired',
  revision: 2,
  derivedFrom: 'autoresearch/candidates/direct-rgba-media-v1/built-ui-paired.mjs',
};
const { values: opt } = parseArgs({
  options: {
    label: { type: 'string' },
    mode: { type: 'string', default: 'smoke' },
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
    route: { type: 'string', default: 'cpu' },
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
const runtime = verifiedRuntime(resolve(opt.runtime));
// A paired measurement refuses a contended host; a smoke is not an evaluated outcome, so it only records the load.
const maxLoad = Number(opt['max-load'] ?? (opt.mode === 'paired' ? 4 : Infinity));
if (loadavg()[0] > maxLoad)
  throw new Error(`contended host (load ${loadavg()[0]} > ${maxLoad}): measurement refused`);
const run = freshRunDir(outRoot(opt['out-root']), opt.label);
const fixture = readFileSync(join(artifacts.control.dir, 'preview/hello-1024.webp'));

const report = {
  driver: { ...DRIVER, sha256: sha(readFileSync(import.meta.filename)) },
  label: opt.label,
  mode: opt.mode,
  run,
  lease,
  at: new Date().toISOString(),
  scope:
    'Paired exact built-UI Linux screen of the declared route; consent, download dialog and files supplied by the driver. Not native chooser latency, user analytics, hardware-GPU, physical-phone, paint, total-memory or OS-share qualification.',
  policy: {
    route: opt.route,
    network:
      'origin served locally from the verified artifact; only the origin and project hosts resolve',
    samples:
      opt.mode === 'paired'
        ? 'one discarded warmup per side, then ABBA x3 (six observations per side)'
        : 'smoke: one sample per side, no warmup; not an evaluated outcome',
    boundaries:
      'action to filled tile and idle; playable 32-frame video; browser download complete; photo with encode-aligned posted and encoding-complete',
  },
  artifacts,
  runtime: { dir: runtime.dir, files: runtime.files, manifestSha256: runtime.manifestSha256 },
  fixture: {
    path: 'preview/hello-1024.webp (from the control artifact)',
    sha256: sha(fixture),
    provenance:
      'Public preview face; a deterministic whole-image RGB offset per case and first/next, re-encoded WebP q.95 outside timing. No personal photo.',
  },
  privacy:
    'report.json is shareable (synthetic public fixture only). Traces and screenshots of failed samples are local-only raw files.',
  environmentBefore: environment(),
  samples: [],
  errors: [],
};
const save = () => writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n');

// Per sample and first/next a distinct photo, so no step can hit the normalized-photo cache of an earlier one.
async function photo(page, caseId, which) {
  const shift = (caseId + 2) * 2 + (which === 'next' ? 1 : 0);
  const bytes = Buffer.from(
    await page.evaluate(
      async ({ source, shift }) => {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(source)], { type: 'image/webp' }),
        );
        const canvas = new OffscreenCanvas(1024, 1024);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const px = ctx.getImageData(0, 0, 1024, 1024);
        for (let i = 0; i < px.data.length; i += 4)
          for (let c = 0; c < 3; c++) px.data[i + c] = Math.min(255, px.data[i + c] + shift);
        ctx.putImageData(px, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      { source: Array.from(fixture), shift },
    ),
  );
  return { name: 'synthetic-public-photo.webp', mimeType: 'image/webp', buffer: bytes };
}

async function sample(side, caseId, warmup) {
  if (loadavg()[0] > maxLoad)
    throw new Error('contention during the paired run: measurement refused');
  const n = report.samples.length;
  const dir = join(run, 'samples', `${String(n).padStart(2, '0')}-${side}`);
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
    for (const i of [0, 1]) await j.face(i, `paired-media-${71000 + caseId * 4 + i}`);
    const save1 = () => j.tile(0).getByRole('button', { name: 'Save image' });
    const first = await j.download('first-download', save1());
    await j.step(
      'repeat-original',
      () => j.tile(0).locator('.next-face-generate').click(),
      j.settled(0),
    );
    const repeat = await j.download('repeat-download', save1());
    if (first.sha256 !== repeat.sha256) throw new Error('repeat Save changed the file');
    entry.video = (await j.morph('video32')).video;
    await j.download(
      'video-download',
      page.locator('.next-video-slot').getByRole('button', { name: 'Save video' }),
    );
    // Each sample's first photo is new to its profile and the next differs from it: both must run the encoder.
    for (const which of ['first', 'next']) {
      const input = await photo(page, caseId, which);
      const r = await j.step(
        `photo-${which}`,
        () => page.locator('input[aria-label="Choose photo"]').last().setInputFiles(input),
        j.settled(1, 'photo'),
      );
      Object.assign(r, { inputSha256: sha(input.buffer), inputBytes: input.buffer.length });
      if (
        !r.events.some((e) => e.posted === 'encode-aligned') ||
        !r.events.some((e) => e.stage === 'encoding-complete')
      )
        throw new Error(
          'the photo did not run the encoder; an original-cache shortcut is not a sample',
        );
    }
    await j.download('photo-download', j.tile(1).getByRole('button', { name: 'Save image' }));
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
      driver: 'built-ui-paired/2',
      passed: report.passed,
      run,
      samples: report.samples.length,
      controlDigest: artifacts.control.treeSha256,
      candidateDigest: artifacts.candidate.treeSha256,
      errors: report.errors,
    },
  }),
);
if (!report.passed) process.exitCode = 1;
