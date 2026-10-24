// The declared browser matrix (apps/web/browser-matrix.json): the cells the release is built for. Loading
// fails on any cell that lacks what the build and the release summary need, so a half-declared row can never
// quietly widen or narrow the targets.
import { readFileSync } from 'node:fs';

export type Engine = 'chromium' | 'firefox' | 'webkit';
export type Evidence = 'static' | 'simulator' | 'emulator' | 'physical' | 'desktop';
export type DeviceClass = 'desktop' | 'phone' | 'tablet';
export type Provider = 'cpu' | 'webgpu' | 'components';

export interface Cell {
  readonly id: string;
  readonly browser: string;
  readonly engine: Engine;
  /** Browser on iOS is always WebKit; 'ios' selects the iOS build target rather than desktop Safari. */
  readonly platform?: 'ios';
  /** The oldest version of this browser the cell runs or must keep working on. */
  readonly version: string;
  readonly os: string;
  readonly deviceClass: DeviceClass;
  readonly provider: Provider;
  readonly evidence: Evidence;
  /** The CI lane or lab cell that exercises it, or null when none exists yet (reported untested). */
  readonly lane: string | null;
  readonly laneNote?: string;
}

export interface Matrix {
  readonly cells: readonly Cell[];
}

export const MATRIX_PATH = new URL('../browser-matrix.json', import.meta.url);

const ENGINES: readonly string[] = ['chromium', 'firefox', 'webkit'];
const EVIDENCE: readonly string[] = ['static', 'simulator', 'emulator', 'physical', 'desktop'];
const DEVICE_CLASSES: readonly string[] = ['desktop', 'phone', 'tablet'];
const PROVIDERS: readonly string[] = ['cpu', 'webgpu', 'components'];
const VERSION = /^\d+(\.\d+){0,3}$/;

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Validates a parsed matrix; throws naming every bad cell and field. */
export function parseMatrix(input: unknown): Matrix {
  const cells = (input as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(cells) || cells.length === 0)
    throw new Error('browser matrix: `cells` must be a non-empty array');
  const problems: string[] = [];
  const ids = new Set<string>();
  cells.forEach((raw: unknown, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const where = text(c['id']) ? String(c['id']) : `cell ${i}`;
    for (const field of [
      'id',
      'browser',
      'version',
      'os',
      'evidence',
      'engine',
      'deviceClass',
      'provider',
    ]) {
      if (!text(c[field])) problems.push(`${where}: missing ${field}`);
    }
    if (text(c['version']) && !VERSION.test(String(c['version'])))
      problems.push(`${where}: version ${String(c['version'])} is not numeric`);
    if (text(c['engine']) && !ENGINES.includes(String(c['engine'])))
      problems.push(`${where}: unknown engine ${String(c['engine'])}`);
    if (text(c['evidence']) && !EVIDENCE.includes(String(c['evidence'])))
      problems.push(`${where}: unknown evidence class ${String(c['evidence'])}`);
    if (text(c['deviceClass']) && !DEVICE_CLASSES.includes(String(c['deviceClass'])))
      problems.push(`${where}: unknown device class ${String(c['deviceClass'])}`);
    if (text(c['provider']) && !PROVIDERS.includes(String(c['provider'])))
      problems.push(`${where}: unknown provider ${String(c['provider'])}`);
    if (c['platform'] !== undefined && (c['platform'] !== 'ios' || c['engine'] !== 'webkit'))
      problems.push(`${where}: platform 'ios' is the only platform and needs engine webkit`);
    if (!('lane' in c) || (c['lane'] !== null && !text(c['lane'])))
      problems.push(`${where}: lane must name a CI lane or lab cell, or be null`);
    if (c['lane'] === null && !text(c['laneNote']))
      problems.push(`${where}: a cell with no lane needs laneNote saying why`);
    for (const outcome of ['outcome', 'status', 'result', 'runUrl'])
      if (outcome in c)
        problems.push(
          `${where}: outcomes belong in the release summary, not the matrix (${outcome})`,
        );
    if (text(c['id'])) {
      if (ids.has(String(c['id']))) problems.push(`${where}: duplicate id`);
      ids.add(String(c['id']));
    }
  });
  if (problems.length) throw new Error(`browser matrix:\n  ${problems.join('\n  ')}`);
  return { cells: cells as Cell[] };
}

export function loadMatrix(path: URL | string = MATRIX_PATH): Matrix {
  return parseMatrix(JSON.parse(readFileSync(path, 'utf8')));
}
