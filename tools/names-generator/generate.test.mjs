// The generator end to end (bead fm-a40f): the pinned candidate runtime in real Chromium on real catalogue
// names, killed with SIGKILL after its first row and resumed. Inputs are the published catalogue rows and
// latents, fetched from the name-catalogue Worker (the static host the snapshot copies, not the API).
// Needs Chromium, the classic checkout and network access to the runtime assets; skips, reported, without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, sha256 } from './lib.mjs';
import { openHarness, serve } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLASSIC = process.env.FACEMORPH_CLASSIC ?? join(here, '../../../facemorph.me-classic');
const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';
const CATALOGUE = 'https://facemorph-name-catalogue.cdilga.workers.dev';
const NAMES = ['charlotte', 'saanvi'];
const skip =
  (!existsSync(join(CLASSIC, '.git')) && 'classic checkout unavailable') ||
  (!existsSync(CHROMIUM) && 'chromium unavailable');

const rowLines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('"kind":"row"'))
        .map((l) => JSON.parse(l))
    : [];

// Run the generator; resolves with its exit and log lines. onTick may kill it.
function generate(args, onTick, script = 'generate.mjs', signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [join(here, script), `--classic=${CLASSIC}`, `--chromium=${CHROMIUM}`, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
    );
    // Killing only Node leaves Playwright's driver/browser holding its pipes and persistent profile.
    // Terminate the whole test-owned group, including when the test deadline aborts the run.
    const stop = () => {
      try {
        if (process.platform === 'win32') p.kill('SIGKILL');
        else process.kill(-p.pid, 'SIGKILL');
      } catch (e) {
        if (e.code !== 'ESRCH') throw e;
      }
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    let out = '';
    let err = '';
    const reportAbort = () => {
      console.error('generator child aborted:', script, args, {
        out: out.slice(-8000),
        err: err.slice(-8000),
      });
    };
    signal?.addEventListener('abort', reportAbort, { once: true });
    p.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    p.stderr.on('data', (d) => {
      err += d;
      process.stderr.write(d);
    });
    const tick = onTick && setInterval(() => onTick(p, stop), 100);
    p.on('error', reject);
    p.on('close', (code, exitSignal) => {
      if (tick) clearInterval(tick);
      signal?.removeEventListener('abort', stop);
      signal?.removeEventListener('abort', reportAbort);
      resolve({
        code,
        signal: exitSignal,
        err,
        lines: out
          .split('\n')
          .filter((l) => l.startsWith('{'))
          .map((l) => JSON.parse(l)),
      });
    });
  });
}

