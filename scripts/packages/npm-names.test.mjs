// npm name check (fm-tohj) against a fake registry: no network, the same decision code the CI step runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNames, main, PACKAGES } from './npm-names.mjs';

const REG = 'https://registry.example';
const json = (status, body) => ({ status, json: async () => body });

// routes: path -> response factory; unlisted paths 404 like a free name. Records every request.
function fakeRegistry(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method });
    const path = url.slice(REG.length);
    const route = routes[path];
    if (route) return route();
    return json(404, { error: 'Not found' });
  };
  return { fetchImpl, calls };
}
const scoped = (n) => `@facemorph-me/${n}`;
const names = (map) => (working) => map[working] ?? working;
const run = async (fake, readName, argv = ['--json']) => {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, {
    fetchImpl: fake.fetchImpl,
    registry: REG,
    readName,
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
  });
  return { code, stdout, stderr, report: argv.includes('--json') ? JSON.parse(stdout) : null };
};

test('all working names available: the unscoped working names are chosen and match', async () => {
  const fake = fakeRegistry();
  const { code, report } = await run(fake, names({}));
  assert.equal(code, 0);
  assert.equal(report.outcome, 'match');
  assert.deepEqual(
    report.packages.map((p) => p.chosen),
    PACKAGES,
  );
  for (const p of report.packages) {
    assert.deepEqual(
      p.candidates.map((c) => [c.name, c.status]),
      [[p.workingName, 'available']],
    );
  }
  // Read-only: only GETs, and no scope lookup when no fallback is needed.
  assert.ok(fake.calls.every((c) => c.method === 'GET'));
  assert.ok(!fake.calls.some((c) => c.url.includes('/-/org/')));
});

test('a taken working name falls back to the operator scope, never another unscoped name', async () => {
  const fake = fakeRegistry({
    '/browser-model-manager': () =>
      json(200, {
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { repository: { url: 'git+https://github.com/someone/else.git' } } },
      }),
    '/-/org/facemorph-me/package': () => json(200, {}),
  });
  const { code, report } = await run(
    fake,
    names({ 'browser-model-manager': scoped('browser-model-manager') }),
  );
  assert.equal(code, 0);
  const bmm = report.packages.find((p) => p.workingName === 'browser-model-manager');
  assert.equal(bmm.chosen, '@facemorph-me/browser-model-manager');
  assert.deepEqual(
    bmm.candidates.map((c) => [c.name, c.status]),
    [
      ['browser-model-manager', 'taken'],
      ['@facemorph-me/browser-model-manager', 'available'],
    ],
  );
  assert.equal(report.operatorScope.status, 'exists');
  assert.ok(fake.calls.some((c) => c.url === `${REG}/@facemorph-me%2fbrowser-model-manager`));
  // The other two keep their unscoped working names.
  assert.deepEqual(
    report.packages.filter((p) => p !== bmm).map((p) => p.chosen),
    ['stylegan-js', 'cloudflare-model-host'],
  );
});

test("a working name already published from this project's repository stays chosen", async () => {
  const fake = fakeRegistry({
    '/stylegan-js': () =>
      json(200, {
        'dist-tags': { latest: '0.1.0' },
        versions: {
          '0.1.0': { repository: 'git+https://github.com/facemorph-me/facemorph.me.git' },
        },
      }),
  });
  const { code, report } = await run(fake, names({}));
  assert.equal(code, 0);
  assert.equal(report.packages[0].candidates[0].status, 'own');
  assert.equal(report.packages[0].chosen, 'stylegan-js');
});

test('a registry error exits 2 and is never read as available', async () => {
  const fake = fakeRegistry({ '/cloudflare-model-host': () => json(503, null) });
  const { code, report, stderr } = await run(fake, names({}));
  assert.equal(code, 2);
  assert.equal(report.outcome, 'error');
  const cmh = report.packages.find((p) => p.workingName === 'cloudflare-model-host');
  assert.equal(cmh.candidates[0].status, 'error');
  assert.equal(cmh.chosen, null);
  assert.equal(cmh.match, false);
  assert.match(stderr, /ERROR registry error for cloudflare-model-host/);
});

test('a network failure or timeout exits 2', async () => {
  const fetchImpl = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const report = await checkNames({ fetchImpl, registry: REG, readName: names({}) });
  assert.equal(report.exitCode, 2);
  assert.ok(report.packages.every((p) => p.candidates[0].status === 'error' && p.chosen === null));
});

test('a taken name with the operator scope missing exits 2 rather than choosing anything', async () => {
  const fake = fakeRegistry({
    '/stylegan-js': () => json(200, { 'dist-tags': { latest: '9.0.0' }, versions: {} }),
    '/-/org/facemorph-me/package': () => json(404, { error: 'Scope not found' }),
  });
  const { code, report } = await run(fake, names({}));
  assert.equal(code, 2);
  assert.equal(report.packages[0].chosen, null);
  assert.match(report.packages[0].error, /@facemorph-me does not exist/);
});

test('a mismatch exits 1 and names the rename', async () => {
  const fake = fakeRegistry();
  const { code, report, stderr } = await run(fake, (w) => `@facemorph/${w}`);
  assert.equal(code, 1);
  assert.equal(report.outcome, 'mismatch');
  const sg = report.packages[0];
  assert.equal(sg.match, false);
  assert.equal(
    sg.rename,
    'packages/stylegan-js/package.json name @facemorph/stylegan-js -> stylegan-js',
  );
  assert.match(
    stderr,
    /RENAME packages\/stylegan-js\/package\.json name @facemorph\/stylegan-js -> stylegan-js/,
  );
});

test('an unknown argument is a usage error (exit 2) with no registry call', async () => {
  const fake = fakeRegistry();
  const { code } = await run(fake, names({}), ['--bogus']);
  assert.equal(code, 2);
  assert.equal(fake.calls.length, 0);
});
