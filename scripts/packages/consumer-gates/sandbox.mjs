// The import side-effect sandbox (fm-7ge, gate 3). sandboxImport() imports one specifier, as a consumer in `cwd`
// resolves it, in a child Node process that (a) runs under the permission model with read access to `cwd` and the
// guard only, no writes, no child processes, no workers, no addons, and (b) preloads sandbox-guard.mjs, which
// records I/O attempts and diffs the globals around the import. The probe file is written into `cwd` so bare
// specifiers resolve from the consumer's node_modules. HOME and TMPDIR point at an empty directory.
// verdict() fails a result that did not load, made any recorded I/O/scheduling call, added, changed or removed a
// global, a built-in prototype/namespace member or an environment variable, or left a new active resource.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUARD = fileURLToPath(new URL('./sandbox-guard.mjs', import.meta.url));
const PROBE_NAME = '.facemorph-sandbox-probe.mjs';
const MARK = '@@facemorph-sandbox@@';
const PROBE = `// Written by scripts/packages/consumer-gates/sandbox.mjs; safe to delete.
const g = globalThis[Symbol.for('facemorph.consumer-gates.sandbox')];
const spec = process.argv[2];
const snapshot = g.arm();
let ns = null;
let error = null;
try {
  ns = await import(spec);
} catch (e) {
  error = String(e?.stack ?? e);
}
await g.settle();
const r = g.disarm(snapshot);
const exportNames = ns ? Object.keys(ns).sort() : [];
const report = ${JSON.stringify(MARK)} + JSON.stringify({ spec, loaded: error === null, error, exportNames, ...r }) + '\\n';
// Exit even when the module left a timer or handle open (that is reported, not waited for).
process.stdout.write(report, () => process.exit(0));
`;

export function sandboxImport({ cwd, specifier, timeoutMs = 60000 }) {
  const probe = join(cwd, PROBE_NAME);
  writeFileSync(probe, PROBE);
  const home = mkdtempSync(join(tmpdir(), 'facemorph-sandbox-home-'));
  try {
    const r = spawnSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${cwd}`,
        `--allow-fs-read=${dirname(GUARD)}`,
        '--import',
        pathToFileURL(GUARD).href,
        probe,
        specifier,
      ],
      {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: { PATH: process.env.PATH ?? '', HOME: home, TMPDIR: home, NODE_OPTIONS: '' },
      },
    );
    const line = r.stdout.split('\n').find((l) => l.startsWith(MARK));
    if (!line)
      return {
        spec: specifier,
        loaded: false,
        error: `sandbox produced no report (status ${r.status}, signal ${r.signal}): ${r.stderr.trim().slice(-2000)}`,
        exportNames: [],
        touches: [],
        global: { added: [], changed: [], removed: [] },
        builtins: [],
        env: [],
        resources: [],
      };
    const result = JSON.parse(line.slice(MARK.length));
    result.stray = r.stdout
      .split('\n')
      .filter((l) => l && !l.startsWith(MARK))
      .slice(0, 20);
    return result;
  } finally {
    rmSync(probe, { force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/** Problems of one sandbox result; empty means the import was side-effect free. */
export function verdict(r) {
  const p = [];
  if (!r.loaded) p.push(`did not load: ${r.error}`);
  for (const t of new Set(r.touches.map((t) => `${t.what}${t.at ? ` (${t.at})` : ''}`)))
    p.push(`I/O or scheduling at import: ${t}`);
  if (r.global.added.length) p.push(`globals added: ${r.global.added.join(', ')}`);
  if (r.global.changed.length) p.push(`globals changed: ${r.global.changed.join(', ')}`);
  if (r.global.removed.length) p.push(`globals removed: ${r.global.removed.join(', ')}`);
  for (const b of r.builtins)
    p.push(`${b.object} modified: ${[...b.added, ...b.changed, ...b.removed].join(', ')}`);
  if (r.env.length) p.push(`environment changed: ${r.env.join(', ')}`);
  if (r.resources.length) p.push(`active resources left: ${r.resources.join(', ')}`);
  if (r.stray?.length) p.push(`wrote to stdout: ${r.stray[0]}`);
  return p;
}
