// Structural/fault checks only: these tests do not launch a browser, device, model or GPU.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { abbaSchedule } from '../../scripts/verify/not-worse/workload.ts';
import {
  METRICS,
  assertEngineManifest,
  PAGE,
  processRss,
  requireIsolation,
  rewrittenManifest,
  runtimePath,
  sha,
  serveHttps,
  summarizeRuns,
  validateNoise,
  validateNumerics,
  verifyRuntime,
  workloadFor,
} from './paired.mjs';

const temp = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ort-paired-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const put = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return {
    url: `https://next.facemorph.me/runtime/${path}`,
    sha256: sha(bytes),
    size: Buffer.byteLength(bytes),
  };
};
function graph(t) {
  const root = temp(t);
  const a = put(root, 'chunks/a.bin', Buffer.from('one'));
  const b = put(root, 'chunks/b.bin', Buffer.from('two'));
  const whole = {
    url: 'https://next.facemorph.me/runtime/assets/whole/model.onnx',
    sha256: sha('onetwo'),
    size: 6,
    chunks: [a, b],
  };
  const module = put(root, 'ort.mjs', 'export const version=1;');
  const nested = put(root, 'nested/manifest.json', JSON.stringify({ asset: module }));
  const point = new Float32Array(18 * 512).fill(0.25);
  const w = put(root, 'canary/w.f32', Buffer.from(point.buffer));
  const manifest = {
    runtime: { assets: [module] },
    webgpu: { runtime: { module } },
    synthesis: whole,
    nested,
    canaries: Array.from({ length: 7 }, (_, i) => ({ name: `case-${i}`, w })),
  };
  const bytes = JSON.stringify(manifest);
  writeFileSync(join(root, 'manifest.json'), bytes);
  return { root, manifest, sha256: sha(bytes), a, b, module, nested };
}

