#!/usr/bin/env node
// Restore check for the names snapshot (bead fm-old): runs restore.mjs in a child process with every
// outbound connection recorded (net-recorder.mjs), then tallies connections and bytes by host class.
// Passes only if the restore completed with matching hashes, the store was reached, and no connection went
// to a retired API host or a source Worker. With --record-summary the result goes into manifest-summary.json.
//
//   node check-restore.mjs --sample=200 --mint-r2=<account id> --record-summary
//
// Exit codes: 0 pass, 22 fail, 2 usage.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_PATH, SUMMARY_PATH, parseArgs, sha256 } from './snapshot.mjs';
import { classify, tally } from './net-recorder.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// args: restore.mjs arguments (without --out); store: the store's host or host:port; sources: extra
// host[:port] entries that count as source Workers (the real two always do).
export async function checkRestore({ args, env = process.env, store, sources = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'fm-old-restore-'));
  const record = join(dir, 'connections.jsonl');
  try {
    const child = await new Promise((done, fail) => {
      const p = spawn(process.execPath, ['--import', join(here, 'net-recorder.mjs'), join(here, 'restore.mjs'), `--out=${join(dir, 'out')}`, ...args], {
        env: { ...env, NET_RECORD: record }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('error', fail);
      p.on('close', (status) => done({ status, stdout, stderr }));
    });
    const lines = child.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    const result = lines.find((l) => l.event === 'restore') ?? null;
    const connections = existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const byClass = tally(connections, (c) => classify(c, { store, sources }));
    const pass = child.status === 0 && result?.complete === true && byClass.store.connections > 0
      && byClass['retired-api'].connections === 0 && byClass['retired-api'].bytes === 0 && byClass['source-worker'].connections === 0;
    return { pass, exitCode: child.status, result, byClass, stderr: child.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const passthrough = process.argv.slice(2).filter((x) => !/^--(record-summary|summary)(=|$)/.test(x));
  if (!(a.names || a.sample || a.all)) {
    console.error('usage: check-restore.mjs (--names=a,b | --sample=N | --all) [--bucket=] [--mint-r2=<account id>] [--record-summary]');
    process.exit(2);
  }
  const store = a['mint-r2'] ? `${a['mint-r2']}.r2.cloudflarestorage.com` : new URL(process.env.S3_ENDPOINT).host;
  const r = await checkRestore({ args: passthrough, store });
  console.log(JSON.stringify({ event: 'check-restore', pass: r.pass, exitCode: r.exitCode, ...r.result, connectionsByHostClass: r.byClass }));
  if (!r.pass && r.stderr) console.error(r.stderr);
  if (a['record-summary'] && r.pass) {
    const text = readFileSync(a.manifest ? resolve(a.manifest) : MANIFEST_PATH, 'utf8');
    const summaryPath = a.summary ? resolve(a.summary) : SUMMARY_PATH;
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    if (summary.manifest.sha256 !== sha256(text)) throw new Error('summary describes a different manifest');
    summary.restoreCheck = {
      at: new Date().toISOString(), bucket: a.bucket ?? summary.store?.bucket, selected: r.result.selected, restoredWithMatchingHashes: r.result.restored,
      bytes: r.result.bytes, connectionsByHostClass: r.byClass,
    };
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.exitCode = r.pass ? 0 : 22;
}
