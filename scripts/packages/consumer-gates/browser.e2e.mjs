import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withBrowserPage } from './browser.mjs';

test('native HTTPS browser cleanup releases connections on callback success and failure', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-cleanup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const fail of [false, true]) {
    await t.test(fail ? 'callback failure retains evidence' : 'callback success', async () => {
      const evidenceDir = join(root, fail ? 'failure' : 'success');
      const expected = Error('Planted callback failure');
      let browser, origin;
      const operation = withBrowserPage({ outDir: root, evidenceDir }, async (session) => {
        ({ browser, origin } = session);
        await session.context.route(/^https?:\/\//, (route) => route.continue());
        await session.page.goto(origin + '/');
        assert.equal(await session.page.title(), 'Packed consumer browser gate');
        if (fail) throw expected;
        return 'callback result';
      });
      if (fail) {
        await assert.rejects(operation, (error) => error === expected);
        const evidence = JSON.parse(readFileSync(join(evidenceDir, 'failure.json'), 'utf8'));
        assert.match(evidence.error, /Planted callback failure/);
        assert.deepEqual(evidence.cleanupErrors, []);
        assert.ok(readFileSync(join(evidenceDir, 'failure.zip')).length > 0);
      } else {
        assert.equal(await operation, 'callback result');
      }
      assert.equal(browser.isConnected(), false, 'Task-owned browser must have exited');
      const cleanup = JSON.parse(readFileSync(join(evidenceDir, 'browser-cleanup.json'), 'utf8'));
      assert.ok(cleanup.exitCode !== null || cleanup.signalCode !== null);
      assert.throws(() => process.kill(cleanup.pid, 0), { code: 'ESRCH' });
      await assert.rejects(fetch(origin), /fetch failed/);
    });
  }
});
