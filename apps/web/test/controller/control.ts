// Reducer goldens are real observed control inputs. They never stand in for browser or bridge execution.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS } from '../parity/rows.ts';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const goldenRoot = join(root, 'apps/web/test/goldens');
interface Control {
  readonly commit: string;
  readonly release_sha256: string;
  readonly deploy_next_sha256: string;
}
interface Section {
  readonly control: Control;
  readonly rows: readonly {
    readonly id: string;
    readonly freeze: string;
    readonly files?: Readonly<Record<string, readonly string[]>>;
  }[];
}
const index = JSON.parse(readFileSync(join(goldenRoot, 'goldens.json'), 'utf8')) as {
  sections: Record<string, Section>;
};
export const controlRows = () => index.sections['parity-spec']!.rows;
export function checkControl(control: Control, expected: Control): void {
  assert.deepEqual(control, expected, 'control digest mismatch: reducer replay refused');
}
export function verifyControl(): void {
  const record = JSON.parse(readFileSync(join(root, 'import/control-artifact.json'), 'utf8')) as {
    source: { commit: string };
    release: { sha256: string };
    files: { path: string; sha256: string }[];
  };
  const expected = {
    commit: record.source.commit,
    release_sha256: record.release.sha256,
    deploy_next_sha256: record.files.find((f) => f.path === 'next-site-SHA256SUMS')!.sha256,
  };
  for (const key of ['flows', 'parity-spec']) {
    const control = index.sections[key]!.control;
    checkControl(
      {
        commit: control.commit,
        release_sha256: control.release_sha256,
        deploy_next_sha256: control.deploy_next_sha256,
      },
      expected,
    );
  }
  // Reuse the real verifier on an isolated, complete store assembled from the acquired artifact. No network needed.
  const store = mkdtempSync(join(tmpdir(), 'controller-control-'));
  try {
    if (record.files.every((file) => existsSync(join(root, file.path)))) {
      for (const file of record.files) {
        const dest = join(store, file.path);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(root, file.path), dest);
      }
      execFileSync(process.execPath, ['scripts/import/fetch-control.mjs', '--store', store], {
        cwd: root,
        stdio: 'pipe',
      });
    } else {
      execFileSync(process.execPath, ['scripts/import/fetch-control.mjs', '--dest', store], {
        cwd: root,
        stdio: 'pipe',
        timeout: 120_000,
      });
    }
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
}
export function fixture(path: string): {
  readonly model: Record<string, unknown>;
  readonly action: { readonly kind: string; readonly target?: string; readonly text?: string };
} {
  return JSON.parse(readFileSync(join(goldenRoot, 'control', path), 'utf8'));
}
export function replayStatus(rowId: string): {
  readonly status: 'parity' | 'owner-graded' | 'untested';
  readonly reason?: string;
} {
  const contract = ROWS.find((row) => row.rowId === rowId);
  if (contract && contract.tag !== 'parity')
    return { status: 'owner-graded', reason: `${contract.owner}: ${contract.plan}` };
  const row = index.sections['parity-spec']!.rows.find((r) => r.id === rowId);
  if (!row) return { status: 'untested', reason: 'no recorded control row; not a parity pass' };
  if (row.freeze !== 'parity') return { status: 'owner-graded', reason: row.freeze };
  return row.files && Object.keys(row.files).length
    ? { status: 'parity' }
    : { status: 'untested', reason: 'row has no recorded steps' };
}
