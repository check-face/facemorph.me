// The bridge's ProjectJson (fm-stth): bridge-result.ts gives project-json.ts's answers in the Fable Result shape the
// candidate bridge reads, and the bridge itself now loads as an ES module with no Fable output beside it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decode, encode } from '../../src/project/bridge-result.ts';
import * as typed from '../../src/project/project-json.ts';

const golden = readFileSync(
  new URL('../fixtures/project/control-morph-mp4.project.json', import.meta.url),
  'utf8',
);

test('an admitted project is Ok (tag 0) with the typed decode value, and re-encodes to the typed text', () => {
  const d = decode(golden);
  const t = typed.decode(golden);
  assert.ok(t.ok);
  assert.equal(d.tag, 0);
  assert.deepEqual(d.fields[0], t.value);
  if (d.tag !== 0) return;
  const e = encode(d.fields[0]);
  const te = typed.encode(t.value);
  assert.ok(te.ok);
  assert.deepEqual(e, { tag: 0, fields: [te.value] });
});

test('a refused project is Error (tag 1) carrying the typed messages in order', () => {
  for (const input of ['{', 'null', '{"schemaVersion":2}']) {
    const d = decode(input);
    const t = typed.decode(input);
    assert.ok(!t.ok);
    assert.deepEqual(d, { tag: 1, fields: [t.error.messages] }, input);
  }
});

test('the bridge loads as an ES module: its ProjectJson import resolves to bridge-result.ts', async () => {
  const bridge = await import('../../src/Next/product-bridge.mjs');
  assert.equal(typeof bridge.consentToDownload, 'function');
  const source = readFileSync(
    new URL('../../src/Next/product-bridge.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /^import \{decode,encode\} from '\.\.\/project\/bridge-result\.ts';$/m);
  assert.doesNotMatch(source, /\.fs\.js'/);
});
