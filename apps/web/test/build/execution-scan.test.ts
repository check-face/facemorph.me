// Built-artifact WebGL/native scan (fm-fy2.19): real staged artifacts (stageBuilt writes the destination identity),
// a planted WebGL execution path and a planted native recommendation fail, the label decision is a plain value,
// and the actual build:next artifact scans clean where it exists (native-retirement lane requires it).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- build-next.mjs has no declarations; stageBuilt is called as build:next calls it
import { stageBuilt } from '../../../../scripts/import/build-next.mjs';
import { decide, scanArtifact } from '../../build/execution-scan.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

function staged(asset: string): { out: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'fm-exec-scan-'));
  const built = join(root, 'built');
  mkdirSync(join(built, 'assets'), { recursive: true });
  writeFileSync(
    join(built, 'index.html'),
    '<!doctype html><script type="module" src="/assets/a.js"></script>',
  );
  writeFileSync(join(built, 'assets/a.js'), asset);
  const out = join(root, 'out');
  stageBuilt({
    out,
    built,
    source: { commit: '0'.repeat(40), sourceTreeSha256: '0'.repeat(64), sourceTreeClean: true },
  });
  return { out, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a clean destination artifact passes; planted WebGL execution and native recommendation fail', () => {
  // manifest.webgl is the direct WebGPU engine's coefficient bundle; naming it is not WebGL execution.
  const clean = staged('const c=canvas.getContext(`webgpu`);const b=manifest.webgl;');
  const webgl = staged(
    'const gl=canvas.getContext(`webgl2`);ort.InferenceSession.create(m,{executionProviders:[`webgl`]});',
  );
  const native = staged(
    'if(globalThis.__TAURI__)alert("Install the desktop app for native CPU processing");',
  );
  try {
    assert.deepEqual(scanArtifact(clean.out), { decision: { action: 'scan' }, findings: [] });
    const w = scanArtifact(webgl.out).findings;
    assert.equal(w.length, 2, w.join('\n'));
    assert.ok(w.every((f) => f.startsWith('assets/a.js: WebGL execution')));
    const n = scanArtifact(native.out).findings;
    assert.equal(n.length, 3, n.join('\n'));
    assert.ok(n.every((f) => f.startsWith('assets/a.js: native recommendation')));
  } finally {
    for (const s of [clean, webgl, native]) s.done();
  }
});

test('the control-labelled artifact is skipped with a reason; unknown or inconsistent identity fails closed', () => {
  assert.deepEqual(decide({ label: 'destination' }, []), { action: 'scan' });
  const control = decide(
    { label: 'control (classic candidate build; not built by this repository)' },
    [],
  );
  assert.equal(control.action, 'skip');
  assert.match((control as { reason: string }).reason, /control fact/);
  assert.equal(decide({ label: 'preview' }, []).action, 'fail');
  assert.equal(decide(null, [{ problem: 'no next-site-identity.json' }]).action, 'fail');
  assert.equal(
    decide({ label: 'destination' }, [{ path: 'x', problem: 'mismatch' }]).action,
    'fail',
  );
});

test('the actual build:next artifact has no WebGL execution and no native recommendation', (t) => {
  if (!existsSync(join(REPO, 'next-site-identity.json'))) {
    if (process.env['FACEMORPH_REQUIRE_ARTIFACT'])
      assert.fail('FACEMORPH_REQUIRE_ARTIFACT is set but build:next has not run');
    return t.skip(
      'untested here: run `npm run build:next` first (the native-retirement lane does)',
    );
  }
  const { decision, findings } = scanArtifact(REPO);
  if (decision.action === 'skip') t.diagnostic(decision.reason);
  assert.deepEqual(findings, []);
});