test(
  'a killed run resumes without regenerating any valid row; a corrupted file is regenerated alone; zero API requests',
  { skip, timeout: 900_000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-a40f-'));
    // One persistent cache across this test's resume steps, never across test
    // processes. CI and a local run otherwise contend for Chromium's singleton
    // lock in the same global profile.
    const run = (args, onTick, script) =>
      generate([...args, `--cache=${join(dir, 'cache')}`], onTick, script, t.signal);
    try {
      const catalogue = await (await fetch(`${CATALOGUE}/catalogue.json`)).json();
      catalogue.names = catalogue.names.filter((n) => NAMES.includes(n.value));
      writeFileSync(join(dir, 'catalogue.json'), JSON.stringify(catalogue));
      for (const n of catalogue.names) {
        const latentDir = join(
          dir,
          'snapshot',
          'facemorph-name-catalogue.cdilga.workers.dev',
          'latent',
        );
        mkdirSync(latentDir, { recursive: true });
        const bytes = Buffer.from(
          await (await fetch(`${CATALOGUE}/latent/${n.id}.f32`)).arrayBuffer(),
        );
        assert.equal(sha256(bytes), n.latent.sha256);
        writeFileSync(join(latentDir, `${n.id}.f32`), bytes);
      }
      const out = join(dir, 'out');
      const manifest = join(out, 'manifest.jsonl');
      const args = [
        `--catalogue=${join(dir, 'catalogue.json')}`,
        `--latents=${join(dir, 'snapshot')}`,
        `--out=${out}`,
        '--route=cpu',
        '--reference=none',
      ];

      // First run: SIGKILL as soon as one row is in the manifest.
      const first = await run(args, (p, stop) => {
        if (rowLines(manifest).length >= 1 && p.exitCode === null) stop();
      });
      const before = rowLines(manifest);
      assert.ok(before.length >= 1, first.err);
      const kept = before.map((r) => ({
        id: r.id,
        sha: sha256(readFileSync(join(out, r.file))),
        mtime: statSync(join(out, r.file)).mtimeMs,
      }));

      // Resumed run: plans every row written before the kill as reused and finishes the rest.
      const second = await run(args);
      assert.equal(second.code, 0, second.err);
      const planned = second.lines.find((l) => l.event === 'plan');
      assert.equal(planned.reuse, kept.length);
      assert.equal(planned.generate, NAMES.length - kept.length);
      const after = parseManifest(readFileSync(manifest, 'utf8'));
      for (const k of kept) {
        assert.equal(
          rowLines(manifest).filter((r) => r.id === k.id).length,
          1,
          'a valid row was regenerated',
        );
        assert.equal(statSync(join(out, after.rows.get(k.id).file)).mtimeMs, k.mtime);
        assert.equal(sha256(readFileSync(join(out, after.rows.get(k.id).file))), k.sha);
      }
      const summary = second.lines.find((l) => l.event === 'summary');
      assert.equal(summary.valid, NAMES.length);
      for (const r of after.rows.values()) {
        assert.equal(r.latentCheck, 'exact');
        assert.equal(r.referenceLatent.status, 'pass');
        assert.equal(r.envelopeCheck, 'pass');
      }

      // A result file damaged on disk is regenerated, and only that one.
      const victim = after.rows.get(catalogue.names[0].id);
      const bytes = readFileSync(join(out, victim.file));
      bytes[bytes.length >> 1] ^= 1;
      writeFileSync(join(out, victim.file), bytes);
      const third = await run(args);
      assert.equal(third.code, 0, third.err);
      assert.deepEqual(
        (({ reuse, generate: g }) => ({ reuse, g }))(third.lines.find((l) => l.event === 'plan')),
        { reuse: NAMES.length - 1, g: 1 },
      );

      // Every browser request across the runs, by host: none to a retired API host.
      for (const run of [second, third])
        assert.equal(run.lines.find((l) => l.event === 'summary').apiRequests, 0);
      assert.ok(
        Object.keys(third.lines.find((l) => l.event === 'summary').hosts).some(
          (h) => h === 'next.facemorph.me',
        ),
      );

      // Acceptance 3 on these rows: typing each name in a fresh profile gives the catalogue file's latent and
      // identity exactly, and the catalogue latent's synthesis matches within the frozen tolerance.
      const sample = await run([`--out=${out}`, '--samples=2'], null, 'sample-check.mjs');
      assert.equal(sample.code, 0, sample.err);
      const rowsChecked = sample.lines.filter((l) => l.event === 'row');
      assert.deepEqual(
        rowsChecked.map((l) => [l.value, l.ok]).sort(),
        NAMES.map((n) => [n, true]).sort(),
      );
      assert.equal(sample.lines.find((l) => l.event === 'summary').apiRequests, 0);
      // A planted manifest that files one name's result under the other name fails the check.
      const planted = join(dir, 'planted');
      mkdirSync(planted);
      for (const r of after.rows.values()) {
        mkdirSync(join(planted, dirname(r.file)), { recursive: true });
        writeFileSync(join(planted, r.file), readFileSync(join(out, r.file)));
      }
      writeFileSync(
        join(planted, 'manifest.jsonl'),
        readFileSync(manifest, 'utf8').replace(`"value":"${NAMES[1]}"`, `"value":"${NAMES[0]}"`),
      );
      const wrong = await run([`--out=${planted}`, '--samples=2'], null, 'sample-check.mjs');
      assert.equal(wrong.code, 1);
      assert.ok(
        wrong.lines.some(
          (l) => l.event === 'row' && l.problems.includes('latent differs from the typed name'),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'an entry-module load failure has a bounded startup and releases its browser profile',
  { skip, timeout: 45_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'names-broken-entry-'));
    const { server, origin } = await serve(dir); // Real missing source files answer 404.
    const pw = await import('playwright');
    const profile = join(dir, 'profile');
    try {
      await assert.rejects(
        openHarness(pw, { origin, route: 'cpu', chromium: CHROMIUM, profile, hosts: {} }),
        /Timeout.*exceeded/,
      );
      // A second real launch can use the same profile only after the failed
      // startup closed its context and released Chromium's singleton lock.
      const context = await pw.chromium.launchPersistentContext(profile, {
        executablePath: CHROMIUM,
        headless: true,
      });
      await context.close();
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
