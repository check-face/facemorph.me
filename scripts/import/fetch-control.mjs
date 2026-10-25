#!/usr/bin/env node
// Fetches the control artifact from this repository's release asset into a scratch directory and verifies it
// against import/control-artifact.json: the zip's sha256, then every file (none missing, none extra, none
// changed). Every golden, parity or freeze script calls fetchControl() first and fails closed (fm-gpx).
//   node scripts/import/fetch-control.mjs [--dest <dir>]     download, unpack and verify
//   node scripts/import/fetch-control.mjs --store <dir>      verify an unpacked store already on disk
// One JSON line per finding, then a summary naming the source identity; exit 1 on any mismatch.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { line, options, sha256 } from '../inventory/lib.mjs';
import { readControl, storeFindings, unzip } from './control.mjs';

/**
 * Returns {dir, record, findings}; throws when the control cannot be trusted, so callers stop at once.
 * @param {{ dest?: string, store?: string, record?: ReturnType<typeof readControl>, log?: (value: unknown) => void }} [options]
 */
export async function fetchControl({ dest, store, record = readControl(), log = () => {} } = {}) {
  const findings = [];
  let dir = store && resolve(store);
  if (!dir) {
    dir = resolve(dest ?? mkdtempSync(join(tmpdir(), 'control-')));
    mkdirSync(dir, { recursive: true });
    // The API asset URL (accept: octet-stream) serves anonymous requests; a CI token only raises the rate limit.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const res = await fetch(record.release.api_url, {
      headers: {
        accept: 'application/octet-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    const actual = sha256(bytes);
    log({
      fetched: record.release.api_url,
      status: res.status,
      bytes: bytes.length,
      expected: record.release.sha256,
      actual,
    });
    if (!res.ok)
      findings.push({
        problem: `release asset answered HTTP ${res.status}`,
        url: record.release.api_url,
      });
    else if (actual !== record.release.sha256)
      findings.push({
        problem: 'release asset digest mismatch',
        expected: record.release.sha256,
        actual,
      });
    else {
      const zip = join(dir, record.release.asset);
      writeFileSync(zip, bytes);
      dir = join(dir, 'tree');
      unzip(zip, dir);
    }
  }
  if (!findings.length) findings.push(...storeFindings(dir, record.files));
  for (const f of findings) log(f);
  if (findings.length)
    throw Object.assign(
      new Error(`control artifact failed verification (${findings.length} finding(s))`),
      { findings },
    );
  return { dir, record, findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const record = readControl();
  const source = {
    label: record.label,
    repository: record.source.repository,
    run_id: record.source.run_id,
    commit: record.source.commit,
    artifact: record.source.artifact_name,
  };
  try {
    const { dir } = await fetchControl({ dest: opts.dest, store: opts.store, record, log: line });
    line({ summary: { ok: true, dir, files: record.files.length, ...source } });
  } catch (error) {
    line({ summary: { ok: false, error: error.message, files: record.files.length, ...source } });
    process.exit(1);
  }
}
