// README docs test (fm-19eb): every code block in the README is annotated with what this test does with it, and is
// executed against the packed tarball installed into a clean project outside the monorepo (the same packing as
// packages/stylegan-js/test/support/packed*.ts; both tarballs, because the manager depends on stylegan-js).
//
// - `<!-- docs-test: install -->` sh blocks: the install command, run with the packed tarballs in place of the
//   registry name (offline: neither package has a registry dependency).
// - `<!-- docs-test: run <file> -->` ts blocks: the block must be byte-identical to that file under this package; the
//   file is compiled in the clean project against the emitted .d.ts only and run with Node, with every network API
//   refused: a block that makes any request fails. Each prints one JSON line, checked here.
// - A fenced block with no annotation fails the test, so nothing in the README goes unexecuted.
//
// It also checks the statements the README must carry (authorize-then-acquire, no hidden network repair, the
// supported-browser table's unqualified rule), its links, and that it names no FaceMorph deployment value outside a
// labelled example region (scripts/packages/docs-scan.mjs).
//   node --test packages/browser-model-manager/test/docs.test.ts
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
// @ts-expect-error: an untyped .mjs script; scanText(text, file) returns its findings.
import { scanText } from '../../../scripts/packages/docs-scan.mjs';
import { packManagerFresh } from '../../stylegan-js/test/support/packed-manager.ts';
import { packFresh, REPO } from '../../stylegan-js/test/support/packed.ts';

const PKG = join(REPO, 'packages/browser-model-manager');
const PACKAGE_NAME = 'browser-model-manager';
const README = readFileSync(join(PKG, 'README.md'), 'utf8');

interface Block {
  readonly annotation: string | null;
  readonly lang: string;
  readonly code: string;
  readonly line: number;
}

