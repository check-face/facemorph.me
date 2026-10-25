// Module survival scan (fm-fy2.19): every classic runtime module named in survival-map.json still exists at its
// mapped path, its listed tests exist and are named by a CI test command, and the runtime/worker capabilities the
// candidate relied on (WASM mapping, streamed single-threaded e4e, 1-4 CPU threads, codec stages) are still in the
// code. A module that disappears, or turns up elsewhere without a map update, is a finding unless the map tags it
// webgl-execution-only or native-only. Run as a script from the repository root: exit 1 on any finding.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, matchesGlob, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SurvivalModule {
  readonly module: string;
  readonly path: string;
  readonly tests: readonly string[];
  readonly tag?: 'webgl-execution-only' | 'native-only';
}
export interface SurvivalCapability {
  readonly id: string;
  readonly path: string;
  readonly pattern: string;
}
export interface SurvivalMap {
  readonly modules: readonly SurvivalModule[];
  readonly capabilities: readonly SurvivalCapability[];
}

// Where a moved module may have gone: the app source and the packages an extraction moves code into.
const SEARCH_ROOTS = ['apps/web/src', 'packages'];

function files(root: string, dir: string, out: string[] = []): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) files(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** The test commands CI runs: each workflow's text, and each workspace's `test` script with its globs. */
function testCommands(root: string): { text: string; globs: string[] } {
  const workflows = files(root, '.github/workflows').filter((f) => /\.ya?ml$/.test(f));
  const text = workflows.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  const globs: string[] = [];
  const packages = [
    '.',
    'apps/web',
    ...files(root, 'packages')
      .filter((f) => /^packages\/[^/]+\/package\.json$/.test(f))
      .map((f) => f.slice(0, -'/package.json'.length)),
  ];
  for (const dir of packages) {
    const manifest = join(root, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const scripts =
      (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> })
        .scripts ?? {};
    for (const [name, script] of Object.entries(scripts)) {
      if (name !== 'test' && !name.startsWith('test:')) continue;
      for (const token of script.split(/\s+/)) {
        const bare = token.replace(/^['"]|['"]$/g, '');
        if (/\.(test|spec|e2e)\.m?[jt]s$/.test(bare))
          globs.push(dir === '.' ? bare : `${dir}/${bare}`);
      }
    }
  }
  return { text, globs };
}

function listed(test: string, commands: { text: string; globs: string[] }): boolean {
  if (commands.globs.some((g) => g === test || matchesGlob(test, g))) return true;
  // A workflow names a test relative to its working directory: accept any path suffix on a segment boundary.
  const parts = test.split('/');
  return parts.some((_, i) => {
    const suffix = parts.slice(i).join('/');
    return (
      suffix.includes('/') &&
      new RegExp(
        `(^|[\\s'"(/])${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s'")])`,
        'm',
      ).test(commands.text)
    );
  });
}

export function scanSurvival(root: string, map: SurvivalMap): string[] {
  const findings: string[] = [];
  const commands = testCommands(root);
  const candidates = SEARCH_ROOTS.flatMap((r) => files(root, r));
  for (const m of map.modules) {
    if (!existsSync(join(root, m.path))) {
      if (m.tag) continue;
      const moved = candidates.filter((f) => basename(f) === basename(m.path) && f !== m.path);
      findings.push(
        moved.length
          ? `${m.module}: moved to ${moved.join(', ')} without a module map update (map says ${m.path})`
          : `${m.module}: missing at ${m.path} and not found elsewhere`,
      );
      continue;
    }
    if (!m.tests.length) findings.push(`${m.module}: no tests listed`);
    for (const t of m.tests) {
      if (!existsSync(join(root, t))) findings.push(`${m.module}: listed test ${t} does not exist`);
      else if (!listed(t, commands))
        findings.push(`${m.module}: listed test ${t} is not run by any CI test command`);
    }
  }
  for (const c of map.capabilities) {
    const file = join(root, c.path);
    if (!existsSync(file)) findings.push(`${c.id}: ${c.path} is missing`);
    else if (!new RegExp(c.pattern).test(readFileSync(file, 'utf8')))
      findings.push(`${c.id}: not found in ${c.path} (/${c.pattern}/)`);
  }
  return findings;
}

export const MAP_PATH = 'apps/web/build/survival-map.json';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const map = JSON.parse(readFileSync(join(root, MAP_PATH), 'utf8')) as SurvivalMap;
  const findings = scanSurvival(root, map);
  for (const f of findings) console.log(JSON.stringify({ finding: f }));
  console.log(
    JSON.stringify({
      summary: {
        modules: map.modules.length,
        capabilities: map.capabilities.length,
        findings: findings.length,
        root: relative(process.cwd(), root) || '.',
      },
    }),
  );
  process.exitCode = findings.length ? 1 : 0;
}
