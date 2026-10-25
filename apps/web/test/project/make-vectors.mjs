#!/usr/bin/env node
// Classic's answers for project-json.test.ts (fm-7s3a): every case's input run through classic's own codec,
// compiled by Fable 3.1.12 from classic candidate/next-delivery-20260916 src/Next/{Contracts,ProjectJson}.fs
// (the same build classic's verify-fable.mjs checks: 44/44). The test then asks the TS port for the same answer.
// Fable output is not kept in Git; compile it into a scratch folder with a .NET SDK and classic's tool manifest:
//   dotnet tool restore && dotnet fable Pj.fsproj -o out   (Pj.fsproj compiles Contracts.fs then ProjectJson.fs)
//   node test/project/make-vectors.mjs --fable <out>/ProjectJson.js --source-commit <sha> [--check] [--fuzz <n>]
// --check compares instead of writing; --fuzz runs n random inputs (valid projects with random edits, and random
// text) through both codecs and fails on the first different answer.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { cases } from './cases.mjs';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const VECTORS = new URL('../fixtures/project/project-json.vectors.json', import.meta.url);
const { values: a } = parseArgs({
  options: {
    fable: { type: 'string' },
    'source-commit': { type: 'string' },
    check: { type: 'boolean' },
    fuzz: { type: 'string' },
  },
});
if (!a.fable || !/^[0-9a-f]{40}$/.test(a['source-commit'] ?? ''))
  throw new Error(
    '--fable <compiled ProjectJson.js> and --source-commit <classic commit it was compiled from> are required',
  );
const fable = await import(pathToFileURL(a.fable).href);

/** Classic's answer for one input: its canonical encoding, or its error messages. */
export function classic(input) {
  const decoded = fable.decode(input);
  if (decoded.tag !== 0) return { ok: false, messages: [...decoded.fields[0]] };
  const encoded = fable.encode(decoded.fields[0]);
  if (encoded.tag !== 0) return { ok: false, encodeMessages: [...encoded.fields[0]] };
  return { ok: true, text: encoded.fields[0] };
}

const vectors = {
  schema: 'facemorph.project-json-vectors/1',
  bead: 'fm-7s3a',
  source: {
    repository: 'facemorph-me/facemorph.me-classic',
    branch: 'candidate/next-delivery-20260916',
    commit: a['source-commit'],
    files: ['src/Next/Contracts.fs', 'src/Next/ProjectJson.fs'],
    compiler: 'Fable 3.1.12 (classic .config/dotnet-tools.json)',
  },
  // A file case keeps its answer as the canonical text's digest and whether it equals the file byte for byte.
  cases: cases().map((c) => {
    const answer = classic(c.input);
    if (!c.file || !answer.ok)
      return { ...c, input: c.file ? undefined : c.input, classic: answer };
    const { text: t, ...rest } = answer;
    return {
      ...c,
      input: undefined,
      classic: { ...rest, sha256: sha256(t), chars: t.length, equalsInput: t === c.input },
    };
  }),
};
const text = JSON.stringify(vectors, null, 1) + '\n';
if (a.check) {
  const same = readFileSync(VECTORS, 'utf8') === text;
  console.log(JSON.stringify({ event: 'vectors-check', cases: vectors.cases.length, same }));
  if (!same) process.exitCode = 1;
} else {
  writeFileSync(VECTORS, text);
  console.log(JSON.stringify({ event: 'vectors-written', cases: vectors.cases.length }));
}

if (a.fuzz) {
  const fc = (await import('fast-check')).default;
  const ts = await import('../../src/project/project-json.ts');
  const { validProject, editedText } = await import('./arbitraries.mjs');
  const answer = (input) => {
    const r = ts.decode(input);
    if (!r.ok) return { ok: false, messages: [...r.error.messages] };
    const e = ts.encode(r.value);
    return e.ok
      ? { ok: true, text: e.value }
      : { ok: false, encodeMessages: [...e.error.messages] };
  };
  const inputs = fc.oneof(
    validProject(fc).map((p) => JSON.stringify(p)),
    editedText(fc),
    fc.string({ unit: 'binary', maxLength: 300 }),
    fc.json(),
  );
  let n = 0;
  fc.assert(
    fc.property(inputs, (input) => {
      n++;
      const want = classic(input);
      const got = answer(input);
      if (JSON.stringify(want) !== JSON.stringify(got))
        throw new Error(
          `differs on ${JSON.stringify(input).slice(0, 300)}: classic ${JSON.stringify(want).slice(0, 300)} ts ${JSON.stringify(got).slice(0, 300)}`,
        );
    }),
    { numRuns: Number(a.fuzz) },
  );
  console.log(JSON.stringify({ event: 'differential-fuzz', runs: n, differences: 0 }));
}
