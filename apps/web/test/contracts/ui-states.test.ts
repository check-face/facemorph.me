// Screen/state contract (fm-fy2.2): one type-level test per union, every surface with its reference and a
// transition table whose rows carry their contract type, the locked references' digests against the bundle on
// disk when present, and the candidate states read from the control (control-states.json).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AppGrantState } from '../../src/contracts/consent-state.ts';
import type { ExportIdentity } from '../../src/contracts/export-identity.ts';
import type { ConsentCostRow } from '../../src/contracts/preflight.ts';
import type { WholeActionProgress } from '../../src/contracts/progress.ts';
import type { RouteSnapshot } from '../../src/contracts/scheduler.ts';
import type { TileActionState } from '../../src/contracts/tiles.ts';
import {
  LOCKED_REFERENCES,
  MODAL_STACK,
  SURFACES,
  type ColdDownloadModalState,
  type CropConfirmState,
  type CropEditorState,
  type MainPageState,
  type ModalStackRule,
  type MorphResultState,
  type MultiFaceSelectionState,
  type NamesPickerState,
  type ResultActionsState,
  type Surface,
  type TileVisualState,
  type Transition,
} from '../../src/contracts/ui-states.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Has<U, T> = [Extract<U, T>] extends [never] ? false : true;
const is = <T extends true>(): T => true as T;
// Each union references the app types it renders.
is<Equal<TileVisualState['action'], TileActionState>>();
is<Equal<TileVisualState['progress'], WholeActionProgress | null>>();
is<Equal<MainPageState['route'], RouteSnapshot | null>>();
is<Has<MainPageState, { activity: 'one-failed-among-completed' }>>();
is<
  Equal<
    Extract<ColdDownloadModalState, { phase: 'confirm' }>['estimate'],
    readonly ConsentCostRow[] | 'no-reliable-estimate'
  >
>();
is<Equal<Extract<ColdDownloadModalState, { phase: 'confirm' }>['grant'], AppGrantState>>();
is<Equal<Extract<CropConfirmState, { phase: 'committed' }>['tile'], TileActionState>>();
is<Equal<CropEditorState['phase'], 'editing' | 'used' | 'cancelled'>>();
is<Has<MultiFaceSelectionState, { phase: 'choosing' }>>();
is<Equal<Extract<ResultActionsState, { result: 'ready' }>['identity'], ExportIdentity>>();
is<Equal<Extract<MorphResultState, { morph: 'cancelled' }>['partialExported'], false>>();
is<Equal<ModalStackRule['back'], 'cancel'>>();
// Candidate search is parity-interim only (removed from the target picker by fm-96if).
is<Equal<Extract<NamesPickerState, { phase: 'search' }>['parityInterim'], true>>();

// A transition row without its contract type, or a surface without its reference, does not type-check.
// @ts-expect-error a transition row needs its contract type
export const noContract: Transition<'a'> = { event: 'e', from: 'a', to: 'a', copyKey: 'k' };
const states = ['a'] as const;
// @ts-expect-error a surface needs its reference
export const noReference: Surface<'a'> = {
  states,
  transitions: [],
  focus: '',
  escape: '',
  back: '',
  history: '',
};
type Ref = Surface<'a'>['reference'];
const other = { kind: 'locked', file: 'other.png', sha256: '' } as const;
// @ts-expect-error a locked reference names a file in the locked bundle with its digest
export const unknownFile: Ref = other;
// @ts-expect-error a cancelled morph never exports a partial animation
export const partial: MorphResultState = { morph: 'cancelled', partialExported: true };

test('every listed surface has a reference, states and a transition table that stays inside its states', () => {
  const expected = [
    'main',
    'coldDownload',
    'cropConfirm',
    'cropFailedToAlign',
    'cropEditor',
    'multiFace',
    'tiles',
    'namesPicker',
    'resultActions',
    'morphResult',
    'fileOpen',
  ];
  assert.deepEqual(Object.keys(SURFACES).sort(), [...expected].sort());
  for (const [name, s] of Object.entries(SURFACES) as [string, Surface<string>][]) {
    assert.ok(s.reference, name);
    assert.ok(s.states.length > 0, name);
    for (const t of s.transitions) {
      assert.ok(
        s.states.includes(t.from) && s.states.includes(t.to),
        `${name}: ${t.event} ${t.from} -> ${t.to}`,
      );
      assert.ok(t.contract && t.copyKey, `${name}: ${t.event}`);
    }
    for (const k of ['focus', 'escape', 'back', 'history'] as const)
      assert.ok(s[k].length > 0, `${name}.${k}`);
  }
  // Supplied crop layouts are the locked references; multi-face and names picker are new designs.
  assert.deepEqual(SURFACES.cropConfirm.reference, {
    kind: 'locked',
    file: 'crop image.png',
    sha256: LOCKED_REFERENCES['crop image.png'],
  });
  assert.deepEqual(
    SURFACES.cropEditor.reference.kind === 'locked' && SURFACES.cropEditor.reference.file,
    'crop 2.png',
  );
  assert.equal(
    SURFACES.cropFailedToAlign.reference.kind === 'locked' &&
      SURFACES.cropFailedToAlign.reference.file,
    'failed to align.png',
  );
  assert.equal(SURFACES.multiFace.reference.kind, 'new-design');
  assert.equal(SURFACES.namesPicker.reference.kind, 'new-design');
  assert.ok(MODAL_STACK.every((r) => r.owns.includes('escape') && r.back === 'cancel'));
  assert.deepEqual(
    MODAL_STACK.filter((r) => r.above).map((r) => [r.modal, r.above]),
    [['crop-editor', 'crop-confirm']],
    'only the editor stacks; everything else replaces',
  );
});

test('locked reference digests match the bundle on disk', (t) => {
  const bundle = new URL(
    '../../../../../reference-locks/2026-10-11-original-plan-and-images/',
    import.meta.url,
  );
  if (!existsSync(new URL('SHA256SUMS', bundle)))
    return t.skip(
      'untested here: the locked reference bundle is a local-only sibling of the checkout',
    );
  for (const [file, sha] of Object.entries(LOCKED_REFERENCES))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`images/${file}`, bundle)))
        .digest('hex'),
      sha,
      file,
    );
});
