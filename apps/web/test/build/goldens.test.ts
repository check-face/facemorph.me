// Every golden kept in test/goldens/ is free of photo bytes, latents and typed inputs other than the synthetic
// fixture words and seeds the recorders type (fm-hn9e privacy acceptance).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../goldens/control/', import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []));
// The words and seeds the recorders type, and what the control shows on a first visit (its own seeded faces: 'hello'
// and the visit's date, normalized to <today>).
const SYNTHETIC = new Set(['parity sample', 'hello', '<today>']);

test('no golden holds image bytes, a data URL, a blob URL or a latent', () => {
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{200,}/, `${file}: a long base64 run`);
    assert.doesNotMatch(text, /data:[a-z]+\/[a-z0-9.+-]+[;,]/i, `${file}: a data URL`);
    assert.doesNotMatch(text, /blob:(?!<\d+>)/, `${file}: a blob URL that was not normalized`);
    assert.doesNotMatch(text, /\[(\s*-?\d+\.\d+,){50,}/, `${file}: a long float array (a latent?)`);
  }
});

test('typed inputs in the flow goldens are the synthetic fixtures only', () => {
  for (const file of files(root)) {
    const step = JSON.parse(readFileSync(file, 'utf8')) as { action?: { kind?: string; text?: string }; model?: { Inputs?: { mode: string; value: string }[] } };
    if (step.action?.kind === 'type') assert.ok(SYNTHETIC.has(step.action.text ?? ''), `${file}: typed ${step.action.text}`);
    for (const input of step.model?.Inputs ?? []) {
      if (input.mode === 'text') assert.ok(input.value === '' || SYNTHETIC.has(input.value), `${file}: a text input holds ${input.value}`);
      if (input.mode === 'seed') assert.match(input.value, /^\d*$/, `${file}: a seed input holds ${input.value}`);
    }
  }
});
