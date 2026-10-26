// docs-links (fm-19eb): GitHub anchors, link extraction, and one planted tree per rule.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { anchors, check, links } from './docs-links.mjs';

test('anchors follow GitHub: lowercase, punctuation dropped, code and links unwrapped, duplicates numbered', () => {
  const a = anchors(
    '# Quick start: load a model and make a face\n## `renderMorph` and [links](x)\n## Notes\n## Notes\n```sh\n# not a heading\n```\n',
  );
  assert.ok(a.has('quick-start-load-a-model-and-make-a-face'));
  assert.ok(a.has('rendermorph-and-links'));
  assert.ok(a.has('notes') && a.has('notes-1'));
  assert.ok(!a.has('not-a-heading'));
});

test('links skip fenced and inline code', () => {
  const found = links('see [a](a.md) and `[b](b.md)`\n```md\n[c](c.md)\n```\n[d](d.md "t")\n');
  assert.deepEqual(
    found.map((l) => l.target),
    ['a.md', 'd.md'],
  );
});

function plant(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-links-'));
  const pkg = (name, extra = {}) =>
    JSON.stringify({
      name,
      repository: {
        type: 'git',
        url: 'git+https://github.com/facemorph-me/facemorph.me.git',
        directory: `packages/${name}`,
      },
      ...extra,
    });
  const all = {
    'packages/model-conv/docs/compatibility.md': '# Compatibility\n',
    'packages/stylegan-js/package.json': pkg('stylegan-js'),
    'packages/browser-model-manager/package.json': pkg('browser-model-manager'),
    'packages/cloudflare-model-host/package.json': pkg('cloudflare-model-host'),
    ...files,
  };
  const cross = (self) =>
    ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host', 'model-conv']
      .filter((p) => p !== self)
      .map((p) => `[${p}](../${p}/README.md)`)
      .join(' ') + ' [table](../model-conv/docs/compatibility.md)\n';
  for (const p of ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host', 'model-conv'])
    all[`packages/${p}/README.md`] ??= `# ${p}\n\n${cross(p)}`;
  for (const [f, text] of Object.entries(all)) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}

const rules = (root) => {
  try {
    return check(root).findings.map((f) => `${f.file}:${f.rule}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('a complete, cross-linked tree is clean', () => {
  assert.deepEqual(rules(plant({})), []);
});

test('missing targets, missing anchors and paths outside the repository are findings', () => {
  assert.deepEqual(
    rules(
      plant({
        'packages/stylegan-js/docs/guide.md':
          '# Guide\n[gone](missing.md) [bad](../README.md#nope) [up](../../../../etc/passwd) [ok](#guide)\n',
      }),
    ),
    [
      'packages/stylegan-js/docs/guide.md:missing-target',
      'packages/stylegan-js/docs/guide.md:missing-anchor',
      'packages/stylegan-js/docs/guide.md:outside-repository',
    ],
  );
});

test('a README without a cross-link, a superseded name and an old install name are findings', () => {
  assert.deepEqual(
    rules(
      plant({
        'packages/model-conv/README.md':
          '# model-conv\n[engine](../stylegan-js/README.md)\nimport from @facemorph/stylegan-js\n```sh\nnpm install facemorph-stylegan typescript ./local.tgz\n```\n',
      }),
    ),
    [
      'packages/model-conv/README.md:superseded-name',
      'packages/model-conv/README.md:install-name',
      'packages/model-conv/README.md:cross-link',
      'packages/model-conv/README.md:cross-link',
      'packages/model-conv/README.md:cross-link',
    ],
  );
});

test('a package.json without this repository and directory is a finding', () => {
  assert.deepEqual(
    rules(plant({ 'packages/stylegan-js/package.json': '{"name":"stylegan-js"}' })),
    ['packages/stylegan-js/package.json:repository'],
  );
});
