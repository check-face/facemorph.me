// Build targets from the declared matrix: for each engine the oldest version any cell declares, as esbuild
// target names. The app and every bundler-emitted worker get the same list, so a worker never ships syntax
// a matrix browser cannot parse. Vite's own defaults are not a support policy and are never used.
import type { Cell, Matrix } from './browser-matrix.ts';

export interface Targets {
  /** esbuild target names for `build.target` (and the dev transform). */
  readonly build: readonly string[];
  /** The same list for emitted workers, which Vite builds separately. */
  readonly worker: readonly string[];
  readonly workerFormat: 'es';
}

const compare = (a: string, b: string): number => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

// esbuild names: chrome<major>, firefox<major>, safari<major.minor>, ios<major.minor>.
function family(cell: Cell): { name: string; version: string } {
  if (!cell.version) throw new Error(`${cell.id}: no version, so no build target can be derived`);
  const [major = '', minor] = cell.version.split('.');
  if (cell.engine === 'chromium') return { name: 'chrome', version: major };
  if (cell.engine === 'firefox') return { name: 'firefox', version: major };
  return { name: cell.platform === 'ios' ? 'ios' : 'safari', version: minor === undefined ? major : `${major}.${minor}` };
}

export function deriveTargets(matrix: Matrix): Targets {
  const oldest = new Map<string, string>();
  for (const cell of matrix.cells) {
    const { name, version } = family(cell);
    const seen = oldest.get(name);
    if (seen === undefined || compare(version, seen) < 0) oldest.set(name, version);
  }
  const build = [...oldest].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, version]) => `${name}${version}`);
  return { build, worker: build, workerFormat: 'es' };
}
