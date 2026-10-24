// Run against actual Fable output: node verify-fable.mjs /tmp/checkface-next-fable/Next/ProjectJson.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { decode, encode } = await import(pathToFileURL(process.argv[2]).href);
const fixture = JSON.parse(readFileSync(new URL('./project-v1.fixture.json', import.meta.url), 'utf8'));
let checks = 0;
function ok(condition, label) { assert.ok(condition, label); checks++; }
function roundtrip(value) {
  const parsed = decode(JSON.stringify(value));
  ok(parsed.tag === 0, 'Fable decode succeeds');
  const exported = encode(parsed.fields[0]);
  ok(exported.tag === 0, 'Fable encode succeeds');
  assert.deepEqual(JSON.parse(exported.fields[0]), value);
  checks++;
}
for (const kind of ['linear','pairwise-ellipse','pairwise-figure8','full-smooth-ellipse','full-smooth-figure8']) {
  roundtrip({ ...fixture, morph: { ...fixture.morph, kind } });
}
roundtrip({ ...fixture, bundle: { ...fixture.bundle, version: 'quote" slash\\ newline\n emoji 🙂' }, truncationPsi: 0.12345678901234567 });
for (const malformed of [
  '{', 'null', '[]', '{"schemaVersion":1,"schemaVersion":1}',
  JSON.stringify({...fixture, schemaVersion:2}),
  JSON.stringify({...fixture, future:true}),
  JSON.stringify({...fixture, morph:{...fixture.morph, kind:'unrecognized'}}),
  JSON.stringify({...fixture, morph:{...fixture.morph, closed:'true'}}),
  JSON.stringify(fixture).replace('"width":0.2','"width":1e999'),
  JSON.stringify(fixture).replace('"schemaVersion":1','"schemaVersion":01'),
  JSON.stringify(fixture) + 'null', '['.repeat(18)+'0'+']'.repeat(18)
]) ok(decode(malformed).tag === 1, 'Fable rejects malformed/unsupported data');
for (const space of ['z','w','w-plus']) {
  roundtrip({...fixture, morph:{...fixture.morph, controls:fixture.morph.controls.map(c => ({...c, latent:{...c.latent, space}}))}});
}
for (const space of [undefined, 'q', 'd', 'unknown']) {
  const controls = fixture.morph.controls.map(c => ({...c, latent:{...c.latent, space}}));
  ok(decode(JSON.stringify({...fixture, morph:{...fixture.morph, controls}})).tag === 1, 'Space must be explicit and known');
}
const mixedControls = fixture.morph.controls.map((c,i) => ({...c, latent:{...c.latent, space:i === 0 ? 'z' : 'w-plus'}}));
ok(decode(JSON.stringify({...fixture, morph:{...fixture.morph, controls:mixedControls}})).tag === 1, 'Mixed spaces rejected');
console.log(`Passed ${checks} checks against compiled Fable JavaScript.`);
