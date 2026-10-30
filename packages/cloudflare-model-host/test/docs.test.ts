// Host docs test (fm-19eb): every code block in the README and the two hosting guides is annotated with what this
// test does with it, and is executed from the packed tarballs installed into a clean project outside the monorepo.
// This package, browser-model-manager and stylegan-js are built fresh from their sources and
// `npm pack`ed (stylegan-js's test/support/packed.ts and packed-manager.ts; packHostFresh below), never the
// checkout's dist/. The converted AFHQ cat model (packages/model-conv/out/afhqcat, FACEMORPH_AFHQ_CAT; gitignored)
// is the fixture: the README quickstart stages it, verifies it, publishes it to a directory, serves that with the
// documented headers from a local HTTPS server, qualifies the origin, and then the packed manager, in Playwright
// Chromium on a second local origin, acquires every asset under a grant and reads each back verified.
//
// Annotations (the line before the fence):
//   install               the install command; run with the tarballs in place of the registry names
//   run                   sh, run verbatim with bash in the clean project
//   file <path>           written verbatim to <path> in the clean project
//   output <path>         <path> in the clean project must equal the block after the runs before it
//   background <port>     sh started in the background; waited on until it answers on <port>; stopped after the doc
//   set-origin            only `export NAME=value` lines; the values are the doc's placeholders. The static guide's
//                         MODEL_ORIGIN is replaced by a local origin serving its ./public (reported as such)
//   cloudflare-dry-run    run verbatim with no Cloudflare credentials and an empty home: it must need no account
//   needs-test-origin     changes a Cloudflare account or reads a deployed origin: reported untested, never run
// A fenced block with no annotation fails the test.
//   node --test packages/cloudflare-model-host/test/docs.test.ts
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test, { after, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachPlaywright, DEFAULT_HOST_MAP } from '../../../scripts/ci/intercept/playwright.ts';
import { bindOrigins, requestsIn, step } from '../../../scripts/ci/intercept/record.ts';
import { packManagerFresh } from '../../stylegan-js/test/support/packed-manager.ts';
import { installClean, packFresh, releaseTarball } from '../../stylegan-js/test/support/packed.ts';

