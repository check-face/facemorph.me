// ProjectJson in TypeScript (fm-7s3a): every case gets exactly classic's answer. The answers in
// project-json.vectors.json come from classic's own codec (Fable 3.1.12 build of Contracts.fs and ProjectJson.fs,
// make-vectors.mjs); an admitted case must re-encode to classic's text byte for byte, a refused one must give
// classic's messages in classic's order. Every classic verify-fable.mjs assertion is a named case here, and the
// goldens (the fixture and the project a control-exported morph MP4 carries) log their source and match.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  MALFORMED_MESSAGE,
  decode,
  encode,
  numeric,
  quote,
  type Project,
} from '../../src/project/project-json.ts';

interface Answer {
  readonly ok: boolean;
  readonly text?: string;
  readonly messages?: readonly string[];
  readonly encodeMessages?: readonly string[];
  readonly sha256?: string;
  readonly chars?: number;
  readonly equalsInput?: boolean;
}
interface Case {
  readonly name: string;
  readonly input?: string;
  readonly file?: string;
  readonly golden?: string;
  readonly provenance?: string;
  readonly classicChecks?: number;
  readonly classic: Answer;
}
const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/project/project-json.vectors.json', import.meta.url), 'utf8'),
) as { readonly cases: readonly Case[] };
const inputOf = (c: Case): string =>
  c.file ? readFileSync(new URL(`../../${c.file}`, import.meta.url), 'utf8') : (c.input ?? '');
const sha256 = (t: string): string => createHash('sha256').update(t).digest('hex');

/** The first path at which two parsed JSON values differ, or null. */
function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDifference(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (d) return d;
  }
  return null;
}

/** The TS port's answer, in the vectors' shape. */
function answer(input: string): { ok: boolean; text?: string; messages?: readonly string[] } {
  const decoded = decode(input);
  if (!decoded.ok) return { ok: false, messages: decoded.error.messages };
  const encoded = encode(decoded.value);
  assert.ok(encoded.ok, 'a decoded project encodes');
  return { ok: true, text: encoded.value };
}

/**
 * Where the port deliberately answers differently from classic, by case name: the classic answer it replaces
 * (checked, so a regenerated vector cannot silently change it) and the port's own. Classic refused an odd
 * frames-per-segment count (an even count gives an exact u = 0.5 midpoint sample); the operator's Custom frame
 * count admits any integer of at least 2 (fm-36ag, 26 October 2026). Even counts sample exactly as before.
 */
const EVEN_RULE = 'Use a positive even frame count per segment to include exact midpoint samples.';
const DEVIATIONS: Readonly<Record<string, { readonly classic: Answer; readonly port: Answer }>> = {
  'an odd frame count is invalid': {
    classic: { ok: false, messages: [EVEN_RULE] },
    port: { ok: true },
  },
  'several errors are all named, in order': {
    classic: {
      ok: false,
      messages: ['Invalid truncation settings.', EVEN_RULE, 'Frame rate must be 1–240.'],
    },
    port: { ok: false, messages: ['Invalid truncation settings.', 'Frame rate must be 1–240.'] },
  },
};

let checks = 0;
let classicChecks = 0;
for (const c of vectors.cases) {
  test(c.name, () => {
    const input = inputOf(c);
    const got = answer(input);
    classicChecks += c.classicChecks ?? 0;
    const deviation = DEVIATIONS[c.name];
    if (deviation)
      assert.deepEqual(c.classic, deviation.classic, 'the classic answer this case replaces');
    const expected = deviation?.port ?? c.classic;
    assert.equal(got.ok, expected.ok, `admitted as classic: ${JSON.stringify(got.messages)}`);
    checks++;
    if (!expected.ok) {
      assert.deepEqual(got.messages, expected.messages);
      checks++;
      return;
    }
    const text = got.text ?? '';
    if (deviation) assert.equal(text, input, 'the canonical input re-encodes to itself');
    else if (c.classic.sha256) {
      assert.equal(sha256(text), c.classic.sha256, 'canonical text is classic’s byte for byte');
      assert.equal(text.length, c.classic.chars);
    } else assert.equal(text, c.classic.text, 'canonical text is classic’s byte for byte');
    checks++;
    // Encoding is a fixed point: the canonical text decodes and re-encodes to itself.
    assert.equal(answer(text).text, text);
    checks++;
    // And it carries the input's values (verify-fable's deepEqual), with the first differing path if not.
    const diff = firstDifference(JSON.parse(text), JSON.parse(input));
    if (c.golden) {
      console.log(
        JSON.stringify({
          event: 'golden',
          golden: c.golden,
          source: c.file,
          provenance: c.provenance ?? 'committed fixture',
          match: text === input ? 'byte-equal' : diff === null ? 'structural' : 'different',
          firstDifference: diff,
          chars: text.length,
        }),
      );
      if (c.classic.equalsInput)
        assert.equal(text, input, 'classic wrote this file; so does the port');
    }
    if (!c.name.startsWith('numeric formatting') && !c.name.startsWith('escapes'))
      assert.equal(diff, null, `values survive the round trip (first difference at ${diff})`);
    checks++;
  });
}

