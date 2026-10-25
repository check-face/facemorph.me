// Reducer goldens are real observed control inputs. They never stand in for browser or bridge execution.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/controller/init.ts';
import { CASES } from '../../src/controller/reducers/index.ts';
import type { Msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import type { Transition } from '../../src/controller/effects.ts';
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
const set = (v: unknown): ReadonlySet<string> => {
  const value = v as { fsharp?: string; entries?: unknown[] };
  assert.equal(value.fsharp, 'set');
  assert.ok(value.entries?.every((x) => typeof x === 'string'));
  return new Set(value.entries as string[]);
};
function message(value: unknown): Msg | null {
  if (value === null) return null;
  const union = value as { name?: string; fields?: unknown[] };
  assert.ok(
    union.name && union.name in CASES && Array.isArray(union.fields),
    'unrecognized control message',
  );
  // The only queued intents recorded by this slice. Refuse other payloads rather than casting them.
  assert.ok(['RunFace', 'Run', 'BrowseNames'].includes(union.name));
  assert.equal(union.fields.length, 1);
  assert.equal(typeof union.fields[0], 'string');
  return {
    type: union.name as 'RunFace' | 'Run' | 'BrowseNames',
    args: [union.fields[0] as string],
  };
}
/** This trusted, versioned fixture contains only synthetic text/seed inputs; no blobs or latents are hydrated. */
export function fromGolden(model: Record<string, unknown>): State {
  assert.ok(
    Array.isArray(model.Inputs) &&
      model.Inputs.every((i) => i && typeof i === 'object' && 'file' in i && i.file === null),
  );
  const base = init({
    today: '<today>',
    url: 'https://next.facemorph.me/',
    consentAnswered: true,
    sliderPreference: false,
    sliderPosition: 1,
  }).state;
  for (const key of Object.keys(base)) assert.ok(key in model, `missing control field ${key}`);
  const jobs = (model.PendingJobs as unknown[]).map(message);
  assert.ok(jobs.every((job) => job !== null));
  // JSON fixtures are versioned recorder output, not bridge input. Restore the recorder's alias marker.
  return {
    ...model,
    RunInputs: model.RunInputs === '[cycle]' ? model.Inputs : model.RunInputs,
    CachedFaces: set(model.CachedFaces),
    PreparingFaces: set(model.PreparingFaces),
    DownloadConsent: set(model.DownloadConsent),
    PendingJobs: jobs,
    LastRun: message(model.LastRun),
    Gate:
      model.Gate === null
        ? null
        : [(model.Gate as unknown[])[0], message((model.Gate as unknown[])[1])],
  } as unknown as State;
}
export function compareFields(
  transition: Transition,
  expected: Record<string, unknown>,
  fields: readonly (keyof State)[],
): void {
  for (const field of fields) {
    const value = transition.state[field];
    const plain = value instanceof Set ? { fsharp: 'set', entries: [...value].sort() } : value;
    assert.deepEqual(plain, expected[field], `control field ${field} differs`);
  }
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
