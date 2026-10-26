// README docs test (fm-tohj): every code block in the README is annotated with what this test does with it, and is
// executed against the packed tarball installed into a clean project outside the monorepo (support/packed.ts).
//
// - `<!-- docs-test: install -->` sh blocks: the install command, run with the packed tarball in place of the
//   registry name.
// - `<!-- docs-test: run <file> -->` ts blocks: the block must be byte-identical to that file under this package; the
//   file is compiled in the clean project against the emitted .d.ts only and run with Node, with every network API
//   intercepted: a block that makes any request fails.
// - A fenced block with no annotation fails the test, so nothing in the README goes unexecuted.
//
// It also checks the sentences the README must carry (no-training scope, the e4e limitation, recovery semantics)
// and that its supported-shape table equals the qualified rows of model-conv's compatibility table.
//   node --test packages/stylegan-js/test/docs.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  compileClean,
  installClean,
  PACKAGE_NAME,
  packFresh,
  PKG,
  REPO,
  repoVersion,
} from './support/packed.ts';

const README = readFileSync(join(PKG, 'README.md'), 'utf8');

interface Block {
  readonly annotation: string | null;
  readonly lang: string;
  readonly code: string;
  readonly line: number;
}

/** Fenced blocks in order, each with the docs-test annotation on the line before its fence (if any). */
export function blocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\w*)\s*$/.exec(lines[i]!);
    if (!open) continue;
    const end = lines.findIndex((l, j) => j > i && /^```\s*$/.test(l));
    assert.ok(end > i, `unclosed fence at README line ${i + 1}`);
    const prev = lines[i - 1] ?? '';
    const note = /^<!-- docs-test: (.+?) -->$/.exec(prev);
    out.push({
      annotation: note ? note[1]! : null,
      lang: open[1]!,
      code: lines.slice(i + 1, end).join('\n'),
      line: i + 1,
    });
    i = end;
  }
  return out;
}

const all = blocks(README);
const work = mkdtempSync(join(tmpdir(), 'stylegan-js-docs-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('every README code block says how this test executes it', () => {
  assert.ok(all.length > 0);
  const bare = all
    .filter((b) => !b.annotation)
    .map((b) => `line ${b.line} (${b.lang || 'no language'})`);
  assert.deepEqual(bare, [], 'fenced blocks without a docs-test annotation');
  for (const b of all) assert.match(b.annotation!, /^(install|run \S+)$/, `line ${b.line}`);
});

test('the install block installs the packed tarball into a clean project, and every run block runs from it', () => {
  const tarball = packFresh(work);
  const consumer = join(work, 'consumer');
  // The install block, verbatim apart from the registry name: the tarball stands in for the published package.
  const install = all.filter((b) => b.annotation === 'install');
  assert.equal(install.length, 1, 'one install block');
  const command = install[0]!.code.trim();
  assert.equal(command, `npm install ${PACKAGE_NAME}`);
  installClean(consumer, tarball, [`typescript@${repoVersion('typescript')}`]);
  assert.ok(existsSync(join(consumer, 'node_modules', PACKAGE_NAME, 'package.json')));

  const runs = all.filter((b) => b.annotation!.startsWith('run '));
  assert.ok(runs.length > 0, 'at least one runnable block');
  const src = join(consumer, 'src');
  mkdirSync(src, { recursive: true });
  for (const b of runs) {
    const file = b.annotation!.slice('run '.length);
    const body = readFileSync(join(PKG, file), 'utf8');
    assert.equal(b.code, body.replace(/\n$/, ''), `README line ${b.line} must equal ${file}`);
    copyFileSync(join(PKG, file), join(src, file.split('/').at(-1)!));
  }
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2024',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        rootDir: 'src',
        outDir: 'out',
        lib: ['es2024', 'dom'],
      },
      include: ['src'],
    }),
  );
  const compiled = compileClean(consumer);
  assert.equal(compiled.status, 0, compiled.output);
  assert.deepEqual(compiled.sources, [], 'only the emitted .d.ts were read');

  // Every network API refuses and is counted; a block that makes any request fails.
  const guard = join(consumer, 'no-network.mjs');
  writeFileSync(
    guard,
    [
      "import http from 'node:http'; import https from 'node:https'; import net from 'node:net';",
      'const refuse = (what) => () => { process.exitCode = 3; throw new Error(`docs block made a request: ${what}`); };',
      "globalThis.fetch = refuse('fetch'); globalThis.WebSocket = refuse('WebSocket');",
      "for (const m of [http, https]) { m.request = refuse('http.request'); m.get = refuse('http.get'); }",
      "net.connect = refuse('net.connect'); net.createConnection = refuse('net.createConnection');",
    ].join('\n'),
  );
  for (const b of runs) {
    const name = b.annotation!.slice('run '.length).split('/').at(-1)!.replace(/\.ts$/, '.js');
    const out = execFileSync(process.execPath, ['--import', guard, join(consumer, 'out', name)], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(out.trim().length > 0, `${name} printed its result`);
  }
});

test('the README states the scope, the e4e limitation and the recovery semantics', () => {
  const flat = README.replace(/\s+/g, ' ');
  for (const sentence of [
    'Using a new dataset means acquiring or training a compatible StyleGAN2 checkpoint first; this project does not train models.',
    'Photo-to-latent inversion needs a separately trained encoder compatible with the generator. The shipped FFHQ e4e encoder works only for the FFHQ face generator; it is not a generic encoder. Non-face generation and morphs load no face detector and no e4e encoder.',
    'Recovery semantics: stills are written as schema 3 (dynamic shape: the generator record and the W+ shape come from the model descriptor). Schema-1 PNG and schema-2 PNG and WebP files are still read. Combining equal-shaped latents from different checkpoints is refused with a typed error (`mixed-model`). A file from a model you do not have stays viewable as media, without editable inference, and URLs found in its metadata are never followed.',
  ])
    assert.ok(flat.includes(sentence), sentence.slice(0, 60));
  // The e4e limitation comes before any encoder snippet or photo example.
  const limitation = README.indexOf('Photo-to-latent inversion needs');
  for (const word of ['loadStreamedEncoder', 'loadEncoderRuntime', 'encode('])
    assert.ok(README.indexOf(word) === -1 || README.indexOf(word) > limitation, word);
  // Non-face support is labelled unqualified and never called generic dataset support.
  assert.match(
    flat,
    /Non-face support is \*\*unqualified\*\* until the joint non-face proof passes/,
  );
  assert.match(flat, /that is not generic dataset support/);
});

test('the supported-shape table equals the qualified rows of the model-conv compatibility table', () => {
  const rows = (table: string) =>
    table
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
      .slice(1)
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      );
  const section = /<!-- docs-test: supported-shapes -->\n([\s\S]*?)<!-- docs-test: end -->/.exec(
    README,
  );
  assert.ok(section, 'the supported-shapes table is marked');
  const readme = rows(section[1]!)
    .map(([, res, zw]) => `${res} | ${zw}`)
    .sort();

  const compat = readFileSync(join(REPO, 'packages/model-conv/docs/compatibility.md'), 'utf8');
  const checkpoints = /## Checkpoints\n([\s\S]*?)\n## /.exec(compat)![1]!;
  const qualified = rows(checkpoints)
    .filter((cells) => (cells[6] ?? '').startsWith('**qualified'))
    .map((cells) => `${cells[4]} | ${cells[5]}`)
    .sort();
  assert.ok(qualified.length >= 1, 'the compatibility table has qualified rows');
  assert.deepEqual(readme, qualified);
});