test('the verify-fable cases cover classic’s 44 checks and this suite runs at least as many', () => {
  assert.equal(classicChecks, 44);
  assert.ok(checks >= classicChecks, `${checks} TS checks for ${classicChecks} classic checks`);
  console.log(JSON.stringify({ event: 'project-json-checks', ts: checks, classic: classicChecks }));
});

test('numbers are written as classic’s shipped build wrote them', () => {
  for (const [n, s] of [
    [0, '0'],
    [-0, '0'],
    [1e-7, '1e-7'],
    [4294967295, '4294967295'],
    [1e21, '1e+21'],
    [0.1 + 0.2, '0.30000000000000004'],
  ] as const)
    assert.equal(numeric(n), s);
});

test('strings escape quotes, backslashes, control characters and every surrogate unit, as classic', () => {
  assert.equal(quote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(quote('\u0000\u001f/'), '"\\u0000\\u001f/"');
  assert.equal(quote('🙂'), '"\\ud83d\\ude42"');
  assert.equal(quote('é'), '"é"');
});

test('malformed input never throws: it is a typed error with classic’s one message', () => {
  for (const input of ['', '{', '"', '\\', '[[[[', '{"a":}', 'nul', '-', '1e', '\ud800'] as const) {
    const r = decode(input);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.error, { kind: 'malformed', messages: [MALFORMED_MESSAGE] });
  }
});

test('frames per segment: any integer from 2 up to the 100,000-frame schedule limit (fm-36ag)', () => {
  const text = readFileSync(
    new URL('../../src/Next/project-v1.fixture.json', import.meta.url),
    'utf8',
  );
  const fixture = JSON.parse(text) as { morph: Record<string, unknown> };
  const withFrames = (frames: unknown) =>
    JSON.stringify({ ...fixture, morph: { ...fixture.morph, framesPerSegment: frames } });
  for (const frames of [2, 3, 7, 8, 16, 33, 100000]) {
    const got = answer(withFrames(frames));
    assert.equal(got.ok, true, `${frames}: ${JSON.stringify(got.messages)}`);
    assert.equal(
      JSON.parse(got.text ?? '').morph.framesPerSegment,
      frames,
      'round-trips the count',
    );
  }
  for (const frames of [0, 1])
    assert.deepEqual(answer(withFrames(frames)).messages, ['Use at least 2 frames per segment.']);
  assert.deepEqual(answer(withFrames(100001)).messages, ['Frame schedule exceeds the limit.']);
  for (const frames of [-2, 1.5, '16', null])
    assert.equal(answer(withFrames(frames)).ok, false, String(frames));
  assert.equal(
    answer(withFrames(16).replace('"framesPerSegment":16', '"framesPerSegment":NaN')).ok,
    false,
  );
});

test('encode refuses an invalid project with every reason, and admits the fixture', () => {
  const fixture = decode(
    readFileSync(new URL('../../src/Next/project-v1.fixture.json', import.meta.url), 'utf8'),
  );
  assert.ok(fixture.ok);
  const p: Project = fixture.value;
  const bad: Project = {
    ...p,
    truncationPsi: Number.NaN,
    morph: { ...p.morph, framesPerSecond: 0 },
  };
  const r = encode(bad);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.deepEqual(r.error, {
      kind: 'invalid',
      messages: ['Invalid truncation settings.', 'Frame rate must be 1–240.'],
    });
  assert.equal(encode(p).ok, true);
});
