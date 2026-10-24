import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lockPackages, renderTemplate, resolveSpecifier } from './unresolved-imports.mjs';
import { plant, run, tempDir } from './testing.mjs';

const SCRIPT = fileURLToPath(new URL('./unresolved-imports.mjs', import.meta.url));
const LOCK = { lockfileVersion: 3, packages: { '': {}, 'node_modules/bulma': {}, 'node_modules/@scope/pkg': {}, 'node_modules/a/node_modules/nested': {} } };

// A fixture tree (the app root) with its lock and an allowlist carrying the page options and expectations.
function fixture(files, { pages = {}, expected = [] } = {}) {
  const root = plant(tempDir(), { ...files, 'package-lock.json': JSON.stringify(LOCK) });
  const allowlist = join(tempDir(), 'allowlist.json');
  writeFileSync(allowlist, JSON.stringify({ destination_root: 'apps/web', html_pages: pages, unresolved_imports: expected }));
  return (...extra) => run(SCRIPT, ['--root', root, '--allowlist', allowlist, ...extra]);
}

const RESOLVED = {
  'src/a.mjs': [
    "import {b} from './b.mjs';",
    "import * as fs from 'node:fs';",
    "import path from 'path';",
    "export {c} from '../lib/c.mjs';",
    "const q = await import('./b.mjs?variant');",
    "const w = new Worker(new URL('./worker.mjs', import.meta.url), {type: 'module'});",
    "const s = \"import x from './not-a-module.mjs'\"; // import y from './nor-this.mjs'",
    '/* import z from "./nor-this-either.mjs" */',
    "import {root} from '/lib/c.mjs';",
  ].join('\n'),
  'src/b.mjs': 'export const b = 1;',
  'src/worker.mjs': "import {b} from './b.mjs'; self.onmessage = () => b;",
  'lib/c.mjs': "export const c = 1; export const root = 2; import pkg from '@scope/pkg/sub/path.js';",
  'tools/x.cjs': "const fs = require('fs'); const b = require('bulma');",
  'src/pages/page.html': "<script type=\"module\">import {b} from './src/b.mjs';</script><% if (!htmlWebpackPlugin.options.selfHost) { %><script src=\"https://tags.example/t.js\"></script><% } %>",
  'src/style.scss': '@import "~bulma/bulma";\n@import "./parts/tile";\n',
  'src/parts/_tile.scss': '.tile { color: red; }',
};
// Served at the app root, as serve-local.py serves runtime-test.html.
const PAGES = { 'src/pages/page.html': { served_at: 'page.html', template_options: { selfHost: true } } };

test('a fully resolved tree reports nothing; imports inside strings and comments are not imports', () => {
  const r = fixture(RESOLVED, { pages: PAGES })('--expect-none');
  assert.equal(r.status, 0, JSON.stringify(r.lines));
  assert.equal(r.summary.unresolved, 0);
  assert.equal(r.summary.parse_errors, 0);
  assert.equal(r.summary.specifiers, 14, 'the three in a string and comments are not counted');
});

test('one unresolved import is reported with its importer, and fails when not expected', () => {
  const r = fixture({ ...RESOLVED, 'src/b.mjs': "export const b = 1; import {gone} from './gone.fs.js';" }, { pages: PAGES })('--expect-none');
  assert.equal(r.status, 1);
  assert.deepEqual(r.lines.filter((l) => l.importer), [{ importer: 'apps/web/src/b.mjs', specifier: './gone.fs.js', kind: 'static', reason: 'missing-file', expected: false }]);
});

test('the expected unresolved import passes; a second planted one fails; an expected one that resolves fails', () => {
  const expected = [{ importer: 'apps/web/src/b.mjs', specifier: './ProjectJson.fs.js' }];
  const one = { ...RESOLVED, 'src/b.mjs': "export const b = 1; import {decode} from './ProjectJson.fs.js';" };
  const ok = fixture(one, { pages: PAGES, expected })();
  assert.equal(ok.status, 0, JSON.stringify(ok.lines));
  assert.equal(ok.lines[0].expected, true);
  const two = fixture({ ...one, 'src/worker.mjs': "import {x} from './Other.fs.js';" }, { pages: PAGES, expected })();
  assert.equal(two.status, 1);
  assert.equal(two.summary.unexpected, 1);
  const none = fixture(RESOLVED, { pages: PAGES, expected })();
  assert.equal(none.status, 1);
  assert.equal(none.summary.missing_expected, 1);
});

test('a bare package resolvable from the lock is not reported; one missing from the lock is', () => {
  const r = fixture({ 'src/a.mjs': "import x from '@scope/pkg'; import y from 'nested/deep.js'; import z from 'left-pad';" })('--expect-none', '--lock', join(tempDir(), 'none.json'));
  assert.equal(r.status, 1, 'a missing --lock file is an error, not an empty lock');
  const ok = fixture({ 'src/a.mjs': "import x from '@scope/pkg'; import y from 'nested/deep.js'; import z from 'left-pad';" })('--expect-none');
  assert.deepEqual(ok.lines.filter((l) => l.importer).map((l) => [l.specifier, l.reason]), [['left-pad', 'package-not-in-lock']]);
});

test('a page rendered without selfHost carries its third-party script; a page served elsewhere resolves from there', () => {
  const r = fixture(RESOLVED, { pages: { 'src/pages/page.html': { template_options: { selfHost: false } } } })('--expect-none');
  const found = r.lines.filter((l) => l.importer).map((l) => [l.specifier, l.reason]);
  assert.deepEqual(found.sort(), [['./src/b.mjs', 'missing-file'], ['https://tags.example/t.js', 'url']]);
});

test('file references are listed only with --file-refs and do not fail the run', () => {
  const r = fixture({ 'src/a.mjs': "const spec = await readFile(new URL('./Product.fs', import.meta.url));" })('--expect-none', '--file-refs');
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines.filter((l) => l.file_ref).map((l) => l.file_ref.specifier), ['./Product.fs']);
});

test('templates render like lodash: evaluate, interpolate and escape tags', () => {
  const html = renderTemplate('<% if (htmlWebpackPlugin.options.next) { %>N<% } else { %>C<% } %>|<%= htmlWebpackPlugin.options.title %>|<%- htmlWebpackPlugin.options.title %>', { next: true, title: '<b>' });
  assert.equal(html, 'N|<b>|&#60;b&#62;');
});

test('sass resolution: partials, extensions and ~packages', () => {
  const files = new Set(['src/parts/_tile.scss', 'src/x.css', 'src/dir/_index.scss']);
  const packages = lockPackages(LOCK);
  assert.equal(resolveSpecifier('src/style.scss', './parts/tile', files, packages, 'scss'), null);
  assert.equal(resolveSpecifier('src/style.scss', 'x', files, packages, 'scss'), null);
  assert.equal(resolveSpecifier('src/style.scss', './dir', files, packages, 'scss'), null);
  assert.equal(resolveSpecifier('src/style.scss', '~bulma/bulma', files, packages, 'scss'), null);
  assert.equal(resolveSpecifier('src/style.scss', '~missing/x', files, packages, 'scss'), 'package-not-in-lock');
  assert.deepEqual([...packages].sort(), ['@scope/pkg', 'bulma', 'nested']);
});
