// docs-scan (fm-19eb): one planted case per rule, the labelled-region exception and its failure modes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scan, scanText } from './docs-scan.mjs';

const rules = (text) => scanText(text).map((f) => f.rule);

test('each FaceMorph deployment value outside a labelled region is a finding', () => {
  assert.deepEqual(rules('Point the manager at https://models.facemorph.me/runtime/.'), [
    'facemorph-hostname',
  ]);
  assert.deepEqual(rules('Fallback: api.checkface.ml'), ['legacy-hostname']);
  assert.deepEqual(rules('Upload to the facemorph-runtime-mirror bucket.'), ['cloudflare-alias']);
  assert.deepEqual(rules('Stage catalogue.json beside the site.'), ['names-catalogue']);
  assert.deepEqual(rules('export CLOUDFLARE_API_TOKEN=abcdef0123456789'), ['secret']);
  assert.deepEqual(rules(`token ghp_${'a'.repeat(36)}`), ['secret']);
});

test('placeholders, variable names and the source repository are not findings', () => {
  assert.deepEqual(rules('export CLOUDFLARE_API_TOKEN="<your token>"'), []);
  assert.deepEqual(rules('export CLOUDFLARE_API_TOKEN=$TOKEN'), []);
  assert.deepEqual(rules('See https://github.com/facemorph-me/facemorph.me/actions/runs/1.'), []);
  assert.deepEqual(rules('Serve your runtime from https://models.example.com/runtime/.'), []);
});

test('a labelled FaceMorph example region may carry its values; an unlabelled or unclosed one may not', () => {
  const labelled = [
    '<!-- facemorph-example:start -->',
    "**Example: FaceMorph's own deployment.** The mirror Worker serves models.facemorph.me from R2 facemorph-runtime-mirror.",
    '<!-- facemorph-example:end -->',
  ].join('\n');
  assert.deepEqual(scanText(labelled), []);
  const unlabelled = labelled.replace("**Example: FaceMorph's own deployment.** ", '');
  assert.deepEqual(
    scanText(unlabelled).map((f) => f.rule),
    ['example-region'],
  );
  assert.deepEqual(rules('<!-- facemorph-example:start -->\n**Example: FaceMorph.**'), [
    'example-region',
  ]);
  assert.deepEqual(rules('<!-- facemorph-example:end -->'), ['example-region']);
});

test('the scanner reads READMEs, docs guides and example READMEs, never the generated api.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-scan-'));
  try {
    const pkg = join(root, 'packages/p');
    mkdirSync(join(pkg, 'docs'), { recursive: true });
    mkdirSync(join(pkg, 'examples/x'), { recursive: true });
    writeFileSync(join(pkg, 'README.md'), 'clean\n');
    writeFileSync(join(pkg, 'docs/guide.md'), 'host next.facemorph.me\n');
    writeFileSync(join(pkg, 'docs/api.md'), 'CANARY = "checkface.ml"\n');
    writeFileSync(join(pkg, 'examples/x/README.md'), 'catalogue.json\n');
    const r = scan(root, ['packages/p']);
    assert.deepEqual(r.files, [
      'packages/p/README.md',
      'packages/p/docs/guide.md',
      'packages/p/examples/x/README.md',
    ]);
    assert.deepEqual(
      r.findings.map((f) => `${f.file}:${f.rule}`),
      [
        'packages/p/docs/guide.md:facemorph-hostname',
        'packages/p/examples/x/README.md:names-catalogue',
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