/** Fenced blocks in order, each with the docs-test annotation on the line before its fence (if any). */
function blocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\w*)\s*$/.exec(lines[i]!);
    if (!open) continue;
    const end = lines.findIndex((l, j) => j > i && /^```\s*$/.test(l));
    assert.ok(end > i, `unclosed fence at README line ${i + 1}`);
    const note = /^<!-- docs-test: (.+?) -->$/.exec(lines[i - 1] ?? '');
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
const work = mkdtempSync(join(tmpdir(), 'manager-docs-'));
after(() => rmSync(work, { recursive: true, force: true }));
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('every README code block says how this test executes it', () => {
  assert.ok(all.length > 0);
  const bare = all
    .filter((b) => !b.annotation)
    .map((b) => `line ${b.line} (${b.lang || 'no language'})`);
  assert.deepEqual(bare, [], 'fenced blocks without a docs-test annotation');
  for (const b of all) assert.match(b.annotation!, /^(install|run \S+)$/, `line ${b.line}`);
});

test('the install block installs the packed tarball into a clean project, and every run block runs from it', () => {
  const stylegan = packFresh(work);
  const manager = packManagerFresh(work);
  const consumer = join(work, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'manager-docs-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  // The install block, verbatim apart from the registry name: the tarballs stand in for the published packages.
  const install = all.filter((b) => b.annotation === 'install');
  assert.equal(install.length, 1, 'one install block');
  assert.equal(install[0]!.code.trim(), `npm install ${PACKAGE_NAME}`);
  run(
    'npm',
    [
      'install',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--no-package-lock',
      manager,
      stylegan,
    ],
    consumer,
  );
  assert.ok(existsSync(join(consumer, 'node_modules', PACKAGE_NAME, 'package.json')));
  // The packed README is this README.
  assert.equal(
    readFileSync(join(consumer, 'node_modules', PACKAGE_NAME, 'README.md'), 'utf8'),
    README,
  );

  const runs = all.filter((b) => b.annotation!.startsWith('run '));
  assert.ok(runs.length >= 3, 'the runnable blocks');
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
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        rootDir: 'src',
        outDir: 'out',
        lib: ['es2024', 'dom'],
        types: [],
      },
      include: ['src'],
    }),
  );
  // The repository's compiler, so no registry install is needed; it reads only the clean project's node_modules.
  const tsc = join(REPO, 'node_modules/.bin/tsc');
  let output = '';
  let status = 0;
  try {
    output = run(tsc, ['-p', 'tsconfig.json'], consumer);
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  assert.equal(status, 0, output);
  const ours = run(tsc, ['-p', 'tsconfig.json', '--listFilesOnly'], consumer)
    .split('\n')
    .filter((f) =>
      /\/node_modules\/(?:stylegan-js|browser-model-manager|cloudflare-model-host|@facemorph\/[\w-]+)\//.test(
        f,
      ),
    );
  assert.ok(ours.some((f) => f.includes(`/${PACKAGE_NAME}/`)));
  assert.deepEqual(
    ours.filter((f) => !f.endsWith('.d.ts')),
    [],
    'only the emitted .d.ts were read',
  );

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
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const b of runs) {
    const name = b.annotation!.slice('run '.length).split('/').at(-1)!.replace(/\.ts$/, '.js');
    const out = execFileSync(process.execPath, ['--import', guard, join(consumer, 'out', name)], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    outputs[name] = JSON.parse(out.trim().split('\n').at(-1)!) as Record<string, unknown>;
  }

  // What each block demonstrates, from its own output.
  const acquire = outputs['authorize-then-acquire.js']!;
  assert.equal(acquire['refused'], 'owner-not-in-grant');
  assert.equal(acquire['requests'], 1, 'one request, after authorization');
  assert.equal(acquire['grantRemaining'], 0);
  assert.equal(acquire['localRead'], 3 * 1024 * 1024);
  assert.ok((acquire['progress'] as string[]).length > 3, 'progress moved inside the download');
  const abort = outputs['abort-and-errors.js']!;
  assert.deepEqual(
    [abort['aborted'], abort['shortGrant'], abort['resumedRequests'], abort['corruptRead']],
    ['AbortError', 'revision-required', ['part-2', 'part-3'], 'corrupt'],
  );
  assert.notEqual(abort['partialRead'], 'ok');
  assert.deepEqual(abort['repairedRequests'], ['part-1']);
  assert.equal((abort['quota'] as { code: string }).code, 'quota');
  const leases = outputs['leases-and-eviction.js']!;
  assert.deepEqual(leases['heard'], ['cross-tab-deletion:invalidated', 'browser-eviction:evicted']);
  assert.deepEqual(leases['secondEviction'], { removed: 1, kept: 1 });
});

test('the README states the consent boundary and the no-repair rule, and links what it promises', () => {
  const flat = README.replace(/\s+/g, ' ');
  for (const sentence of [
    'Construction and status reads trigger no acquisition.',
    'Nothing is transferred until the app (or you, as the developer) supplies an approved `AcquisitionGrant`',
    '**No hidden network repair happens during engine operations.**',
    'Getting the bytes back is a new acquisition, which the app starts outside the engine under its own consent policy.',
  ])
    assert.ok(flat.includes(sentence), sentence.slice(0, 60));
  for (const section of [
    '## Install',
    '## Authorize, then acquire',
    '## Progress, abort and errors',
    '## Cache behaviour',
    '## Quota and eviction',
    '## Leases and typed invalidation',
    '## Disposal',
    '## Errors',
    '## Supported browsers',
    '## Troubleshooting',
  ])
    assert.ok(README.includes(`\n${section}\n`), section);
  assert.match(
    flat,
    /Every other browser, version and platform, including Edge and Windows, is unqualified\./,
  );
  for (const link of ['docs/api.md', 'examples/developer-hosted'])
    assert.ok(README.includes(`](${link})`) && existsSync(join(PKG, link)), link);
  assert.match(README, /<!-- model-terms:start -->[\s\S]+<!-- model-terms:end -->/);
});

test('the README and the example README name no FaceMorph deployment value', () => {
  for (const file of ['README.md', 'examples/developer-hosted/README.md'])
    assert.deepEqual(scanText(readFileSync(join(PKG, file), 'utf8'), file), [], file);
});
