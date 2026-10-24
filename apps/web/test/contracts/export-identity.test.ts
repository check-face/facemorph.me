// Export identity and prepared-file cache contract tests (fm-s9n). Pure functions over plain values:
// every vector in export-identity.vectors.json is run, and the structural properties (alphabet,
// suffix length, stem bound, grapheme integrity) are asserted by hand, independently of the
// reference outputs recorded in the vectors.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as identityModule from '../../src/contracts/export-identity.ts';
import * as cacheModule from '../../src/contracts/prepared-file-cache.ts';
import {
  EXPORT_MIME,
  ExportNameCollision,
  FILENAME_MAX_STEM,
  SANITIZE_RULES,
  SUFFIX_ALPHABET,
  SUFFIX_LENGTH,
  SUFFIX_MAX_LENGTH,
  decideWrite,
  exportIdentity,
  exportIdentityDigest,
  sanitizeLabel,
  suffixOf,
  suggestFilename,
  withEditedName,
  type ExportIdentity,
  type ExportIdentityInput,
  type ExportLabelSource,
  type KnownExport,
} from '../../src/contracts/export-identity.ts';
import {
  EMPTY_PREPARED_FILE_CACHE,
  cacheBytes,
  lookupPreparedFile,
  pinCacheEntry,
  planCacheInsert,
  preparedFileCacheMaxBytes,
  preparedFileKey,
  touchCacheEntry,
  type PreparedFileCacheState,
} from '../../src/contracts/prepared-file-cache.ts';

// Type-level: neither contract module may export an entry-count bound.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type NoEntries = Extract<
  keyof typeof identityModule | keyof typeof cacheModule,
  `${string}_MAX_ENTRIES`
>;
const noEntryBound: Equal<NoEntries, never> = true;

const vectors = JSON.parse(
  readFileSync(
    new URL('../../src/contracts/export-identity.vectors.json', import.meta.url),
    'utf8',
  ),
) as {
  suffixAlphabet: string;
  golden: { input: ExportIdentityInput; digest: string };
  suffixVectors: { digest: string; suffix16: string }[];
  sanitize: { name: string; input: string; expected: string }[];
  truncation: {
    name: string;
    label: string;
    digest: string;
    expected: { filename: string; stem: string; suffix: string };
  }[];
  shapes: {
    name: string;
    input: ExportIdentityInput;
    labelSource: ExportLabelSource | null;
    digest: string;
    expected: { filename: string; mime: string };
  }[];
  webpVsPng: {
    webp: ExportIdentityInput;
    png: ExportIdentityInput;
    labelSource: ExportLabelSource;
    expected: { webp: string; png: string };
  };
  forcedCollision: {
    digests: [string, string];
    label: string;
    first: string;
    secondWithFirstKnown: string;
    secondAlone: string;
  };
  realCollision: {
    inputA: ExportIdentityInput;
    inputB: ExportIdentityInput;
    tries: number;
    seedA: string;
    seedB: string;
    digestA: string;
    digestB: string;
    sharedPrefix6: string;
    nameA: string;
    nameBWithAKnown: string;
  };
  exhaustion: {
    digest: string;
    label: string;
    known: KnownExport[];
    oneFewerKnown: string;
  };
};

