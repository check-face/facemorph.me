import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cannotKeepDownload,
  downloadStorageWarning,
  readDownloadStorage,
} from '../../src/controller/download-storage.ts';
import { downloadMegabytes } from '../../src/controller/derived.ts';

const MB = 1024 ** 2;
const packageBytes = 1040 * MB;

test('reported available storage below the remaining package shows the same amount as its row', async () => {
  const storage = await readDownloadStorage({
    estimate: async () => ({ quota: 1000 * MB, usage: 0 }),
  });
  assert.equal(cannotKeepDownload(storage, packageBytes), true);
  const rowAmount = downloadMegabytes(packageBytes);
  assert.equal(rowAmount, '1,040 MB');
  assert.equal(
    downloadStorageWarning(rowAmount),
    'This device may not keep the 1,040 MB download. The models may need to be downloaded again on each visit.',
  );
});

test('only remaining package bytes and quota minus usage decide sufficiency', () => {
  assert.equal(cannotKeepDownload({ quota: 5000 * MB, usage: 0 }, packageBytes), false);
  assert.equal(cannotKeepDownload({ quota: packageBytes, usage: 0 }, packageBytes), false);
  assert.equal(cannotKeepDownload({ quota: 5000 * MB, usage: 3960 * MB }, packageBytes), false);
  assert.equal(cannotKeepDownload({ quota: 5000 * MB, usage: 3960 * MB + 1 }, packageBytes), true);
  assert.equal(cannotKeepDownload({ quota: 1000 * MB, usage: 500 * MB }, 400 * MB), false);
  assert.equal(cannotKeepDownload({ quota: 0, usage: 0 }, 0), false);
});

test('absent or throwing storage APIs leave retention unknown and show no warning', async () => {
  const sources = [
    undefined,
    null,
    {},
    {
      estimate: async (): Promise<StorageEstimate> => {
        throw new Error('storage estimate unavailable');
      },
    },
  ];
  for (const source of sources) {
    const storage = await readDownloadStorage(source);
    assert.equal(storage, null);
    assert.equal(cannotKeepDownload(storage, packageBytes), false);
  }
});

test('both quota and usage must be finite nonnegative facts', async () => {
  const invalid: StorageEstimate[] = [
    {},
    { quota: 1000 * MB },
    { usage: 0 },
    ...[-1, NaN, Infinity, -Infinity].flatMap((value) => [
      { quota: value, usage: 0 },
      { quota: 1000 * MB, usage: value },
    ]),
  ];
  for (const facts of invalid) {
    assert.equal(await readDownloadStorage({ estimate: async () => facts }), null);
    assert.equal(cannotKeepDownload(facts, packageBytes), false);
  }
  for (const bytes of [-1, NaN, Infinity, -Infinity])
    assert.equal(cannotKeepDownload({ quota: 0, usage: 0 }, bytes), false);
});

test('an iPhone user agent with a large reported quota shows no warning', async () => {
  const browser = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    storage: { estimate: async () => ({ quota: 5000 * MB, usage: 0 }) },
  };
  const storage = await readDownloadStorage(browser.storage);
  assert.match(browser.userAgent, /iPhone/);
  assert.equal(cannotKeepDownload(storage, packageBytes), false);
});

test('the estimate method retains its storage receiver', async () => {
  const source = {
    calls: 0,
    async estimate() {
      this.calls++;
      return { quota: 5000 * MB, usage: MB };
    },
  };
  assert.deepEqual(await readDownloadStorage(source), { quota: 5000 * MB, usage: MB });
  assert.equal(source.calls, 1);
});
