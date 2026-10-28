#!/usr/bin/env node
// Acquire the complete pinned runtime on clean CI workers without a classic checkout. The classic-source
// files come from the classic repository at the frozen commit (a test --origin serves them instead); the
// original inventory digests and sizes still decide whether any downloaded or cached byte is accepted.
// ACCEPT_MODEL_TERMS=yes node scripts/runtime/acquire-ci.mjs [--cache <dir>]
import { fileURLToPath } from 'node:url';
import { BUILD_INPUTS, line, options, readJson } from '../inventory/lib.mjs';
import { acquire, CLASSIC_RAW, DEFAULT_CACHE, ORIGIN, TERMS } from './acquire.mjs';

export async function acquireCI({ rows, cache = DEFAULT_CACHE, origin = ORIGIN, commit }) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Runtime inventory is empty');
  const paths = new Set();
  for (const row of rows) {
    if (
      typeof row.path !== 'string' ||
      !row.path ||
      row.path.startsWith('/') ||
      row.path.includes('\\') ||
      row.path.split('/').some((part) => part === '..' || part === '.' || !part) ||
      paths.has(row.path) ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      !(row.bytes === null || (Number.isSafeInteger(row.bytes) && row.bytes >= 0)) ||
      typeof row.location !== 'string'
    )
      throw new Error(`Invalid runtime inventory row: ${row.path}`);
    paths.add(row.path);
  }
  return acquire({
    rows: rows.map((row) =>
      row.location.startsWith('classic:')
        ? {
            ...row,
            location:
              origin === ORIGIN && commit
                ? `${CLASSIC_RAW}${commit}/${row.location.slice('classic:'.length)}`
                : `${ORIGIN}/runtime/${row.path}`,
          }
        : row,
    ),
    cache,
    origin,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  if (process.env.ACCEPT_MODEL_TERMS !== 'yes' && !opts['accept-model-terms']) {
    process.stderr.write(TERMS + '\n');
    line({ summary: { ok: false, refused: 'model terms not accepted' } });
    process.exit(2);
  }
  const cache = opts.cache ?? DEFAULT_CACHE;
  try {
    const inputs = readJson(opts.inputs ?? BUILD_INPUTS);
    const result = await acquireCI({
      rows: inputs.runtime.assets,
      cache,
      origin: opts.origin,
      commit: inputs.frozen_commit,
    });
    line({
      summary: {
        ...result,
        ok: !result.failed.length,
        cache,
        failed: result.failed.length,
        failures: result.failed.slice(0, 10),
      },
    });
    process.exit(result.failed.length ? 1 : 0);
  } catch (error) {
    line({ summary: { ok: false, cache, refused: error.message } });
    process.exit(1);
  }
}
