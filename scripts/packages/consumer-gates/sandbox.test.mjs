// The import side-effect sandbox (fm-7ge) against planted modules: a clean module passes; a module with a top-level
// side effect (a global write, a built-in prototype change, fetch, a file read, a timer, console output, a storage
// global read) fails; and a seeded side-effecting package fails the packed-package gate end to end (npm pack,
// install into a fresh consumer, import).
//   node --test scripts/packages/consumer-gates/sandbox.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gateInstalledPackage, installConsumer, pack } from './run.mjs';
import { sandboxImport, verdict } from './sandbox.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

/** A consumer directory with node_modules/<name> holding one ESM module. */
function consumerWith(modules) {
  const cwd = temp('sandbox-consumer-');
  for (const [name, code] of Object.entries(modules)) {
    const dir = join(cwd, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', exports: { '.': './index.js' } }),
    );
    writeFileSync(join(dir, 'index.js'), code);
  }
  return cwd;
}

const CLEAN = [
  "import { readFileSync } from 'node:fs';",
  'const g = globalThis;',
  'export const cacheName = "planted-v1";',
  'export function load(u) { return fetch(u); }',
  'export function read(p) { return readFileSync(p); }',
  'export const hasWindow = typeof window !== "undefined";',
  'export class Store { constructor() { this.m = new Map(); } }',
  'export const root = g;',
].join('\n');

const SIDE_EFFECTS = {
  'global-write': ['globalThis.__plantedLeak = 1;', /globals added: __plantedLeak/],
  'global-overwrite': [
    'globalThis.structuredClone = (x) => x;',
    /globals changed: structuredClone/,
  ],
  prototype: [
    'Array.prototype.plantedLast = function () {};',
    /Array\.prototype modified: plantedLast/,
  ],
  fetch: ['fetch("http://127.0.0.1:9/").catch(() => {});', /I\/O or scheduling at import: fetch/],
  'fs-read': [
    "import { existsSync } from 'node:fs';\nexistsSync('/');",
    /I\/O or scheduling at import: node:fs\.existsSync/,
  ],
  timer: ['setInterval(() => {}, 60000);', /I\/O or scheduling at import: setInterval/],
  console: ['console.log("loaded");', /I\/O or scheduling at import: console\.log/],
  'storage-read': [
    'export const db = globalThis.indexedDB;',
    /I\/O or scheduling at import: indexedDB/,
  ],
  'deferred-effect': [
    'Promise.resolve().then(() => { globalThis.__later = true; });',
    /globals added: __later/,
  ],
  env: ['process.env.PLANTED = "1";', /environment changed: PLANTED/],
};

test('a clean module passes and its exports are listed', () => {
  const cwd = consumerWith({ clean: CLEAN });
  const r = sandboxImport({ cwd, specifier: 'clean' });
  assert.deepEqual(verdict(r), []);
  assert.deepEqual(r.exportNames, ['Store', 'cacheName', 'hasWindow', 'load', 'read', 'root']);
});

for (const [name, [code, expected]] of Object.entries(SIDE_EFFECTS)) {
  test(`a top-level side effect fails the sandbox: ${name}`, () => {
    const cwd = consumerWith({ [`fx-${name}`]: `${code}\nexport const x = 1;\n` });
    const problems = verdict(sandboxImport({ cwd, specifier: `fx-${name}` }));
    assert.ok(
      problems.some((p) => expected.test(p)),
      `${name}: ${JSON.stringify(problems)}`,
    );
  });
}

test('a module that cannot load fails', () => {
  const cwd = consumerWith({ broken: "import './missing.js';\n" });
  assert.match(verdict(sandboxImport({ cwd, specifier: 'broken' }))[0], /did not load/);
});

test('the sandbox denies writes: a module that writes a file fails to load, not silently', () => {
  const cwd = consumerWith({
    writer: "import { writeFileSync } from 'node:fs';\nwriteFileSync('planted.txt', 'x');\n",
  });
  const p = verdict(sandboxImport({ cwd, specifier: 'writer' }));
  assert.ok(
    p.some((x) =>
      /did not load: .*(?:ERR_ACCESS_DENIED|Access to this API has been restricted)/s.test(x),
    ),
    JSON.stringify(p),
  );
});

test('a seeded side-effecting import fails the packed-package gate; the clean one passes', () => {
  const src = temp('sandbox-planted-');
  const packs = temp('sandbox-packs-');
  const tarballs = [];
  for (const [name, code] of [
    ['planted-clean', CLEAN],
    ['planted-dirty', `${CLEAN}\nglobalThis.__plantedLeak = fetch;\n`],
  ]) {
    const dir = join(src, name);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '0.0.0',
        type: 'module',
        exports: { '.': { default: './dist/index.js' } },
        files: ['dist'],
      }),
    );
    writeFileSync(join(dir, 'dist/index.js'), code);
    tarballs.push(pack(dir, packs));
  }
  const consumer = join(temp('sandbox-install-'), 'consumer');
  installConsumer(consumer, tarballs);
  const clean = gateInstalledPackage({ consumer, name: 'planted-clean' });
  assert.equal(clean.ok, true, JSON.stringify(clean));
  const dirty = gateInstalledPackage({ consumer, name: 'planted-dirty' });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.failures, []);
  assert.ok(dirty.sideEffects.some((p) => /planted-dirty: globals added: __plantedLeak/.test(p)));
  assert.ok(
    dirty.sideEffects.some((p) => /planted-dirty: I\/O or scheduling at import: fetch/.test(p)),
  );
});
