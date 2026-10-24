#!/usr/bin/env node
// Checks the two worker graphs against their pins in import/build-inputs.json (fm-gpx):
// - pinned: the files the runtime manifest pins and the app loads by URL (workers, modules, WASM, codec and
//   photo siblings), staged in a runtime directory (scripts/runtime/acquire.mjs's cache), against
//   runtime.assets;
// - emitted: the worker chunks the bundler emits from the app source, in a built site directory (deploy-next/,
//   such as the unpacked control), against worker_graphs.emitted.
// A changed byte in either fails until its pin is updated.
//   node scripts/runtime/check-pins.mjs [--runtime <dir>] [--emitted <deploy-next dir>] [--inputs <json>]
// One JSON line per checked file {path, expected, actual, graph}, then a summary; exit 1 on any mismatch.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_INPUTS, line, options, readJson, sha256 } from '../inventory/lib.mjs';

const digest = (path) => (existsSync(path) ? sha256(readFileSync(path)) : null);

export function pinRows(inputs, { runtime, emitted }) {
  const rows = [];
  if (runtime) for (const a of inputs.runtime.assets) rows.push({ path: a.path, expected: a.sha256, actual: digest(join(runtime, a.path)), graph: 'pinned' });
  // A row may name several chunks ("825.….js (loaded by app) and 744.….js (…)") with their digests in order.
  if (emitted) for (const w of inputs.worker_graphs.emitted) {
    const chunks = w.control_chunk.match(/[\w-]+\.[0-9a-f]+\.js/g) ?? [];
    const digests = w.control_sha256.match(/[0-9a-f]{64}/g) ?? [];
    if (!chunks.length || chunks.length !== digests.length) throw new Error(`${w.source}: cannot pair chunks with digests in worker_graphs.emitted`);
    chunks.forEach((chunk, i) => rows.push({ path: chunk, source: w.source, expected: digests[i], actual: digest(join(emitted, chunk)), graph: 'emitted' }));
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  if (!opts.runtime && !opts.emitted) throw new Error('pass --runtime <dir> and/or --emitted <deploy-next dir>');
  const rows = pinRows(readJson(opts.inputs ?? BUILD_INPUTS), opts);
  for (const r of rows) line(r);
  const bad = rows.filter((r) => r.actual !== r.expected);
  line({ summary: { pinned: rows.filter((r) => r.graph === 'pinned').length, emitted: rows.filter((r) => r.graph === 'emitted').length, mismatches: bad.length } });
  process.exit(bad.length ? 1 : 0);
}
