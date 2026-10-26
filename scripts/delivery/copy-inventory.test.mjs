// The retirement copy inventory (fm-8lq): the locator and drift check on plain values, and the committed inventory's
// rules (every string located, replacement or removal, owning bead, no fixed date or preservation promise).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inventory, locate } from './copy-inventory.mjs';

const list = JSON.parse(readFileSync(new URL('copy-strings.json', import.meta.url), 'utf8'));
const committed = JSON.parse(
  readFileSync(new URL('../../inventory/retirement-copy.json', import.meta.url), 'utf8'),
);

test('locate finds every line containing the string, 1-based', () => {
  assert.deepEqual(locate('a\nPreview version 1\nb\nPreview version 2', 'Preview version'), [
    { line: 2, text: 'Preview version 1' },
    { line: 4, text: 'Preview version 2' },
  ]);
  assert.deepEqual(locate('nothing here', 'Preview'), []);
});

test('a string the branch head or a named monorepo file lacks is a problem; a newer string absent at the frozen revision is not', () => {
  const small = {
    owners: list.owners,
    strings: [
      {
        id: 'x',
        kind: 'preview chrome',
        find: 'Preview version',
        classic: 'P.fs',
        monorepo: 'S.tsx',
        action: 'replace',
        replacement: 'Version',
      },
    ],
  };
  const ok = inventory(small, {
    frozen: { 'P.fs': null },
    head: { 'P.fs': 'Preview version 1' },
    monorepo: { 'S.tsx': 'Preview version' },
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(
    ok.entries[0].locations.map((l) => `${l.revision}:${l.owner}`),
    ['head:fm-ww4', 'HEAD:fm-gbdt'],
  );
  const gone = inventory(small, {
    frozen: { 'P.fs': '' },
    head: { 'P.fs': 'Version 1' },
    monorepo: { 'S.tsx': '' },
  });
  assert.equal(gone.problems.length, 2);
});

test('every listed string is located at the branch head and has its replacement or removal and an owning bead', () => {
  assert.equal(committed.entries.length, list.strings.length);
  for (const e of committed.entries) {
    assert.ok(
      e.applied
        ? e.locations.some((l) => l.revision === 'frozen') &&
            !e.locations.some((l) => l.revision === 'head')
        : e.locations.some((l) => l.revision === 'head'),
      `${e.id} located at the head, or applied and gone from it`,
    );
    assert.ok(
      e.locations.every((l) => /^fm-[a-z0-9.]+$/.test(l.owner) && l.file && l.line > 0),
      `${e.id} owners and lines`,
    );
    assert.ok(['replace', 'remove', 'keep'].includes(e.action), e.id);
    if (e.action === 'replace') assert.ok(e.replacement, `${e.id} has replacement text`);
    if (e.action === 'remove') assert.equal(e.replacement, null, `${e.id} is a removal`);
  }
});

test('the replacements promise no fixed date, no preserved links and no new share URLs', () => {
  const texts = committed.entries.map((e) => e.replacement ?? '').join('\n');
  assert.doesNotMatch(
    texts,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b20\d\d\b/,
  );
  assert.doesNotMatch(
    texts,
    /(links|GUIDs|results)[^.?]* (still work|are preserved|will work|keep working)(?!\?)/i,
  );
  assert.match(
    'Old links are preserved.',
    /(links|GUIDs|results)[^.?]* (still work|are preserved|will work|keep working)(?!\?)/i,
    'the rule finds a promise',
  );
  assert.doesNotMatch(texts, /share (this|your) link/i);
  for (const kind of [
    'preview chrome',
    'tester invite',
    'classic fallback link',
    'native desktop recommendation',
    'FAQ',
    'fixed-date assurance',
    'GUID/link-preservation promise',
  ])
    assert.ok(
      committed.entries.some((e) => e.kind.startsWith(kind)),
      `the inventory covers ${kind}`,
    );
});

test('an applied row must be gone from the head and name its bead and commit', () => {
  const row = {
    id: 'y',
    kind: 'FAQ',
    find: 'old API',
    classic: 'P.fs',
    action: 'remove',
    replacement: null,
    applied: { bead: 'fm-ww4', commit: 'd9b749f' },
  };
  const run = (head, extra = {}) =>
    inventory(
      { owners: list.owners, strings: [{ ...row, ...extra }] },
      { frozen: { 'P.fs': 'the old API' }, head: { 'P.fs': head }, monorepo: {} },
    ).problems;
  assert.deepEqual(run('rewritten'), []);
  assert.equal(run('still the old API').length, 1);
  assert.equal(run('rewritten', { applied: { bead: 'fm-ww4' } }).length, 1);
  assert.equal(run('rewritten', { applied: undefined }).length, 1);
});