const PKG = fileURLToPath(new URL('../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DOCS = ['README.md', 'docs/static-hosting.md', 'docs/cloudflare.md'] as const;
const MODEL = process.env['FACEMORPH_AFHQ_CAT'] ?? join(REPO, 'packages/model-conv/out/afhqcat');
const UNTESTED = existsSync(join(MODEL, 'manifest.json'))
  ? false
  : `untested: the converted AFHQ cat model is not at ${MODEL} (set FACEMORPH_AFHQ_CAT)`;
const ANNOTATION =
  /^(install|run|set-origin|cloudflare-dry-run|needs-test-origin|file \S+|output \S+|background \d+)$/;

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
    assert.ok(end > i, `unclosed fence at line ${i + 1}`);
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
const docBlocks = (doc: string) => blocks(readFileSync(join(PKG, doc), 'utf8'));

/** GitHub's heading anchor. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
const anchors = (file: string) =>
  new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => /^#{1,6} /.test(l))
      .map((l) => slug(l.replace(/^#+ /, ''))),
  );

test('every README and guide code block says how this test executes it', () => {
  for (const doc of DOCS) {
    const all = docBlocks(doc);
    assert.ok(all.length > 0, doc);
    const bare = all.filter((b) => !b.annotation).map((b) => `${doc}:${b.line} (${b.lang || '-'})`);
    assert.deepEqual(bare, [], 'fenced blocks without a docs-test annotation');
    for (const b of all) assert.match(b.annotation!, ANNOTATION, `${doc}:${b.line}`);
  }
});

test('every relative link in the README and guides resolves, anchors included', () => {
  const broken: string[] = [];
  for (const doc of DOCS) {
    const text = readFileSync(join(PKG, doc), 'utf8');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1]!;
      if (/^[a-z]+:/i.test(href)) continue;
      const [path, anchor] = href.split('#') as [string, string | undefined];
      const target = path ? join(dirname(join(PKG, doc)), path) : join(PKG, doc);
      if (!existsSync(target)) broken.push(`${doc}: ${href} (no file)`);
      else if (anchor && statSync(target).isFile() && !anchors(target).has(anchor))
        broken.push(`${doc}: ${href} (no heading)`);
    }
  }
  assert.deepEqual(broken, []);
});

// --- The clean project, from the packed tarballs ---------------------------------------------------------------

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  });

/** Builds this package's src/ against the freshly staged manager declarations and packs it; the tarball path. */
function packHostFresh(work: string, managerStage = join(work, 'manager-stage')): string {
  const given = releaseTarball('cloudflare-model-host');
  if (given) return given;
  const stage = join(work, 'host-stage');
  mkdirSync(stage, { recursive: true });
  const config = join(stage, 'tsconfig.build.json');
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        extends: join(PKG, 'tsconfig.build.json'),
        compilerOptions: {
          rootDir: join(PKG, 'src'),
          outDir: join(stage, 'dist'),
          // Outside the repository, @types/node is found only from here.
          typeRoots: [join(REPO, 'node_modules/@types')],
          paths: { 'browser-model-manager': [join(managerStage, 'dist/index.d.ts')] },
        },
        include: [join(PKG, 'src')],
      },
      null,
      2,
    )}\n`,
  );
  run(join(REPO, 'node_modules/.bin/tsc'), ['-p', config], stage);
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { files: string[] };
  for (const f of pkg.files.filter((f) => f !== 'dist')) {
    mkdirSync(dirname(join(stage, f)), { recursive: true });
    cpSync(join(PKG, f), join(stage, f), { recursive: true, dereference: true });
  }
  copyFileSync(join(PKG, 'package.json'), join(stage, 'package.json'));
  const out = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], stage)) as {
    filename: string;
  }[];
  return join(work, out[0]!.filename);
}

const work = mkdtempSync(join(tmpdir(), 'model-host-docs-'));
const consumer = join(work, 'consumer');
const children: ChildProcess[] = [];
const stop = () => {
  for (const c of children.splice(0)) if (c.pid && c.exitCode === null) process.kill(-c.pid);
};
after(() => {
  stop();
  rmSync(work, { recursive: true, force: true });
});

let installed: Error | true | null = null;
/** Packs the three packages and installs them into the clean project, once. */
function install(): void {
  if (installed === true) return;
  if (installed) throw installed;
  try {
    const stylegan = packFresh(work);
    const manager = packManagerFresh(work);
    const host = packHostFresh(work);
    const block = docBlocks('README.md').filter((b) => b.annotation === 'install');
    assert.equal(block.length, 1, 'one install block');
    assert.equal(block[0]!.code.trim(), 'npm install cloudflare-model-host browser-model-manager');
    installClean(consumer, stylegan, [manager, host]);
    for (const p of ['cloudflare-model-host', 'browser-model-manager'])
      assert.ok(existsSync(join(consumer, 'node_modules', p, 'package.json')), p);
    // The installed package is the packed build, not a link to the workspace.
    assert.ok(!statSync(join(consumer, 'node_modules/cloudflare-model-host')).isSymbolicLink());
    symlinkSync(MODEL, join(consumer, 'converted'), 'dir');
    installed = true;
  } catch (e) {
    installed = e as Error;
    throw e;
  }
}

/** The environment blocks run in: the parent's, without npm's per-run variables (workspace selection and so on). */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k) && k !== 'INIT_CWD'),
  );
  return { ...env, ...extra };
}

/** Without Cloudflare credentials and with an empty home: a request to the API could not authenticate. */
function noAccountEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(work, 'home-'));
  const env = Object.fromEntries(
    Object.entries(base).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k)),
  );
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    CF_SEND_TELEMETRY: 'false',
    // Miniflare otherwise fetches workers.cloudflare.com/cf.json.
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
  };
}

const portFree = (port: number) =>
  new Promise<boolean>((done) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), done(false)));
    s.once('error', () => done(true));
  });
async function waitForPort(port: number, child: ChildProcess, log: () => string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) assert.fail(`background exited ${child.exitCode}: ${log()}`);
    if (!(await portFree(port))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`nothing answered on ${port}: ${log()}`);
}
async function background(code: string, port: number, env: NodeJS.ProcessEnv): Promise<void> {
  assert.ok(await portFree(port), `port ${port} is already in use`);
  const child = spawn('bash', ['-c', code], { cwd: consumer, env, detached: true });
  children.push(child);
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  await waitForPort(port, child, () => log);
}

/** The JSON reports a block's commands printed, one per line. */
const reports = (stdout: string) =>
  stdout
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

interface Ran {
  readonly reports: Record<string, unknown>[];
  readonly untested: string[];
}

/** Runs every block of `doc` in order in the clean project. */
async function runDoc(
  t: TestContext,
  doc: string,
  options: {
    env?: Record<string, string>;
    origins?: Record<string, string>;
    /** Called after each block that ran, with its location and (for a command) its stderr. */
    afterBlock?: (where: string, block: Block, stderr: string) => void;
  } = {},
): Promise<Ran> {
  const out: Ran = { reports: [], untested: [] };
  let env = cleanEnv(options.env);
  for (const b of docBlocks(doc)) {
    const where = `${doc}:${b.line}`;
    let stderr = '';
    const a = b.annotation!;
    const sh = (e: NodeJS.ProcessEnv) => {
      const r = spawnSync('bash', ['-euo', 'pipefail', '-c', b.code], {
        cwd: consumer,
        env: e,
        encoding: 'utf8',
        maxBuffer: 1 << 26,
      });
      assert.equal(r.status, 0, `${where} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
      const got = reports(r.stdout);
      for (const g of got) t.diagnostic(`${where}: ${JSON.stringify(g).slice(0, 400)}`);
      out.reports.push(...got);
      stderr = r.stderr;
      return { got, stderr: r.stderr };
    };
    if (a === 'install') continue; // done by install()
    if (a === 'run') sh(env);
    else if (a.startsWith('file ')) {
      const path = join(consumer, a.slice(5));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${b.code}\n`);
    } else if (a.startsWith('output ')) {
      assert.equal(readFileSync(join(consumer, a.slice(7)), 'utf8'), `${b.code}\n`, where);
    } else if (a.startsWith('background ')) {
      await background(b.code, Number(a.slice(11)), env);
    } else if (a === 'set-origin') {
      const vars: Record<string, string> = {};
      for (const l of b.code.split('\n')) {
        const m = /^export ([A-Z_]+)=(https:\/\/\S+)$/.exec(l);
        assert.ok(m, `${where}: only export NAME=https://… lines`);
        vars[m[1]!] = options.origins?.[m[1]!] ?? m[2]!;
        if (options.origins?.[m[1]!])
          t.diagnostic(`${where}: ${m[1]} ${m[2]} replaced by the test origin ${vars[m[1]!]}`);
      }
      env = { ...env, ...vars };
    } else if (a === 'cloudflare-dry-run') {
      const { got, stderr } = sh(noAccountEnv(env));
      const last = got.at(-1);
      assert.deepEqual(
        [last?.['published'], last?.['status'], last?.['refused'] ?? null],
        [false, 0, null],
        where,
      );
      assert.match(stderr, /--dry-run: exiting now/, `${where}: cf deploy ran as a dry run`);
    } else if (a === 'needs-test-origin') {
      const why = `untested: ${where} needs a Cloudflare account and a test origin: ${b.code.replace(/\s*\\\n\s*/g, ' ').replace(/\n/g, '; ')}`;
      out.untested.push(why);
      await t.test(
        `${where} (needs a Cloudflare account and a test origin)`,
        { skip: why },
        () => {},
      );
    } else assert.fail(`${where}: unknown annotation ${a}`);
    options.afterBlock?.(where, b, stderr);
  }
  return out;
}

