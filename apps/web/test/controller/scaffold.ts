import assert from 'node:assert/strict';
import { init } from '../../src/controller/init.ts';
import { CASES } from '../../src/controller/reducers/index.ts';
import type { Msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import type { Transition } from '../../src/controller/effects.ts';
export { checkControl, verifyControl, fixture, controlRows, replayStatus } from './control.ts';
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
