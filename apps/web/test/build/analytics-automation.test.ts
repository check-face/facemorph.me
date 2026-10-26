// fm-szbf: product analytics has a test-build-only automation opt-in (FACEMORPH_ANALYTICS_ALLOW_AUTOMATION=1 at build
// time). The default build, which is the shipped site, must still refuse under navigator.webdriver: its define is
// '' unless the variable is exactly '1', and the module outside a build keeps the refusal.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error untyped .mjs module
import { ALLOW_AUTOMATION, allowed, HOST } from '../../src/Next/analytics.mjs';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const KEY = 'import.meta.env.FACEMORPH_ANALYTICS_ALLOW_AUTOMATION';

function defineWith(value: string | undefined): unknown {
  const env = { ...process.env };
  delete env['FACEMORPH_ANALYTICS_ALLOW_AUTOMATION'];
  if (value !== undefined) env['FACEMORPH_ANALYTICS_ALLOW_AUTOMATION'] = value;
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(new URL('vite.config.ts', `file://${WEB}/`).href)}); process.stdout.write(JSON.stringify(m.default.define[${JSON.stringify(KEY)}]));`,
    ],
    { cwd: WEB, env, encoding: 'utf8' },
  );
  return JSON.parse(out);
}

test('the default build defines the analytics automation opt-in as empty; only exactly "1" sets it', () => {
  assert.equal(
    defineWith(undefined),
    '""',
    'env unset: the shipped build refuses under automation',
  );
  assert.equal(defineWith('true'), '""');
  assert.equal(defineWith('0'), '""');
  assert.equal(defineWith('1'), '"1"');
});

test('outside a test build, analytics refuses under webdriver; the opt-in lifts only that refusal', () => {
  const env = (navigator: object) => ({
    location: { hostname: HOST, protocol: 'https:' },
    navigator,
  });
  assert.equal(ALLOW_AUTOMATION, false);
  assert.equal(allowed(env({ webdriver: true })), false);
  assert.equal(allowed(env({ webdriver: true }), { allowAutomation: true }), true);
  assert.equal(
    allowed(env({ webdriver: true, globalPrivacyControl: true }), { allowAutomation: true }),
    false,
  );
  assert.equal(
    allowed(env({ webdriver: true, doNotTrack: '1' }), { allowAutomation: true }),
    false,
  );
});
