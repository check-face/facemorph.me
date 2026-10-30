#!/usr/bin/env node
// Clean-consumer smoke (fm-oagi): the whole non-face journey from the public docs, with the three release tarballs
// (the `packages` workflow's artifact) and a clean clone of this repository at a model-conv release-candidate tag.
// Author-run; it never substitutes for the independent review (fm-fy2.21).
//   node scripts/packages/clean-consumer-smoke.mjs --tarballs <dir> --clone <clean clone> --out <evidence dir>
//     [--reference <dir>]   upstream AFHQ cat reference files (default: the clone's out/afhqcat/reference, else
//                           this checkout's packages/model-conv/out/afhqcat/reference); checked against
//                           packages/stylegan-js/test/vectors/afhq-cat-512/reference.json by digest
// Run it from the clone (`node scripts/...` inside it), after `npm ci` there. Steps, one JSON line each and all in
// <out>/smoke.json:
//   0 tarballs  provenance inside each tarball names the clone's commit and its own dist/ digest; content scan and
//               notice check pass on each tarball and on the model-conv build context
//   1 acquire   docs/usage.md's AFHQ acquire block, verbatim: the checkpoint's SHA-256 matches the published value,
//               and the trusted-pickle warning comes before the first command in the doc
//   2 convert   the next block, verbatim, into a fresh out/afhqcat: image built from the clone (digest recorded),
//               convert, verify against the upstream PyTorch reference at the model's declared tolerance; the notice
//               check also reads the built image's Python licences
//   3 host      cloudflare-model-host's README and guides, verbatim, from the tarballs (its docs test), staging the
//               fresh conversion to a local HTTPS static server and checking MIME, CORS, cache and digest headers
//   4 manager   the non-face example's README block verbatim, then the manager-loaded variant in Chromium: authorize,
//               acquire, load, map seeds, synthesize; raw output within AFHQ cat's declared tolerance
//   5 caller    the caller-loaded variant: the same checks, and the manager module is never requested
//   6 morph     a morph through three seeds, frame count and latent shape from the descriptor, each seed's frame exact
//   7 export    PNG and lossless WebP reopen with exact latent, model identity and pixels; an equal-shaped latent of
//               another checkpoint is refused as mixed-model
//   8 network   intercepted requests: none at construction or status reads, no face detector or e4e request anywhere
// Exit 0 when every step passes, 1 otherwise.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? resolve(args[args.indexOf(name) + 1]) : null);
const tarballs = opt('--tarballs');
const clone = opt('--clone');
const out = opt('--out');
if (!tarballs || !clone || !out) {
  process.stderr.write(
    'usage: clean-consumer-smoke.mjs --tarballs <dir> --clone <clean clone> --out <dir> [--reference <dir>]\n',
  );
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const MC = join(clone, 'packages/model-conv');
const MODEL = join(MC, 'out/afhqcat');
const reference =
  opt('--reference') ??
  [join(MODEL, 'reference'), resolve('packages/model-conv/out/afhqcat/reference')].find((d) =>
    existsSync(d),
  );
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const git = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const tags = git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
const report = { commit, tags, clone, tarballs, started: new Date().toISOString(), steps: [] };

function record(n, name, fn) {
  const t0 = Date.now();
  let entry;
  try {
    const detail = fn();
    entry = { step: n, name, outcome: 'pass', seconds: (Date.now() - t0) / 1000, ...detail };
  } catch (error) {
    entry = {
      step: n,
      name,
      outcome: 'fail',
      seconds: (Date.now() - t0) / 1000,
      error: String(error.message ?? error),
    };
  }
  report.steps.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
  writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  return entry.outcome === 'pass';
}
const check = (cond, message) => {
  if (!cond) throw new Error(message);
};
/** Runs a command, logging to <out>/<log>; throws with the log's tail on failure. */
function run(cmd, cmdArgs, { cwd = clone, env = {}, log }) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  const text = `$ ${cmd} ${cmdArgs.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(join(out, log), text);
  if (r.status !== 0) throw new Error(`${log}: exit ${r.status}\n${text.slice(-3000)}`);
  return r.stdout;
}

// The model-conv usage doc: its verbatim blocks, and where the pickle warning sits.
const usage = readFileSync(join(MC, 'docs/usage.md'), 'utf8');
const blocks = [...usage.matchAll(/<!-- ci: verbatim -->\n```sh\n([\s\S]*?)```/g)].map((m) => ({
  code: m[1],
  at: m.index,
}));
const acquire = blocks.find((b) => b.code.includes('afhqcat.pkl') && !b.code.includes('docker'));
const convert = blocks.find((b) => b.code.includes('convert --model stylegan2-ada-afhqcat'));

const scans = (withImage) => {
  const results = {};
  const scan = (tool, profile, input, extra = []) => {
    const file = join(out, `${tool}-${profile}.json`);
    const r = spawnSync(
      process.execPath,
      [
        join(clone, `scripts/packages/${tool}.mjs`),
        '--profile',
        profile,
        '--input',
        input,
        '--report',
        file,
        ...extra,
      ],
      { encoding: 'utf8' },
    );
    results[`${tool} ${profile}`] = JSON.parse(readFileSync(file, 'utf8')).outcome;
    check(r.status === 0, `${tool} ${profile}: ${r.stdout.slice(-1500)}`);
  };
  if (!withImage) {
    for (const p of ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host']) {
      const version = JSON.parse(
        readFileSync(join(clone, 'packages', p, 'package.json'), 'utf8'),
      ).version;
      const tgz = join(tarballs, `${p}-${version}.tgz`);
      scan('check-tarball-contents', p, tgz);
      scan('check-notices', p, tgz);
    }
    scan('check-tarball-contents', 'model-conv-context', MC, ['--docker-context']);
    scan('check-notices', 'model-conv-context', MC);
  } else scan('check-notices', 'model-conv-context', MC, ['--image', withImage]);
  return results;
};

record(0, 'tarballs', () => {
  const tgz = ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host'].map((p) => {
    const version = JSON.parse(
      readFileSync(join(clone, 'packages', p, 'package.json'), 'utf8'),
    ).version;
    return join(tarballs, `${p}-${version}.tgz`);
  });
  run(
    process.execPath,
    [
      join(clone, 'scripts/packages/verify-provenance.mjs'),
      '--commit',
      commit,
      '--report',
      join(out, 'provenance.json'),
      ...tgz,
    ],
    {
      log: 'provenance.log',
    },
  );
  const provenance = JSON.parse(readFileSync(join(out, 'provenance.json'), 'utf8')).packages.map(
    (p) => ({
      name: p.name,
      version: p.version,
      integrity: p.integrity,
      sha256: p.sha256,
      distSha256: p.provenance.distSha256,
      build: p.provenance.build,
    }),
  );
  return { provenance, scans: scans(null) };
});

record(1, 'acquire', () => {
  check(acquire, 'docs/usage.md has no verbatim AFHQ acquire block');
  const warning = usage.indexOf('A checkpoint is a Python pickle, and loading one runs its code.');
  const firstFence = usage.indexOf('```sh');
  check(
    warning >= 0 && warning < firstFence,
    'the trusted-pickle warning does not precede the first command',
  );
  run('bash', ['-euo', 'pipefail', '-c', acquire.code], { log: 'step1-acquire.log' });
  const published =
    /echo "([0-9a-f]{64}) {2}\$HOME\/\.cache\/facemorph-model-conv\/checkpoints\/afhqcat\.pkl"/.exec(
      acquire.code,
    )[1];
  const actual = sha256(
    join(process.env.HOME, '.cache/facemorph-model-conv/checkpoints/afhqcat.pkl'),
  );
  check(actual === published, `checkpoint sha256 ${actual} is not the published ${published}`);
  return { checkpointSha256: actual, publishedSha256: published, warningBeforeCommands: true };
});