const listFiles = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split('\\').join('/'))
    .sort();

/** The guides build on the README quickstart's files (terms.json, serve.mjs, tls/). */
let readmeRan = false;
const afterReadme = () =>
  assert.ok(readmeRan, 'the README quickstart did not run to the end, and the guides build on it');

type Page = {
  goto(u: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForFunction(fn: () => boolean, arg?: unknown, o?: { timeout: number }): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  on(e: 'console', fn: (m: { type(): string; text(): string }) => void): unknown;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o?: object): Promise<Context>; close(): Promise<void> };
const pw = createRequire(join(REPO, 'apps/web/package.json'))('playwright') as Record<
  'chromium',
  { launch(o: object): Promise<Browser> }
>;

test(
  'README quickstart from the packed tarballs: stage, verify, publish, serve, qualify, and the manager loads it in Chromium',
  { skip: UNTESTED, timeout: 1_800_000 },
  async (t) => {
    for (const port of [8443, 8444]) assert.ok(await portFree(port), `port ${port} is in use`);
    let started = performance.now();
    install();
    t.diagnostic(`pack and install ${Math.round(performance.now() - started)} ms`);
    started = performance.now();
    t.after(stop);
    const ran = await runDoc(t, 'README.md');
    readmeRan = true;
    t.diagnostic(`README blocks ${Math.round(performance.now() - started)} ms`);

    const staged = join(consumer, 'staged');
    const manifest = JSON.parse(readFileSync(join(staged, 'manifest.json'), 'utf8')) as Record<
      string,
      { sha256?: string; size?: number } | { sha256: string; size: number }[]
    >;
    const files = listFiles(staged);
    const verify = ran.reports.find((r) => 'largestFile' in r);
    assert.equal(verify?.['ok'], true, 'verify ok');
    const qualify = ran.reports.find((r) => 'mismatched' in r);
    assert.equal(qualify?.['ok'], true, `qualify-origin ok: ${JSON.stringify(qualify)}`);
    assert.equal(qualify?.['files'], files.length);
    const published = ran.reports.filter((r) => 'writes' in r);
    assert.deepEqual(
      published.map((r) => [r['published'], r['refused']]),
      [
        [false, null],
        [true, null],
      ],
      'a dry run, then the publication',
    );
    assert.deepEqual(listFiles(join(consumer, 'site/models')), files, 'published byte set');

    const assets = [
      manifest['mapping'],
      manifest['synthesis'],
      ...(manifest['average'] ? [manifest['average']] : []),
      ...(manifest['noise'] as { sha256: string; size: number }[]),
    ] as { sha256: string; size: number }[];
    const bytes = assets.reduce((n, a) => n + a.size, 0);

    const browser = await pw.chromium.launch({}).catch(() => null);
    if (!browser) return t.skip('untested: Playwright Chromium does not start here');
    t.after(() => browser.close());
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const app = 'https://localhost:8444';
    const models = 'https://localhost:8443';
    const net = attachPlaywright(
      context as never,
      bindOrigins(DEFAULT_HOST_MAP, { app: [app], 'model-host': [models] }),
    );
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') t.diagnostic(`console error: ${m.text().slice(0, 300)}`);
    });
    step(net.rec, 'open');
    await page.goto(`${app}/`);
    await net.settled();
    step(net.rec, 'load');
    started = performance.now();
    await page.click('#load');
    await page.waitForFunction(
      () => (document.querySelector('#report')?.textContent ?? '') !== '',
      undefined,
      { timeout: 600_000 },
    );
    const report = (await page.textContent('#report')) ?? '';
    const loadMs = performance.now() - started;
    await net.settled();
    assert.equal(
      report,
      `verified ${assets.length} assets, ${bytes} bytes, from ${models}/models/`,
    );

    const opened =
      requestsIn(net.rec, { fromStep: 'open', toStep: 'open' }, () => {}).requests ?? [];
    const loaded =
      requestsIn(net.rec, { fromStep: 'load', toStep: 'load' }, () => {}).requests ?? [];
    assert.deepEqual(
      opened.filter((r) => r.hostClass !== 'app').map((r) => r.url),
      [],
      'nothing but the page itself before the press',
    );
    for (const r of [...opened, ...loaded])
      assert.ok(['app', 'model-host', 'local'].includes(r.hostClass), `${r.hostClass} ${r.url}`);
    const fromHost = loaded.filter((r) => r.hostClass === 'model-host');
    for (const r of fromHost) assert.equal(r.status, 200, r.url);
    // The page reads the manifest; the manager reads each unchunked asset whole and a chunked one only by chunks.
    const paths = [
      ...new Set(fromHost.map((r) => new URL(r.url).pathname.slice('/models/'.length))),
    ];
    assert.deepEqual(
      paths.sort(),
      files,
      'every staged file requested from the model origin, nothing else',
    );
    const by = (rs: { hostClass: string }[]) =>
      JSON.stringify(
        rs.reduce<Record<string, number>>(
          (o, r) => ((o[r.hostClass] = (o[r.hostClass] ?? 0) + 1), o),
          {},
        ),
      );
    t.diagnostic(
      `manager: ${report} in ${Math.round(loadMs)} ms; requests at open ${by(opened)}, at load ${by(loaded)}; ` +
        `${paths.length} distinct model-origin paths for ${files.length} staged files`,
    );
    await context.close();
  },
);

