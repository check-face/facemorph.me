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
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, sha256 } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLASSIC = process.env.FACEMORPH_CLASSIC ?? join(here, '../../../facemorph.me-classic');
const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';
// Its own cache and browser profiles, so the test never shares a profile with a full run.
const CACHE = join(homedir(), '.cache', 'facemorph-names-generator-test');
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
function generate(args, onTick, script = 'generate.mjs') {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        join(here, script),
        ...args,
        `--classic=${CLASSIC}`,
        `--chromium=${CHROMIUM}`,
        `--cache=${CACHE}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      err += d;
    });
    const tick = onTick && setInterval(() => onTick(p), 100);
    p.on('error', reject);
    p.on('close', (code, signal) => {
      if (tick) clearInterval(tick);
      resolve({
        code,
        signal,
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
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-a40f-'));
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
      const first = await generate(args, (p) => {
        if (rowLines(manifest).length >= 1 && p.exitCode === null) p.kill('SIGKILL');
      });
      const before = rowLines(manifest);
      assert.ok(before.length >= 1, first.err);
      const kept = before.map((r) => ({
        id: r.id,
        sha: sha256(readFileSync(join(out, r.file))),
        mtime: statSync(join(out, r.file)).mtimeMs,
      }));

      // Resumed run: plans every row written before the kill as reused and finishes the rest.
      const second = await generate(args);
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
      const third = await generate(args);
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
      const sample = await generate([`--out=${out}`, '--samples=2'], null, 'sample-check.mjs');
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
      const wrong = await generate([`--out=${planted}`, '--samples=2'], null, 'sample-check.mjs');
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