test('real HTTPS transport retains pinned asset identity and removes its task certificate', async (t) => {
  const parent = temp(t);
  const body = Buffer.from('real TLS fixture bytes');
  const expected = {
    url: 'https://next.facemorph.me/runtime/assets/fixture.bin',
    sha256: sha(body),
    size: body.length,
  };
  const requested = [];
  const transport = await serveHttps((req, res) => {
    requested.push(req.url);
    res
      .writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
      .end(body);
  }, parent);
  try {
    assert.equal(new URL(transport.origin).protocol, 'https:');
    assert.match(transport.certificateSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      readdirSync(parent).length,
      1,
      'task-owned certificate directory exists during serving',
    );
    const manifest = rewrittenManifest({ asset: expected }, transport.origin);
    assert.deepEqual(manifest.asset, {
      ...expected,
      url: `${transport.origin}/runtime/assets/fixture.bin`,
    });
    const received = await new Promise((resolve, reject) => {
      get(manifest.asset.url, { rejectUnauthorized: false }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
    assert.equal(sha(received), expected.sha256);
    assert.equal(received.length, expected.size);
    assert.deepEqual(requested, ['/runtime/assets/fixture.bin']);
    assert.throws(
      () => rewrittenManifest({ asset: expected }, 'http://127.0.0.1:1234'),
      /must be HTTPS/,
    );
    assert.throws(
      () => rewrittenManifest({ asset: expected }, 'https://user:pass@127.0.0.1:1234'),
      /without credentials/,
    );
  } finally {
    await transport.stop();
  }
  assert.deepEqual(readdirSync(parent), [], 'task certificate and key cleaned after stop');
});

test('independent graph checks nested assets and chunked whole without frozen asset rows', async (t) => {
  const g = graph(t),
    r = await verifyRuntime(g.root, g.sha256);
  assert.equal(r.files.size, 5);
  assert.equal(r.manifestSha256, g.sha256);
  const workload = workloadFor(r);
  assert.equal(workload.latents.length, 32);
  assert.equal(workload.latents[0].length, 9216);
  assert.deepEqual(workload.identity, {
    frames: 32,
    fps: 16,
    width: 1024,
    height: 1024,
    algorithm: 'linear W+ endpoints, inclusive, Float32; no pacing',
    inputs: [g.manifest.canaries[0].w.sha256, g.manifest.canaries[1].w.sha256],
    latentsSha256: workload.identity.latentsSha256,
  });
  assert.match(workload.identity.latentsSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(workload.runtimePaths, ['ort.mjs']);
});

test('wrong root digest, absent nested file, altered part and incorrect whole are rejected', async (t) => {
  const g = graph(t);
  await assert.rejects(verifyRuntime(g.root, '0'.repeat(64)), /manifest digest mismatch/);
  const file = join(g.root, 'ort.mjs');
  const saved = readFileSync(file);
  writeFileSync(file, 'broken');
  await assert.rejects(verifyRuntime(g.root, g.sha256), /size mismatch/);
  writeFileSync(file, saved);
  writeFileSync(join(g.root, 'chunks/a.bin'), 'bad');
  await assert.rejects(verifyRuntime(g.root, g.sha256), /digest mismatch/);
  writeFileSync(join(g.root, 'chunks/a.bin'), 'one');
  g.manifest.synthesis.sha256 = '0'.repeat(64);
  const bytes = JSON.stringify(g.manifest);
  writeFileSync(join(g.root, 'manifest.json'), bytes);
  await assert.rejects(verifyRuntime(g.root, sha(bytes)), /chunked whole/);
  rmSync(file);
  await assert.rejects(verifyRuntime(g.root, sha(bytes)));
});

test('runtime URLs cannot escape the local runtime namespace', () => {
  assert.equal(runtimePath('https://x/runtime/assets/a.mjs'), 'assets/a.mjs');
  for (const url of [
    'http://x/runtime/a',
    'https://x/runtime/../private',
    'https://x/runtime/a/../private',
    'https://x/runtime/%2e%2e/private',
    'https://x/runtime/a?token=secret',
    'https://x/runtime/a#hash',
    'https://user:pass@x/runtime/a',
  ])
    assert.throws(() => runtimePath(url));
});

test('chunked JSON descriptor also verifies assets named inside its reconstructed body', async (t) => {
  const g = graph(t);
  const missing = {
    url: 'https://next.facemorph.me/runtime/absent.bin',
    sha256: sha('absent'),
    size: 6,
  };
  const bytes = Buffer.from(JSON.stringify({ asset: missing }));
  const part = put(g.root, 'chunks/descriptor.bin', bytes);
  g.manifest.descriptor = {
    url: 'https://next.facemorph.me/runtime/descriptor.json',
    sha256: sha(bytes),
    size: bytes.length,
    chunks: [part],
  };
  const body = JSON.stringify(g.manifest);
  writeFileSync(join(g.root, 'manifest.json'), body);
  await assert.rejects(verifyRuntime(g.root, sha(body)), /ENOENT/);
});

function receiptFixture() {
  const identity = {
    harnessSha256: sha('harness'),
    runtimeSupportSha256: sha('support'),
    distSha256: sha('dist'),
    pinnedSuiteSha256: sha('pinned'),
  };
  const browser = {
    version: 'Chrome-test',
    executableSha256: sha('browser'),
    launchTargetSha256: sha('launch'),
  };
  const side = { manifestSha256: sha('manifest'), engine: 'native' };
  const pinned = { cases: Array.from({ length: 31 }, (_, i) => ({ name: `frame-${i}` })) };
  const cell = {
    requested: { engine: 'ort-webgpu', route: 'webgpu', provider: 'webgpu' },
    actual: { engine: 'ort-webgpu', route: 'webgpu', provider: 'webgpu' },
    browser,
    adapter: { fallback: false },
    passed: true,
    cases: pinned.cases.map((c) => ({ ...c, maxRgb: 1, maxFloat: 0.00001, passed: true })),
  };
  const receipt = {
    schema: 'facemorph.full31-numerics/1',
    manifestSha256: side.manifestSha256,
    identity: { ...identity, suiteSha256: sha('acquired') },
    thresholds: { maxRgb: 1, maxFloat: 0.002 },
    passed: true,
    cells: [cell],
  };
  return { identity, browser, side, pinned, receipt };
}

test('prior gate binds runtime, exact dist/harness/browser and all31 unchanged checks', () => {
  const f = receiptFixture();
  assert.equal(
    validateNumerics(f.receipt, f.side, f.identity, f.browser, f.pinned),
    f.receipt.cells[0],
  );
  const mutations = [
    (r) => {
      r.manifestSha256 = sha('other');
    },
    (r) => {
      r.identity.distSha256 = sha('other');
    },
    (r) => {
      r.identity.runtimeSupportSha256 = sha('other');
    },
    (r) => {
      r.cells[0].browser.version = 'other';
    },
    (r) => {
      r.cells[0].browser.launchTargetSha256 = sha('other');
    },
    (r) => {
      r.cells[0].adapter.fallback = true;
    },
    (r) => {
      r.cells[0].actual.engine = 'direct-webgpu';
    },
    (r) => {
      r.cells[0].cases.pop();
    },
    (r) => {
      r.cells[0].cases[0].maxRgb = 2;
    },
    (r) => {
      r.cells[0].cases[0].maxFloat = 0.002001;
    },
    (r) => {
      r.cells[0].cases[0].maxFloat = null;
    },
    (r) => {
      r.cells[0].cases[0].name = 'other';
    },
    (r) => {
      r.thresholds.maxFloat = 0.003;
    },
    (r) => {
      r.passed = false;
    },
    (r) => {
      r.cells[0].passed = false;
    },
  ];
  for (const mutate of mutations) {
    const r = structuredClone(f.receipt);
    mutate(r);
    assert.throws(() => validateNumerics(r, f.side, f.identity, f.browser, f.pinned));
  }
});

test('the pinned JSEP control cannot be reported as a native EP runtime', () => {
  const manifest = {
    webgpu: { runtime: { factory: { url: 'https://x/runtime/ort-wasm-simd-threaded.jsep.mjs' } } },
  };
  assert.doesNotThrow(() => assertEngineManifest('ort', manifest));
  assert.throws(() => assertEngineManifest('native', manifest), /JSEP control/);
  for (const build of ['asyncify', 'jspi']) {
    manifest.webgpu.runtime.factory.url = `https://x/runtime/ort-wasm-simd-threaded.${build}.mjs`;
    assert.doesNotThrow(() => assertEngineManifest('native', manifest));
  }
});

test('isolation requires current run.py identity, GPU or CPU lock, and declared lowload', () => {
  const env = {
    FACEMORPH_EXCLUSIVE: 'cpu-timing',
    FACEMORPH_RUN: 'actualrun',
    FACEMORPH_LOCK_DIR: '/tmp/shared-locks',
  };
  assert.equal(requireIsolation(['cpu'], 2, env, [1, 1, 1]).exclusive, 'cpu-timing');
  assert.throws(() => requireIsolation(['native'], 2, env, [1, 1, 1]), /gpu-timing/);
  assert.throws(() => requireIsolation(['cpu'], 2, env, [3, 1, 1]), /exceeds/);
  assert.throws(() => requireIsolation(['cpu'], 2, { ...env, FACEMORPH_RUN: '' }, [1, 1, 1]));
  assert.throws(() =>
    requireIsolation(['cpu'], 2, { ...env, FACEMORPH_LOCK_DIR: 'relative' }, [1, 1, 1]),
  );
  assert.equal(
    requireIsolation(
      ['native', 'direct'],
      2,
      { ...env, FACEMORPH_EXCLUSIVE: 'gpu-timing' },
      [1, 1, 1],
    ).exclusive,
    'gpu-timing',
  );
});

test('RSS follows descendants lacking profile argv and excludes unrelated peer processes', () => {
  const rows = [
    { pid: 10, ppid: 1, rss: 100, cmdline: 'chrome --user-data-dir=/tmp/unique-profile' },
    { pid: 11, ppid: 10, rss: 200, cmdline: 'renderer' },
    { pid: 12, ppid: 11, rss: 300, cmdline: 'worker' },
    { pid: 20, ppid: 1, rss: 900, cmdline: 'peer chrome --user-data-dir=/tmp/other' },
  ];
  assert.equal(processRss(rows, '/tmp/unique-profile'), 600);
  assert.equal(processRss(rows, '/tmp/absent'), 0);
});

const rawRuns = () => [
  { side: 'control', warmup: true },
  { side: 'build', warmup: true },
  ...abbaSchedule(6)
    .filter((r) => r.pair !== null)
    .map((r) => ({ ...r, warmup: false, ...Object.fromEntries(METRICS.map((k) => [k, 100])) })),
];
test('freeze noise from sixABBApairs, then apply existing ratio interval math', () => {
  const runs = rawRuns(),
    noise = summarizeRuns(runs);
  for (const k of METRICS) {
    assert.equal(noise[k].pairs.length, 6);
    assert.equal(noise[k].margin, 0);
  }
  const passing = summarizeRuns(runs, noise);
  assert.ok(Object.values(passing).every((v) => v.verdict === 'passed'));
  for (const r of runs.filter((r) => r.side === 'build' && !r.warmup)) r.warmMsPerFrame = 120;
  assert.equal(summarizeRuns(runs, noise).warmMsPerFrame.verdict, 'failed');
  assert.throws(() => summarizeRuns(runs.slice(1)), /warmups/);
  const swapped = rawRuns();
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  assert.throws(() => summarizeRuns(swapped), /ABBA/);
  assert.throws(
    () => summarizeRuns(runs, { ...noise, coldStartMs: { margin: null } }),
    /invalid frozen/,
  );
});

test('embedded browser module parses as JavaScript without executing it', () => {
  const module = PAGE.split('<script type="module">')[1].split('</script>')[0];
  // Function parsing after removing static imports checks the served program's syntax only.
  assert.doesNotThrow(() => new Function(module.replace(/^import .*;$/gm, '')));
});

test('noise receipt binds runtime and engine identity, not merely the package artifact', () => {
  const report = {
    schema: 'facemorph.ort-paired/1',
    cell: { host: 'samehost', browser: 'samebinary', workload: 'same32' },
    control: { manifestSha256: sha('control'), engine: 'cpu' },
  };
  const runs = rawRuns();
  const noise = {
    ...report,
    mode: 'noise',
    passed: true,
    build: { ...report.control },
    runs,
    metrics: summarizeRuns(runs),
  };
  assert.deepEqual(validateNoise(noise, report), noise.metrics);
  const mutations = [
    (n) => {
      n.control.manifestSha256 = sha('changed');
    },
    (n) => {
      n.control.engine = 'native';
    },
    (n) => {
      n.build.manifestSha256 = sha('candidate');
    },
    (n) => {
      n.cell.browser = 'changed';
    },
    (n) => {
      n.metrics.coldStartMs.margin = 0.5;
    },
    (n) => {
      n.runs.pop();
    },
  ];
  for (const mutate of mutations) {
    const n = structuredClone(noise);
    mutate(n);
    assert.throws(() => validateNoise(n, report));
  }
});