let image = null;
record(2, 'convert', () => {
  check(convert, 'docs/usage.md has no verbatim AFHQ convert block');
  rmSync(MODEL, { recursive: true, force: true });
  run('bash', ['-euo', 'pipefail', '-c', convert.code], { log: 'step2-convert.log' });
  image = execFileSync(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', 'facemorph/model-conv'],
    {
      encoding: 'utf8',
    },
  ).trim();
  const manifest = JSON.parse(readFileSync(join(MODEL, 'manifest.json'), 'utf8'));
  const verify = JSON.parse(readFileSync(join(MODEL, 'verify.json'), 'utf8'));
  check(verify.passed === true, 'verify.json did not pass');
  check(
    verify.manifestSha256 === sha256(join(MODEL, 'manifest.json')),
    'verify.json is for another manifest',
  );
  check(
    manifest.provenance.image === `facemorph/model-conv@${image}`,
    `manifest names ${manifest.provenance.image}, built ${image}`,
  );
  check(
    verify.maxRawAbsError <= verify.tolerance.rawFloat &&
      verify.maxRgbDifference <= verify.tolerance.rgb,
    'outside the declared tolerance',
  );
  return {
    image,
    manifestSha256: verify.manifestSha256,
    reference: verify.reference,
    tolerance: verify.tolerance,
    maxRawAbsError: verify.maxRawAbsError,
    maxRgbDifference: verify.maxRgbDifference,
    files: verify.files,
    imageNotices: scans('facemorph/model-conv'),
  };
});

