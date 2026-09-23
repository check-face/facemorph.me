import test from 'node:test';
import assert from 'node:assert/strict';
import { persistenceAction, promptsForPersistence } from './storage-request.mjs';

const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const firefoxAndroid = 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0';
const firefoxIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15';
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('issue #28: Gecko never gets an unexplained persistent-storage prompt', () => {
  for (const ua of [firefox, firefoxAndroid]) {
    assert.equal(promptsForPersistence(ua), true);
    assert.equal(persistenceAction({ userAgent: ua }), 'observe');
    assert.equal(persistenceAction({ userAgent: ua, explained: true }), 'request');
  }
});

test('engines that decide silently still ask, so their caches are protected from eviction', () => {
  for (const ua of [chrome, safari, firefoxIos]) assert.equal(persistenceAction({ userAgent: ua }), 'request');
});

test('a request is made at most once per session', () => {
  assert.equal(persistenceAction({ userAgent: chrome, alreadyAsked: true }), 'none');
  assert.equal(persistenceAction({ userAgent: firefox, explained: true, alreadyAsked: true }), 'none');
});
