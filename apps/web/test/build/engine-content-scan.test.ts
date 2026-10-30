// No engine code in the app (fm-fy2.6, compute.app-rebind): a scripted scan of every module under apps/web/src for
// what only stylegan-js may do: create or run ONNX sessions, build ORT tensors, compile WGSL or GL
// programs for synthesis, or fetch and cache model weights outside the browser model manager. The few hits that
// remain are named below with the reason they are not a second engine; anything else fails.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(WEB, 'src');

/** What the engine does, and only the engine. */
const ENGINE: readonly { name: string; re: RegExp }[] = [
  { name: 'ORT session', re: /InferenceSession\s*\.\s*create\s*\(/ },
  { name: 'ORT tensor', re: /new\s+(?:ort|onnx|encoderOrt)\s*\.\s*Tensor\s*\(/ },
  { name: 'WGSL program', re: /createShaderModule\s*\(|createComputePipeline(?:Async)?\s*\(/ },
  { name: 'GL program', re: /\.createProgram\s*\(|#version 300 es/ },
  {
    name: 'model cache',
    re: /createBrowserModelCache|acquireUncachedBytes|caches\s*\.\s*open\s*\(/,
  },
  { name: 'OPFS model file', re: /navigator\s*\.\s*storage\s*\.\s*getDirectory\s*\(/ },
];

/** Each allowed hit: the file, the pattern, and why it is not engine code duplicated in the app. */
const ALLOW: readonly { file: string; name: string; why: string }[] = [
  {
    file: 'Next/browser/fused-resample-v1.mjs',
    name: 'WGSL program',
    why: 'the pinned staged runtime asset (runtime manifest digest, stage-assets.py); no app module imports it, and the package kernel is held equal to it by stylegan-js routes.test',
  },
  {
    file: 'Next/browser/webgl-vector-v1.mjs',
    name: 'GL program',
    why: 'the pinned staged runtime asset of the classic WebGL route (runtime manifest digest); WebGL execution is removed and no app module imports it',
  },
  ...(['ORT session', 'ORT tensor'] as const).map((name) => ({
    file: 'Next/browser/webgl-vector-v1.mjs',
    name,
    why: 'the same staged WebGL asset: its mapping half runs ORT inside the removed WebGL route, never loaded by the app',
  })),
  ...['preflight/gpu-sample.ts', 'preflight/types.ts'].map((file) => ({
    file,
    name: 'WGSL program',
    why: 'the model-free preflight checker (fm-ze4u): a synthetic strided multiply/add sample with generated data, no model, encoder or canary',
  })),
  {
    file: 'Next/browser/model-source.mjs',
    name: 'model cache',
    why: "the worker's model source over the browser model manager (createBrowserModelCache / acquireUncachedBytes are the manager's)",
  },
  {
    file: 'Next/video-worker.mjs',
    name: 'model cache',
    why: 'the video worker reads codec assets through the browser model manager',
  },
  {
    file: 'Next/product-bridge.mjs',
    name: 'model cache',
    why: "storage inventory and eviction through the browser model manager's cache (app retention, not acquisition)",
  },
  {
    file: 'Next/photo/selection-worker.mjs',
    name: 'model cache',
    why: 'the face detector reads the landmark model photo setup saved through the browser model manager, under a grant that transfers nothing (fm-3xjm)',
  },
  {
    file: 'Next/photo/selection-worker.mjs',
    name: 'OPFS model file',
    why: 'the face detector (dlib landmarks) caches its own pinned landmark model; detection is the photo proposal step, not the StyleGAN engine',
  },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|mjs|js)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name) ? [path] : [];
  });
}

const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');

export function engineHits(root = SRC): { file: string; name: string }[] {
  const hits: { file: string; name: string }[] = [];
  for (const path of files(root)) {
    const text = code(readFileSync(path, 'utf8'));
    for (const p of ENGINE)
      if (p.re.test(text)) hits.push({ file: relative(root, path), name: p.name });
  }
  return hits;
}

test('engine content scan: apps/web/src holds no engine code beyond the named staged assets and manager reads', () => {
  const unexplained = engineHits().filter(
    (h) => !ALLOW.some((a) => a.file === h.file && a.name === h.name),
  );
  assert.deepEqual(unexplained, []);
});

test('engine content scan: every allowance still matches, and the staged kernel sources are imported by nothing', () => {
  const hits = engineHits();
  for (const a of ALLOW)
    assert.ok(
      hits.some((h) => h.file === a.file && h.name === a.name),
      `stale allowance: ${a.file} (${a.name})`,
    );
  const importers = files(SRC).filter((path) =>
    /from\s*['"][^'"]*(?:fused-resample-v1|webgl-vector-v1)\.mjs['"]|import\(\s*['"][^'"]*(?:fused-resample-v1|webgl-vector-v1)/.test(
      readFileSync(path, 'utf8'),
    ),
  );
  assert.deepEqual(
    importers.map((p) => relative(SRC, p)),
    [],
  );
});

test('engine content scan: a planted session, tensor or weight fetch-and-cache in an app module is caught', () => {
  const planted = [
    'const s=await ort.InferenceSession.create(bytes,{executionProviders:["wasm"]});',
    'const t=new ort.Tensor("float32",x,[1,512]);',
    'const c=await caches.open("model");',
    'const root=await navigator.storage.getDirectory();',
  ];
  for (const line of planted)
    assert.ok(
      ENGINE.some((p) => p.re.test(code(line))),
      `not caught: ${line}`,
    );
  assert.equal(
    ENGINE.some((p) => p.re.test(code('// ort.InferenceSession.create is the package’s job'))),
    false,
  );
});