/** Runs one of the clone's node:test files; requires every test to pass, allowing only the listed skips. */
function nodeTest(file, env, log, allowSkip = () => false) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    cwd: clone,
    env: { ...process.env, FACEMORPH_PACKED_TARBALLS: tarballs, FACEMORPH_AFHQ_CAT: MODEL, ...env },
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  const text = `${r.stdout}${r.stderr}`;
  writeFileSync(join(out, log), text);
  const count = (k) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(text)?.[1] ?? NaN);
  const skipped = [...text.matchAll(/^\s*ok \d+ - (.*) # SKIP(.*)$/gm)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
  const unexpected = skipped.filter((s) => !allowSkip(s));
  check(r.status === 0 && count('fail') === 0, `${file}: exit ${r.status}\n${text.slice(-3000)}`);
  check(unexpected.length === 0, `${file}: skipped ${JSON.stringify(unexpected)}`);
  return { pass: count('pass'), fail: count('fail'), skipped };
}

record(3, 'host', () =>
  nodeTest('packages/cloudflare-model-host/test/docs.test.ts', {}, 'step3-host.tap', (s) =>
    /needs a Cloudflare account and a test origin/.test(s),
  ),
);

const nonfaceReport = join(out, 'nonface.json');
let nonface = null;
const nonfaceRun = () => {
  if (nonface) return nonface;
  check(reference, 'no AFHQ cat reference directory');
  const tap = nodeTest(
    'packages/stylegan-js/test/engine/nonface-example.test.ts',
    {
      FACEMORPH_AFHQ_CAT_FRESH: '1',
      FACEMORPH_AFHQ_CAT_REFERENCE: reference,
      FACEMORPH_NONFACE_REPORT: nonfaceReport,
    },
    'steps4-8-nonface.tap',
  );
  nonface = { tap, report: JSON.parse(readFileSync(nonfaceReport, 'utf8')) };
  return nonface;
};
const inference = (variant) => {
  const { report: r, tap } = nonfaceRun();
  const v = r[variant];
  check(v?.load?.ok && v.run?.ok, `${variant}: the example did not load and run`);
  check(v.load.provider === 'cpu', `${variant}: provider ${v.load.provider}`);
  for (const e of v.referenceErrors)
    check(
      e.w <= v.tolerance.rawFloat && e.raw <= v.tolerance.rawFloat && e.rgb <= v.tolerance.rgb,
      `${variant} seed ${e.seed}: ${JSON.stringify(e)}`,
    );
  check(v.liveSessionsAfterDispose === 0, `${variant}: sessions left after dispose`);
  return {
    tests: tap,
    faces: v.run.faces.map((f) => ({ seed: f.seed, sha256: f.sha256 })),
    referenceErrors: v.referenceErrors,
    tolerance: v.tolerance,
  };
};

record(4, 'manager', () => {
  const d = inference('manager');
  const v = nonface.report.manager;
  check(
    v.requests.run.every((q) => q.hostClass === 'local'),
    'the manager-loaded run fetched from the network',
  );
  return d;
});
record(5, 'caller', () => {
  const d = inference('caller');
  check(
    nonface.report.caller.managerModuleRequests.length === 0,
    'the caller-loaded page requested the manager',
  );
  return { ...d, managerModuleRequests: 0 };
});
record(6, 'morph', () => {
  const { report: r } = nonfaceRun();
  return Object.fromEntries(
    ['manager', 'caller'].map((variant) => {
      const m = r[variant].run.morph;
      check(
        r[variant].run.faces.length >= 3 && m.endpoints.length >= 3,
        `${variant}: fewer than three inputs`,
      );
      check(
        m.status === 'complete' && m.written === m.totalFrames,
        `${variant}: morph ${m.status}`,
      );
      check(
        m.endpoints.every((e) => e.latentExact && e.maxRgb === 0),
        `${variant}: a seed frame is not exact`,
      );
      check(
        r[variant].run.faces.every((f) => f.width === 512 && f.height === 512),
        `${variant}: not the descriptor's 512 px`,
      );
      return [variant, { inputs: m.endpoints.length, frames: m.totalFrames, branch: m.branch }];
    }),
  );
});
record(7, 'export', () => {
  const { report: r } = nonfaceRun();
  return Object.fromEntries(
    ['manager', 'caller'].map((variant) => {
      const { exports, combine } = r[variant].run;
      for (const e of exports)
        check(
          e.kind === 'parsed' &&
            e.schemaVersion === 3 &&
            e.latentExact &&
            e.modelExact &&
            e.pixelsExact,
          `${variant} ${e.mime}: ${JSON.stringify(e)}`,
        );
      check(
        exports.map((e) => e.mime).join() === 'image/png,image/webp',
        `${variant}: exports ${exports.map((e) => e.mime)}`,
      );
      check(
        combine.sameModel.ok &&
          !combine.otherCheckpoint.ok &&
          combine.otherCheckpoint.code === 'mixed-model',
        `${variant}: ${JSON.stringify(combine)}`,
      );
      return [
        variant,
        {
          exports: exports.map((e) => ({ mime: e.mime, bytes: e.bytes })),
          otherCheckpoint: combine.otherCheckpoint.code,
        },
      ];
    }),
  );
});
record(8, 'network', () => {
  const { report: r } = nonfaceRun();
  return Object.fromEntries(
    ['manager', 'caller'].map((variant) => {
      const v = r[variant];
      check(v.requests.construct.length === 0, `${variant}: requests at construction/status`);
      check(
        v.photoPipelineRequests.length === 0,
        `${variant}: detector/e4e requests ${JSON.stringify(v.photoPipelineRequests)}`,
      );
      return [
        variant,
        {
          construct: 0,
          detectorOrE4e: 0,
          photoDigestsChecked: v.photoDigestsChecked,
          total: v.requests.total,
        },
      ];
    }),
  );
});

report.finished = new Date().toISOString();
report.outcome = report.steps.every((s) => s.outcome === 'pass') ? 'pass' : 'fail';
writeFileSync(join(out, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ event: 'clean-consumer-smoke', commit, tags, outcome: report.outcome })}\n`,
);
process.exitCode = report.outcome === 'pass' ? 0 : 1;