/** `{U+XXXX}` placeholders keep invisible code points readable in the vectors file. */
const expand = (text: string): string =>
  text.replace(/\{U\+([0-9A-F]+)\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
const cp = (text: string): number => Array.from(text).length;
const idOf = (
  digest: string,
  label: string,
  kind: ExportIdentity['kind'] = 'webp',
): ExportIdentity => ({
  digest,
  kind,
  label,
  fallbackLabel: 'face',
});

function assertWellFormed(filename: string, extension: string): void {
  const stem = filename.slice(0, filename.length - extension.length - 1);
  assert.ok(filename.endsWith(`.${extension}`));
  assert.ok(cp(stem) <= FILENAME_MAX_STEM, `${stem} is longer than ${FILENAME_MAX_STEM}`);
  const suffix = stem.slice(stem.lastIndexOf('-') + 1);
  assert.ok(suffix.length >= SUFFIX_LENGTH && suffix.length <= SUFFIX_MAX_LENGTH);
  for (const ch of suffix) assert.ok(SUFFIX_ALPHABET.includes(ch), `${ch} is outside the alphabet`);
  assert.ok(!/[<>:"/\\|?*]/.test(filename));
}

test('constants match the contract', () => {
  assert.equal(SUFFIX_ALPHABET, 'bcdfghjkmnpqrstvwxz23456789');
  assert.equal(SUFFIX_ALPHABET.length, 27);
  assert.equal(new Set(SUFFIX_ALPHABET).size, 27);
  assert.equal(vectors.suffixAlphabet, SUFFIX_ALPHABET);
  assert.equal(SUFFIX_LENGTH, 6);
  assert.equal(SUFFIX_MAX_LENGTH, 16);
  assert.equal(FILENAME_MAX_STEM, 64);
  assert.deepEqual(EXPORT_MIME, { webp: 'image/webp', png: 'image/png', mp4: 'video/mp4' });
  assert.ok(SANITIZE_RULES.length > 0);
  assert.equal(noEntryBound, true);
});

test('digest is SHA-256 of sorted-key whitespace-free JSON and ignores key order', () => {
  assert.equal(exportIdentityDigest(vectors.golden.input), vectors.golden.digest);
  assert.match(vectors.golden.digest, /^[0-9a-f]{64}$/);
  const shuffled: ExportIdentityInput = {
    encodingOptions: { b: 1, a: [2, { y: 1, x: 2 }] },
    format: 'h264',
    modelIdentity: 'm',
    orderedInputs: ['a'],
    crops: [],
    kind: 'mp4',
  };
  const sorted: ExportIdentityInput = {
    kind: 'mp4',
    crops: [],
    orderedInputs: ['a'],
    modelIdentity: 'm',
    format: 'h264',
    encodingOptions: { a: [2, { x: 2, y: 1 }], b: 1 },
  };
  assert.equal(exportIdentityDigest(shuffled), exportIdentityDigest(sorted));
  // Order of inputs, kind and morph all change the identity.
  const base = { ...sorted, orderedInputs: ['a', 'b'] };
  assert.notEqual(
    exportIdentityDigest(base),
    exportIdentityDigest({ ...base, orderedInputs: ['b', 'a'] }),
  );
  assert.notEqual(exportIdentityDigest(base), exportIdentityDigest({ ...base, kind: 'png' }));
  assert.notEqual(
    exportIdentityDigest(base),
    exportIdentityDigest({ ...base, morph: { mode: 'linear', settings: {} } }),
  );
  // A zero digest reads as 0.000000 in base 27.
  assert.equal(suffixOf('00'.repeat(32), 6), 'bbbbbb');
});

test('suffix is the digest read big-endian in base 27, most significant symbol first', () => {
  // 2^255 is exactly one half: 13.5/27 -> first symbol index 13, then 13.5 -> 13 ... alternating.
  const half = `8${'0'.repeat(63)}`;
  const s = suffixOf(half, 4);
  assert.equal(s[0], SUFFIX_ALPHABET[13]);
  assert.equal(s[1], SUFFIX_ALPHABET[13]);
  // The top byte decides the first symbol: byte / 256 * 27.
  for (const [hex, index] of [
    ['00', 0],
    ['0f', 1],
    ['80', 13],
    ['ff', 26],
  ] as const) {
    assert.equal(suffixOf(hex + '0'.repeat(62), 1), SUFFIX_ALPHABET[index]);
  }
  for (const v of vectors.suffixVectors) {
    assert.equal(suffixOf(v.digest, 16), v.suffix16);
    for (let n = 1; n < 16; n++) assert.equal(suffixOf(v.digest, n), v.suffix16.slice(0, n));
  }
  assert.throws(() => suffixOf('xyz', 6), RangeError);
});

test('sanitise vectors', () => {
  for (const v of vectors.sanitize) {
    assert.equal(sanitizeLabel(expand(v.input)), v.expected, v.name);
    assert.ok(!/[\p{Cc}<>:"/\\|?*\s_]/u.test(v.expected), v.name);
    assert.ok(!/[‪-‮⁦-⁩‎‏؜]/u.test(v.expected), v.name);
    assert.ok(!/^-|-$|--/.test(v.expected), v.name);
  }
  const by = (name: string): string => vectors.sanitize.find((v) => v.name === name)!.expected;
  assert.equal(by('plain'), 'emma');
  assert.equal(by('source extension'), 'holiday-face2');
  assert.equal(by('path components posix'), 'emma-k');
  assert.equal(by('path components windows'), 'my-pic');
  assert.equal(by('bidi override'), 'abcfdp-exe');
  assert.equal(by('reserved name CON'), '');
  assert.equal(by('reserved name com1 with extension'), '');
  assert.equal(by('reserved name lpt9 inside is fine'), 'lpt9x');
  for (const name of ['CON', 'prn', 'Aux', 'NUL', 'COM9', 'lpt1'])
    assert.equal(sanitizeLabel(name), '');
});

test('truncation vectors keep graphemes whole and the suffix intact', () => {
  for (const v of vectors.truncation) {
    const id = exportIdentity(
      {
        kind: 'webp',
        crops: [],
        orderedInputs: [v.name],
        modelIdentity: 'ffhq-1024-v1',
        format: 'webp-lossless',
        encodingOptions: {},
      },
      { origin: 'entered-text', text: expand(v.label) },
    );
    assert.equal(id.digest, v.digest, v.name);
    const name = suggestFilename(id, []);
    assert.equal(name.filename, v.expected.filename, v.name);
    assert.equal(name.stem, v.expected.stem, v.name);
    assert.equal(name.suffix, v.expected.suffix, v.name);
    assertWellFormed(name.filename, 'webp');
    assert.ok(name.stem.endsWith(`-${suffixOf(id.digest, 6)}`));
  }
  const get = (needle: string) =>
    vectors.truncation.find((v) => v.name.startsWith(needle))!.expected.stem;
  assert.equal(cp(get('long ascii')), 64);
  // Exactly at the cut: 50 letters + 7-code-point family fills the 57-code-point label budget.
  const fits = get('family emoji ends exactly');
  assert.equal(cp(fits), 64);
  assert.ok(fits.includes(expand('{U+1F468}{U+200D}{U+1F469}{U+200D}{U+1F467}{U+200D}{U+1F466}')));
  // One code point over: the family goes whole, never a partial sequence.
  const over = get('family emoji one code point');
  assert.ok(!/[\u{1F468}‍]/u.test(over));
  assert.equal(over.slice(0, 51), 'a'.repeat(51));
  const flag = get('flag straddling');
  assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(flag));
  assert.ok(!get('cut leaves').includes('--'));
});

test('label shapes from the operator examples and the fallbacks', () => {
  for (const v of vectors.shapes) {
    const id = exportIdentity(v.input, v.labelSource ?? undefined);
    assert.equal(id.digest, v.digest, v.name);
    const name = suggestFilename(id, []);
    assert.equal(name.filename, v.expected.filename, v.name);
    assert.equal(name.mime, v.expected.mime, v.name);
    assert.equal(name.mime, EXPORT_MIME[v.input.kind], v.name);
    assertWellFormed(name.filename, v.input.kind);
  }
  const labelOf = (n: string) =>
    vectors.shapes.find((v) => v.name.startsWith(n))!.expected.filename;
  assert.match(labelOf('result name emma'), /^emma-[bcdfghjkmnpqrstvwxz2-9]{6}\.webp$/);
  assert.match(labelOf('seed 42'), /^seed-42-[bcdfghjkmnpqrstvwxz2-9]{6}\.png$/);
  assert.match(labelOf('source basename'), /^holiday-face2-[bcdfghjkmnpqrstvwxz2-9]{6}\.webp$/);
  assert.match(labelOf('emma-noah linear'), /^emma-noah-linear-[bcdfghjkmnpqrstvwxz2-9]{6}\.mp4$/);
  assert.match(
    labelOf('emma-noah figure8'),
    /^emma-noah-figure8-[bcdfghjkmnpqrstvwxz2-9]{6}\.mp4$/,
  );
  assert.match(labelOf('no label, still'), /^face-[bcdfghjkmnpqrstvwxz2-9]{6}\.webp$/);
  assert.match(labelOf('no label, morph'), /^morph-[bcdfghjkmnpqrstvwxz2-9]{6}\.mp4$/);
});

test('WebP and PNG of one result share the label with distinct suffixes', () => {
  const v = vectors.webpVsPng;
  const webp = exportIdentity(v.webp, v.labelSource);
  const png = exportIdentity(v.png, v.labelSource);
  assert.notEqual(webp.digest, png.digest);
  const a = suggestFilename(webp, []);
  const b = suggestFilename(png, []);
  assert.equal(a.filename, v.expected.webp);
  assert.equal(b.filename, v.expected.png);
  assert.equal(a.stem.slice(0, a.stem.lastIndexOf('-')), b.stem.slice(0, b.stem.lastIndexOf('-')));
  assert.notEqual(a.suffix, b.suffix);
  assert.equal(a.extension, 'webp');
  assert.equal(b.extension, 'png');
  assert.equal(b.mime, 'image/png');
});

test('forced collision on crafted digests extends to seven symbols', () => {
  const v = vectors.forcedCollision;
  const [d1, d2] = v.digests;
  assert.notEqual(d1, d2);
  assert.equal(suffixOf(d1, 6), suffixOf(d2, 6));
  assert.notEqual(suffixOf(d1, 7), suffixOf(d2, 7));
  const first = suggestFilename(idOf(d1, v.label), []);
  assert.equal(first.filename, v.first);
  assert.equal(first.suffix.length, 6);
  const known: KnownExport[] = [{ digest: d1, filename: first.filename }];
  const second = suggestFilename(idOf(d2, v.label), known);
  assert.equal(second.filename, v.secondWithFirstKnown);
  assert.equal(second.suffix.length, 7);
  assert.equal(second.suffix.slice(0, 6), first.suffix);
  assert.equal(suggestFilename(idOf(d2, v.label), []).filename, v.secondAlone);
  // The same identity reuses its name, even though that name is in the known set.
  assert.equal(suggestFilename(idOf(d1, v.label), known).filename, first.filename);
  // A different label never collides.
  assert.equal(suggestFilename(idOf(d2, 'noah'), known).suffix.length, 6);
});

test('a real six-symbol prefix collision between two identities extends to seven', () => {
  const v = vectors.realCollision;
  const a = exportIdentity(v.inputA, { origin: 'seed', text: v.seedA });
  const b = exportIdentity(v.inputB, { origin: 'seed', text: v.seedB });
  assert.equal(a.digest, v.digestA);
  assert.equal(b.digest, v.digestB);
  assert.notEqual(a.digest, b.digest);
  assert.equal(suffixOf(a.digest, 6), suffixOf(b.digest, 6));
  assert.equal(suffixOf(a.digest, 6), v.sharedPrefix6);
  assert.ok(v.tries > 1);
  // Same label: force the same name by giving both the same label.
  const sameLabel = (id: ExportIdentity): ExportIdentity => ({ ...id, label: 'seed-1' });
  const nameA = suggestFilename(sameLabel(a), []);
  assert.equal(nameA.suffix, v.sharedPrefix6);
  const nameB = suggestFilename(sameLabel(b), [{ digest: a.digest, filename: nameA.filename }]);
  assert.equal(nameB.suffix.length, 7);
  assert.equal(nameB.suffix.slice(0, 6), v.sharedPrefix6);
  assert.equal(suggestFilename(a, []).filename, v.nameA);
  // With the distinct seed labels the names differ already, so no extension is needed.
  assert.equal(
    suggestFilename(b, [{ digest: a.digest, filename: v.nameA }]).filename,
    v.nameBWithAKnown,
  );
});

test('sixteen-symbol exhaustion throws ExportNameCollision, never a counter or timestamp', () => {
  const v = vectors.exhaustion;
  assert.equal(v.known.length, 11);
  const id = idOf(v.digest, v.label, 'png');
  assert.throws(
    () => suggestFilename(id, v.known),
    (error: unknown) =>
      error instanceof ExportNameCollision && error.name === 'ExportNameCollision',
  );
  const lastTried = `${v.label}-${suffixOf(v.digest, 16)}.png`;
  assert.equal(v.oneFewerKnown, lastTried);
  assert.equal(suggestFilename(id, v.known.slice(0, 10)).suffix.length, 16);
});

test('repeat Save/Share reuses the name and an edited name keeps its suffix', () => {
  const input: ExportIdentityInput = {
    kind: 'webp',
    crops: [],
    orderedInputs: ['x'],
    modelIdentity: 'm',
    format: 'webp-lossless',
    encodingOptions: {},
  };
  const id = exportIdentity(input, { origin: 'result-name', text: 'Emma' });
  const first = suggestFilename(id, []);
  const known = [{ digest: id.digest, filename: first.filename }];
  assert.equal(suggestFilename(id, known).filename, first.filename);
  const edited = withEditedName(id, 'Holiday Snap.webp');
  assert.equal(suggestFilename(edited, []).filename, `holiday-snap-${first.suffix}.webp`);
  // Typing the suffix back in does not double it.
  const again = withEditedName(id, `holiday-snap-${first.suffix}.webp`);
  assert.equal(suggestFilename(again, []).filename, `holiday-snap-${first.suffix}.webp`);
  // Emptied names fall back to face.
  assert.equal(suggestFilename(withEditedName(id, '   '), []).stem, `face-${first.suffix}`);
});

test('write decisions: downloads defer to the browser, picker writes never clobber silently', () => {
  assert.equal(decideWrite('browser-download', true, false), 'download');
  assert.equal(decideWrite('browser-download', false, false), 'download');
  assert.equal(decideWrite('file-picker-no-clobber', false, false), 'write');
  assert.equal(decideWrite('file-picker-no-clobber', true, true), 'extend-name');
  assert.equal(decideWrite('file-picker-confirm-overwrite', false, false), 'write');
  assert.equal(decideWrite('file-picker-confirm-overwrite', true, false), 'ask-overwrite');
  assert.equal(decideWrite('file-picker-confirm-overwrite', true, true), 'overwrite');
});

// ---------------------------------------------------------------------------------------------
// Prepared-file cache

const entry = (key: string, bytes: number) => ({ key, bytes });
function filled(...items: [string, number][]): PreparedFileCacheState {
  let state = EMPTY_PREPARED_FILE_CACHE;
  for (const [k, b] of items) state = planCacheInsert(state, entry(k, b), 1_000_000).state;
  return state;
}

test('cache key is revision, format and encoding options', () => {
  const k = preparedFileKey({ resultRevision: 3, format: 'webp', encodingOptions: { q: 1, a: 2 } });
  assert.equal(k, '{"encodingOptions":{"a":2,"q":1},"format":"webp","resultRevision":3}');
  assert.notEqual(
    k,
    preparedFileKey({ resultRevision: 4, format: 'webp', encodingOptions: { q: 1, a: 2 } }),
  );
  assert.notEqual(
    k,
    preparedFileKey({ resultRevision: 3, format: 'png', encodingOptions: { q: 1, a: 2 } }),
  );
  assert.throws(() => preparedFileCacheMaxBytes(0), RangeError);
  assert.equal(preparedFileCacheMaxBytes(10), 10);
});

test('cache is bounded by bytes only and evicts least recently used first', () => {
  let state = filled(['a', 40], ['b', 40]);
  let plan = planCacheInsert(state, entry('c', 15), 100);
  assert.equal(plan.retained, true);
  assert.deepEqual(plan.evicted, []);
  assert.equal(cacheBytes(plan.state), 95);
  // Many small entries are fine: no entry-count bound.
  state = EMPTY_PREPARED_FILE_CACHE;
  for (let i = 0; i < 500; i++) state = planCacheInsert(state, entry(`k${i}`, 1), 1000).state;
  assert.equal(state.entries.length, 500);
  // 95 + 20 > 100: oldest (a, 40) goes, which is enough.
  plan = planCacheInsert(plan.state, entry('d', 20), 100);
  assert.deepEqual(plan.evicted, ['a']);
  assert.deepEqual(
    plan.state.entries.map((e) => e.key),
    ['b', 'c', 'd'],
  );
  // Touching b makes c the least recently used.
  const touched = touchCacheEntry(plan.state, 'b');
  const next = planCacheInsert(touched, entry('e', 40), 100);
  assert.deepEqual(next.evicted, ['c', 'd'].slice(0, next.evicted.length));
  assert.ok(cacheBytes(next.state) <= 100);
  assert.equal(next.state.entries.at(-1)?.key, 'e');
  assert.deepEqual(touchCacheEntry(plan.state, 'missing'), plan.state);
});

test('the pinned current selection is never evicted', () => {
  let state = filled(['a', 40], ['b', 40]);
  state = pinCacheEntry(state, 'a');
  const plan = planCacheInsert(state, entry('c', 40), 100);
  assert.deepEqual(plan.evicted, ['b']);
  assert.ok(plan.state.entries.some((e) => e.key === 'a'));
  assert.equal(plan.state.pinnedKey, 'a');
  // A new pinned insert releases the old pin, which then becomes evictable.
  const moved = planCacheInsert(plan.state, entry('p', 60), 100, true);
  assert.equal(moved.state.pinnedKey, 'p');
  assert.deepEqual(moved.evicted, ['a']);
  assert.ok(cacheBytes(moved.state) <= 100);
  // Nothing evictable and no room beside the pinned file: handed off, not retained, nothing evicted.
  const squeezed = planCacheInsert(
    pinCacheEntry(filled(['only', 80]), 'only'),
    entry('x', 30),
    100,
  );
  assert.equal(squeezed.retained, false);
  assert.equal(squeezed.notRetained, 'PreparedFileNotRetained');
  assert.deepEqual(squeezed.evicted, []);
  assert.equal(squeezed.state.entries.length, 1);
});

test('a single file larger than the bound is not retained and evicts nothing', () => {
  const state = filled(['a', 40], ['b', 40]);
  const plan = planCacheInsert(state, entry('huge', 101), 100);
  assert.equal(plan.retained, false);
  assert.equal(plan.notRetained, 'PreparedFileNotRetained');
  assert.deepEqual(plan.evicted, []);
  assert.equal(plan.state, state);
  assert.equal(planCacheInsert(state, entry('exact', 100), 100).retained, true);
});

test('an evicted file shows Preparing file and is rebuilt without new inference', () => {
  const state = filled(['a', 10]);
  const hit = lookupPreparedFile(state, 'a');
  assert.equal(hit.status, 'ready');
  const miss = lookupPreparedFile(state, 'gone');
  assert.equal(miss.status, 'preparing');
  if (miss.status === 'preparing') {
    assert.equal(miss.label, 'Preparing file…');
    assert.equal(miss.source, 'retained-pixels-or-frames');
    assert.equal(miss.newInference, false);
  }
});
