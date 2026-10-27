import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadDecision,
  type DownloadDecisionInput,
} from '../../src/controller/download-decision.ts';
import type { Downloads } from '../../src/controller/state.ts';
import { downloadMegabytes } from '../../src/controller/derived.ts';

const MB = 1024 ** 2;
const downloads: Downloads = {
  known: true,
  phase: 'idle',
  scope: '',
  loaded: 0,
  total: 0,
  routeReady: false,
  photoReady: false,
  photoAvailable: true,
  routeBytes: 158 * MB,
  photoBytes: 1040 * MB,
};
const input: DownloadDecisionInput = {
  downloads,
  requiredScope: 'route',
  selectedBundle: 'route',
  photoCount: 0,
};

test('Generate shows only its missing purpose, with the shared MB figure and labelled unknown timings', () => {
  const decision = downloadDecision(input);
  assert.equal(decision.rows.length, 1);
  const generate = decision.rows[0]!;
  assert.equal(generate.purpose, 'generate');
  assert.equal(generate.bytes, 158 * MB);
  assert.equal(generate.amount, downloadMegabytes(generate.bytes!));
  assert.equal(generate.text, 'Generate: 158 MB; download time unknown; generate time unknown.');
  assert.equal(generate.batchLabel, null);
  assert.equal(decision.totalBytes, 158 * MB);
  assert.equal(decision.amount, generate.amount);
  assert.equal(decision.photoPaused, false);
  assert.equal(decision.downloadCaveat, 'Download time depends on your connection.');
  assert.match(decision.setupCaveat, /First use.*checks.*unknown/);
});

test('Generate and encode separates additional encoder bytes without charging for each selected face', () => {
  const decision = downloadDecision({ ...input, selectedBundle: 'photo', photoCount: 3 });
  assert.deepEqual(
    decision.rows.map((r) => [r.purpose, r.bytes, r.amount]),
    [
      ['generate', 158 * MB, '158 MB'],
      ['encode', 1040 * MB, '1,040 MB'],
    ],
  );
  assert.match(decision.rows[1]!.text, /^Encode: Additional 1,040 MB;/);
  assert.equal(decision.totalBytes, 1198 * MB);
  assert.equal(decision.amount, '1,198 MB');
  assert.equal(decision.photoPaused, false);
});

for (const photoCount of [1, 2, 3, 30, 64, 150]) {
  test(`${photoCount} selected photos have per-face and explicitly unknown batch timing`, () => {
    const decision = downloadDecision({ ...input, selectedBundle: 'photo', photoCount });
    const encode = decision.rows[1]!;
    assert.equal(encode.workLabel, 'Encode time unknown per face');
    assert.equal(
      encode.batchLabel,
      `Batch encode time unknown for ${photoCount} ${photoCount === 1 ? 'face' : 'faces'}`,
    );
    assert.ok(encode.text.includes(encode.workLabel.toLowerCase()));
    assert.ok(encode.text.includes(encode.batchLabel.toLowerCase()));
    assert.equal(encode.bytes, 1040 * MB, 'one shared acquisition, not one package per face');
  });
}

test('optional preparation has a per-face label before files exist, without inventing a batch size', () => {
  const decision = downloadDecision({ ...input, requiredScope: 'photo', selectedBundle: 'photo' });
  assert.equal(decision.rows[1]!.batchLabel, null);
  assert.equal(decision.rows[1]!.workLabel, 'Encode time unknown per face');
});

test('Generate-only on a photo request leaves encoding paused and excludes all encoder bytes', () => {
  const decision = downloadDecision({ ...input, requiredScope: 'photo', photoCount: 2 });
  assert.equal(decision.photoPaused, true);
  assert.deepEqual(
    decision.rows.map((r) => r.purpose),
    ['generate'],
  );
  assert.equal(decision.totalBytes, downloads.routeBytes);
});

test('verified cached purposes stay zero and say verification is required, even if stale missing counters remain', () => {
  const decision = downloadDecision({
    ...input,
    selectedBundle: 'photo',
    downloads: { ...downloads, routeReady: true, photoReady: true },
  });
  for (const row of decision.rows) {
    assert.equal(row.bytes, 0);
    assert.equal(row.amount, '0 MB');
    assert.equal(row.status, 'cached');
    assert.equal(row.downloadLabel, 'Already downloaded, subject to verification');
    assert.ok(row.text.includes(row.downloadLabel));
    assert.doesNotMatch(row.text, /1 MB/);
  }
  assert.equal(decision.totalBytes, 0);
  assert.equal(decision.amount, '0 MB');
});

test('partial inventory charges only remaining bytes; a cached generator and missing encoder stay separate', () => {
  const decision = downloadDecision({
    ...input,
    selectedBundle: 'photo',
    downloads: { ...downloads, routeReady: true, photoBytes: 17 * MB },
  });
  assert.equal(decision.rows[0]!.bytes, 0);
  assert.equal(decision.rows[1]!.bytes, 17 * MB);
  assert.equal(decision.rows[1]!.amount, '17 MB');
  assert.equal(decision.totalBytes, 17 * MB);
});

test('unknown inventory never presents stale zero, cached flags or counters as a known byte figure', () => {
  const decision = downloadDecision({
    ...input,
    selectedBundle: 'photo',
    downloads: { ...downloads, known: false, routeReady: true, photoReady: true },
    codecMissingBytes: 5 * MB,
  });
  for (const row of decision.rows) {
    assert.equal(row.status, 'unknown');
    assert.equal(row.bytes, null);
    assert.equal(row.amount, null);
    assert.match(row.text, /download size unknown; download time unknown/i);
    assert.doesNotMatch(row.text, /Already downloaded|\d[\d,]* MB/);
  }
  assert.equal(decision.totalBytes, null);
  assert.equal(decision.amount, null);
});

test('only explicit missing codec bytes join Generate; Encode and ordinary generation gain no guessed codec', () => {
  const plain = downloadDecision({ ...input, selectedBundle: 'photo' });
  const codec = downloadDecision({ ...input, selectedBundle: 'photo', codecMissingBytes: 7 * MB });
  assert.equal(codec.rows[0]!.bytes, 165 * MB);
  assert.equal(codec.rows[0]!.amount, '165 MB');
  assert.deepEqual(codec.rows[1], plain.rows[1]);
  assert.equal(codec.totalBytes, plain.totalBytes! + 7 * MB);
  const cached = downloadDecision({
    ...input,
    downloads: { ...downloads, routeReady: true },
    codecMissingBytes: 7 * MB,
  });
  assert.equal(cached.rows[0]!.status, 'missing');
  assert.equal(cached.rows[0]!.bytes, 7 * MB);
  assert.equal(
    downloadDecision({ ...input, codecMissingBytes: 0 }).totalBytes,
    plain.rows[0]!.bytes,
  );
});

test('invalid byte counts and photo counts cannot become misleading decisions', () => {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => downloadDecision({ ...input, photoCount: value }), RangeError);
    assert.throws(() => downloadDecision({ ...input, codecMissingBytes: value }), RangeError);
    assert.throws(
      () => downloadDecision({ ...input, downloads: { ...downloads, routeBytes: value } }),
      RangeError,
    );
    assert.throws(
      () =>
        downloadDecision({
          ...input,
          selectedBundle: 'photo',
          downloads: { ...downloads, photoBytes: value },
        }),
      RangeError,
    );
  }
  assert.throws(
    () => downloadDecision({ ...input, codecMissingBytes: Number.MAX_SAFE_INTEGER }),
    RangeError,
  );
});
