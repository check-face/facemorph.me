// ProjectJson properties (fm-7s3a, fast-check): random valid projects survive encode -> decode with every value
// intact and encoding is a fixed point; random text, random JSON and single-character edits of valid projects
// never throw and never return anything but a typed answer. (Agreement with classic's own codec on such inputs is
// make-vectors.mjs --fuzz, which needs the Fable build.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { decode, encode, type Project } from '../../src/project/project-json.ts';
import { editedText, validProject } from './arbitraries.mjs';

const valid = validProject(fc) as fc.Arbitrary<Project>;

test('random valid projects round-trip exactly', () => {
  fc.assert(
    fc.property(valid, (project) => {
      const encoded = encode(project);
      assert.ok(encoded.ok, JSON.stringify(!encoded.ok && encoded.error));
      const decoded = decode(encoded.value);
      assert.ok(decoded.ok, JSON.stringify(!decoded.ok && decoded.error));
      assert.deepStrictEqual(decoded.value, project);
      const again = encode(decoded.value);
      assert.ok(again.ok);
      assert.equal(again.value, encoded.value);
    }),
    { numRuns: 300 },
  );
});

test('random input never throws and always answers with a typed result', () => {
  const inputs = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 400 }),
    fc.json(),
    editedText(fc) as fc.Arbitrary<string>,
    valid.map((p) => JSON.stringify(p)),
  );
  fc.assert(
    fc.property(inputs, (input) => {
      const r = decode(input);
      if (r.ok) assert.ok(encode(r.value).ok, 'whatever decode admits, encode writes');
      else {
        assert.ok(r.error.kind === 'malformed' || r.error.kind === 'invalid');
        assert.ok(r.error.messages.length > 0);
        assert.ok(r.error.messages.every((m) => typeof m === 'string' && m.length > 0));
      }
    }),
    { numRuns: 2000 },
  );
});