test(
  'static hosting guide from the packed tarball, against a local origin serving its ./public',
  { skip: UNTESTED, timeout: 600_000 },
  async (t) => {
    afterReadme();
    t.after(stop);
    const port = 8445;
    const origin = `https://localhost:${port}`;
    await background(`node serve.mjs ./public ${port}`, port, cleanEnv());
    const ran = await runDoc(t, 'docs/static-hosting.md', {
      origins: { MODEL_ORIGIN: origin },
      env: { NODE_EXTRA_CA_CERTS: join(consumer, 'tls/cert.pem') },
    });
    const qualify = ran.reports.find((r) => 'mismatched' in r);
    assert.equal(qualify?.['ok'], true, JSON.stringify(qualify));
    assert.equal(qualify?.['origin'], origin);
    assert.deepEqual(ran.untested, []);
  },
);

test(
  'Cloudflare guide from the packed tarball: local steps and cf dry runs run; account-changing steps are reported untested',
  { skip: UNTESTED, timeout: 900_000 },
  async (t) => {
    afterReadme();
    // The dry-run builds: the origin's assets hold the release at its base path and the rules, with no Worker
    // script; the mirror's Worker has its bindings. cf names the assets directory it read.
    const checked: string[] = [];
    const ran = await runDoc(t, 'docs/cloudflare.md', {
      afterBlock: (where, b, stderr) => {
        if (b.annotation !== 'cloudflare-dry-run') return;
        if (b.code.includes('origin-deploy')) {
          const read = /Read (\d+) files from the assets directory (\S+)/.exec(stderr);
          assert.ok(read, `${where}: cf read the assets directory\n${stderr}`);
          const assetsDir = read[2]!;
          const rules = readFileSync(join(assetsDir, '_headers'), 'utf8');
          assert.match(
            rules,
            /^\/models\/my-model-v1\/chunks\/\*\n {2}Cache-Control: public/m,
            where,
          );
          const release = listFiles(join(assetsDir, 'models/my-model-v1'));
          assert.deepEqual(
            release,
            listFiles(join(consumer, 'cf-public/models/my-model-v1')),
            where,
          );
          assert.match(stderr, /No bindings found/, `${where}: no Worker script or bindings`);
          t.diagnostic(`${where}: cf read ${read[1]} files, ${release.length} of them the release`);
          checked.push('origin');
        } else if (b.code.includes('mirror-deploy')) {
          for (const binding of [
            /env\.MIRROR \(my-model-mirror\)\s+R2 Bucket/,
            /env\.UPSTREAM \("https:\/\/my-model-origin\./,
            /env\.PREFIXES \("models\/my-model-v1\/chunks\/"\)/,
          ])
            assert.match(stderr, binding, where);
          checked.push('mirror');
        }
      },
    });
    assert.deepEqual(checked, ['origin', 'mirror'], 'both dry runs were checked');
    const verify = ran.reports.find((r) => 'largestFile' in r);
    assert.equal(verify?.['ok'], true);
    const warm = ran.reports.find((r) => 'held' in r);
    assert.deepEqual(
      [warm?.['published'], warm?.['requests'], warm?.['held']],
      [false, 0, 0],
      'warm without --publish requests nothing',
    );
    const chunks = listFiles(join(consumer, 'cf-public/models/my-model-v1')).filter((p) =>
      p.startsWith('chunks/'),
    );
    assert.equal(warm?.['paths'], chunks.length, 'warm lists every chunk under the prefix');
    assert.ok(ran.untested.length > 0);
    for (const u of ran.untested) t.diagnostic(u);
  },
);
