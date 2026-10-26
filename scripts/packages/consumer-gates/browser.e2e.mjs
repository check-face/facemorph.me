import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withBrowserPage } from './browser.mjs';

test('native HTTPS browser cleanup releases connections on callback success and failure', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-cleanup-test-'));
  t.after(() => {
    cpSync(root, join(process.cwd(), 'test-results/package-gates/native-cleanup'), {
      recursive: true,
    });
    rmSync(root, { recursive: true, force: true });
  });
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

test('tree-signal failure still terminates the exact browser owner within the existing bound', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-direct-kill-test-'));
  const signal = process.kill;
  let pid,
    groupAttempted = false,
    directAttempted = false;
  t.after(() => {
    process.kill = signal;
    // If the planted group-signal error left descendants, release only our group.
    if (pid) {
      try {
        signal(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    cpSync(root, join(process.cwd(), 'test-results/package-gates/native-direct-kill'), {
      recursive: true,
    });
    rmSync(root, { recursive: true, force: true });
  });
  await withBrowserPage({ outDir: root, evidenceDir: root }, async (session) => {
    pid = session.browserServer.process().pid;
    // A real native owner, a stalled graceful close, and precisely the group
    // signal error Playwright otherwise hides. Positive-PID signals remain real.
    session.browserServer.close = () => new Promise(() => {});
    process.kill = (target, how) => {
      if (target === -pid) {
        groupAttempted = true;
        const error = Error('Planted missing process group');
        error.code = 'ESRCH';
        throw error;
      }
      if (target === pid && how === 'SIGKILL') directAttempted = true;
      return signal(target, how);
    };
  });
  assert.ok(groupAttempted, 'Retain the task-owned process-tree kill');
  assert.ok(directAttempted, 'A failed tree signal must not leave the owner alive');
  const cleanup = JSON.parse(readFileSync(join(root, 'browser-cleanup.json'), 'utf8'));
  assert.equal(cleanup.forced, true);
  assert.equal(cleanup.directKill, true);
  assert.equal(cleanup.signalCode, 'SIGKILL');
  assert.throws(() => signal(pid, 0), { code: 'ESRCH' });
});
