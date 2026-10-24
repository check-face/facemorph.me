// Screen/state contract (fm-fy2.2, contracts milestone 2): the ten state unions every surface renders, and per
// surface its borrowed reference, state list, transition table (event -> next state -> contract type -> copy
// key), and focus, Escape/Back and history behaviour. Face controls, the controller port, the names picker and
// integrated verification read this module. Visual layout is checked on the built UI by the face-controls beads'
// operated checks, not here. Existing candidate states were read by operating the pinned control
// (apps/web/test/contracts/control-states.json); its known defects are typed as defects, never as behaviour.
import type { BatchSelection, CandidateId } from './batch.ts';
import type { CeilingName } from './ceilings.ts';
import type { AppGrantState } from './consent-state.ts';
import type { ExportIdentity, ExportKind } from './export-identity.ts';
import type { ConsentCostRow } from './preflight.ts';
import type { WholeActionProgress } from './progress.ts';
import type { RecoveryClassification } from './recovery-classification.ts';
import type { RouteSnapshot } from './scheduler.ts';
import type { TileActionState } from './tiles.ts';

// ---- References.
/** The locked bundle `../reference-locks/2026-10-11-original-plan-and-images/` (archive SHA-256 f38de24a…921740a). */
export const LOCKED_REFERENCES = Object.freeze({
  'crop image.png': 'dc2b07087ca3b488b354f08a74eae95b9e9876cd3bf70013a1372a61dd98a280',
  'crop 2.png': '753f4ad693874253085b60791d83e630765acb50e7f6d74c7363432f3c16b6c1',
  'failed to align.png': '074096a95337fe9b78cd1b5e4cc6069fc6fab05bbbe3fc1cb407d6d4bf30255b',
  'recovered image.png': 'd67fdf00616cac2a84b93e1099ab59aa75583e18802968dd49db29c448030b62',
} as const);
export type LockedFile = keyof typeof LOCKED_REFERENCES;

export type Reference =
  | { readonly kind: 'locked'; readonly file: LockedFile; readonly sha256: (typeof LOCKED_REFERENCES)[LockedFile] }
  | { readonly kind: 'legacy-surface'; readonly surface: string }
  | { readonly kind: 'new-design'; readonly requirement: `PLAN.md#${string}` };

const locked = <F extends LockedFile>(file: F): Reference => ({ kind: 'locked', file, sha256: LOCKED_REFERENCES[file] });

/** The contract types a transition can carry: the app types (fm-s9n) and the recovery classification. */
export type ContractType =
  | 'TileActionState'
  | 'WholeActionProgress'
  | 'AppGrantState'
  | 'ConsentCostRow'
  | 'RouteSnapshot'
  | 'ExportIdentity'
  | 'BatchSelection'
  | 'RecoveryClassification'
  | 'none';

/** Where a state names a ceiling, it names it; the values live in ceilings.ts (contracts.m2.ceilings, fm-2o8q). There is no
 * face-count ceiling (operator, 24 October): frames, retained inputs and the stored session are what bind. */
export type MultiFaceCeiling = Extract<CeilingName, 'BATCH_RETAINED_INPUT_BYTES' | 'MORPH_FRAME_BUDGET' | 'STORED_SESSION_BYTES'>;

// ---- The ten unions.
export type FaceCount = 'empty' | 'one' | 'two-or-more' | 'many';

export interface TileVisualState {
  readonly faceId: string;
  readonly action: TileActionState;
  /** Whole-action progress while the tile works; null otherwise. */
  readonly progress: WholeActionProgress | null;
}

export type MainPageState = {
  readonly screen: 'main';
  /** No fixed count; virtualised past about 100 faces. */
  readonly faces: FaceCount;
  readonly tiles: readonly TileVisualState[];
  /** The CPU/WebGPU compact selector above the first +; a snapshot taken at Start or Download-and-continue. */
  readonly route: RouteSnapshot | null;
} & (
  | { readonly activity: 'idle' }
  | { readonly activity: 'generating'; readonly progress: WholeActionProgress }
  | { readonly activity: 'completed' }
  | { readonly activity: 'one-failed-among-completed'; readonly failedFaceId: string }
);

export type DownloadPurpose = 'generate' | 'generate-and-encode' | 'prepare-encoder';

export type ColdDownloadModalState =
  | {
      readonly modal: 'cold-download';
      readonly phase: 'confirm';
      readonly purpose: DownloadPurpose;
      /** From the actual manifest after cache validation. */
      readonly bytes: number;
      readonly estimate: readonly ConsentCostRow[] | 'no-reliable-estimate';
      readonly grant: AppGrantState;
    }
  | { readonly modal: 'cold-download'; readonly phase: 'revised-scope'; readonly purpose: DownloadPurpose; readonly bytes: number; readonly grant: AppGrantState }
  | { readonly modal: 'cold-download'; readonly phase: 'in-progress'; readonly progress: WholeActionProgress; readonly grant: AppGrantState }
  /** Verified chunks are kept; the pending action never launches later. */
  | { readonly modal: 'cold-download'; readonly phase: 'cancelled'; readonly verifiedChunksKept: true; readonly pendingActionLaunches: false }
  | { readonly modal: 'cold-download'; readonly phase: 'error'; readonly reasonKey: string; readonly retry: true };

export interface CropProposal {
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Who proposed it: the detector, the person, or nobody (detector failed or refused: the whole image). */
  readonly source: 'detector' | 'manual' | 'detector-failed';
}

export type CropConfirmState =
  /** "Encode an image": crop preview, Adjust Crop, Cancel (bottom left), OK (bottom right); OK commits once. */
  | { readonly modal: 'crop-confirm'; readonly phase: 'proposed'; readonly proposal: CropProposal }
  /** "Unable to auto align face." guidance; Adjust Crop still allows a manual crop. */
  | { readonly modal: 'crop-confirm'; readonly phase: 'detector-failed'; readonly proposal: CropProposal & { readonly source: 'detector-failed' } }
  /** OK pressed: the dialog is replaced (not stacked) by the tile's progress. */
  | { readonly modal: 'crop-confirm'; readonly phase: 'committed'; readonly faceId: string; readonly tile: TileActionState };

export type CropEditorState =
  /** "Crop your image": square bounds with corner/edge handles, eye/face guides, rotation and angle, Cancel, Use Crop. */
  | { readonly modal: 'crop-editor'; readonly phase: 'editing'; readonly draft: CropProposal; readonly previous: CropProposal }
  | { readonly modal: 'crop-editor'; readonly phase: 'used'; readonly next: CropProposal }
  | { readonly modal: 'crop-editor'; readonly phase: 'cancelled'; readonly restored: CropProposal };

export type MultiFaceSelectionState =
  | { readonly modal: 'multi-face'; readonly phase: 'detecting' }
  | {
      readonly modal: 'multi-face';
      readonly phase: 'choosing';
      readonly detected: number;
      /** Visible global click order across files: deselect removes, reselect appends. */
      readonly selection: BatchSelection;
      readonly overCeiling:
        | null
        | { readonly ceiling: MultiFaceCeiling; readonly action: 'reduce-selection' }
        | { readonly ceiling: 'BATCH_RETAINED_INPUT_BYTES'; readonly action: 'remove-retry-input' };
    }
  /** Committed atomically, in click order. */
  | { readonly modal: 'multi-face'; readonly phase: 'committed'; readonly inserted: readonly CandidateId[] };

/** A parity-interim state: candidate search, removed from the target picker by fm-96if. */
export interface ParityInterim {
  readonly parityInterim: true;
}

export type NamesPickerState =
  | { readonly picker: 'closed' }
  /** Opened from a face's burger menu, bound to that face's stable ID. */
  | { readonly picker: 'open'; readonly faceId: string; readonly phase: 'cold-loading' | 'loaded' }
  | { readonly picker: 'open'; readonly faceId: string; readonly phase: 'error'; readonly retry: true }
  | ({ readonly picker: 'open'; readonly faceId: string; readonly phase: 'search'; readonly query: 'empty' | 'long' | 'pasted' | 'typed' } & ParityInterim)
  | { readonly picker: 'picked'; readonly faceId: string; readonly name: string }
  /** The target face was removed or revised while open: the pending pick is invalid. */
  | { readonly picker: 'invalidated'; readonly faceId: string };

export type ResultActionsState =
  | { readonly result: 'none' }
  | { readonly result: 'preparing-file'; readonly format: ExportKind; readonly label: 'Preparing file…' }
  | {
      readonly result: 'ready';
      readonly identity: ExportIdentity;
      readonly format: ExportKind;
      /** Share is offered only where the system share accepts files; otherwise Save only. */
      readonly share: 'available' | 'unavailable';
      /** A PNG fallback updated name and MIME. */
      readonly fallback: 'none' | 'png';
    }
  /** System-share cancel is not an error and starts no download. */
  | { readonly result: 'share-cancelled'; readonly identity: ExportIdentity };

export type MorphResultState =
  | { readonly morph: 'none' }
  | { readonly morph: 'producing'; readonly progress: WholeActionProgress }
  /** Exactly one current result: play and scrub. */
  | { readonly morph: 'current'; readonly identity: ExportIdentity; readonly actions: ResultActionsState }
  /** An ordered-face or setting change invalidated it and its Share/Save readiness. */
  | { readonly morph: 'invalidated' }
  /** Cancel never exports a partial animation. */
  | { readonly morph: 'cancelled'; readonly partialExported: false };

export type ModalKind = 'cold-download' | 'crop-confirm' | 'crop-editor' | 'multi-face' | 'names-picker';

/** The topmost modal owns Escape, Back and focus; Back is that modal's Cancel; focus returns to the invoker. */
export interface ModalStackRule {
  readonly modal: ModalKind;
  readonly owns: readonly ('escape' | 'back' | 'focus')[];
  readonly back: 'cancel';
  readonly focusReturnsTo: 'invoking-control';
  /** Only crop-editor sits above another modal (crop-confirm); everything else replaces, never stacks. */
  readonly above: ModalKind | null;
}

/** File-open dispatch: each classification is its own outcome; an external MP4 never replaces current work. */
export type FileOpenOutcome =
  | { readonly open: 'still'; readonly classification: RecoveryClassification }
  | { readonly open: 'photo-encoding-offered'; readonly classification: 'missing' }
  | { readonly open: 'unsupported-mp4'; readonly currentWorkKept: true };

// ---- Surfaces: reference, states, transitions, focus, Escape/Back, history.
export interface Transition<S extends string> {
  readonly event: string;
  readonly from: S;
  readonly to: S;
  readonly contract: ContractType;
  readonly copyKey: string;
}

export interface Surface<S extends string> {
  readonly reference: Reference;
  readonly states: readonly S[];
  readonly transitions: readonly Transition<S>[];
  readonly focus: string;
  readonly escape: string;
  readonly back: string;
  readonly history: string;
}

const surface = <S extends string>(s: Surface<S>): Surface<S> => Object.freeze(s);

export const SURFACES = Object.freeze({
  main: surface<'empty' | 'one' | 'two-or-more' | 'many' | 'generating' | 'completed' | 'one-failed-among-completed'>({
    reference: { kind: 'legacy-surface', surface: 'candidate main page (Product.fs view), control 551b6072' },
    states: ['empty', 'one', 'two-or-more', 'many', 'generating', 'completed', 'one-failed-among-completed'],
    transitions: [
      { event: 'add-face', from: 'empty', to: 'one', contract: 'TileActionState', copyKey: 'main.add-face' },
      { event: 'add-face', from: 'one', to: 'two-or-more', contract: 'TileActionState', copyKey: 'main.add-face' },
      { event: 'generate', from: 'two-or-more', to: 'generating', contract: 'WholeActionProgress', copyKey: 'main.generating' },
      { event: 'all-complete', from: 'generating', to: 'completed', contract: 'TileActionState', copyKey: 'main.completed' },
      { event: 'one-failed', from: 'generating', to: 'one-failed-among-completed', contract: 'TileActionState', copyKey: 'tile.failed-retry' },
      { event: 'route-changed', from: 'completed', to: 'completed', contract: 'RouteSnapshot', copyKey: 'main.route-applies-to-new-jobs' },
    ],
    focus: 'the first empty tile on load; the new tile after add-face',
    escape: 'none (no modal)',
    back: 'browser back leaves the page',
    history: 'no history entries',
  }),
  coldDownload: surface<'confirm' | 'revised-scope' | 'in-progress' | 'cancelled' | 'error'>({
    reference: { kind: 'legacy-surface', surface: 'candidate model download dialog (.next-download-dialog), control 551b6072' },
    states: ['confirm', 'revised-scope', 'in-progress', 'cancelled', 'error'],
    transitions: [
      { event: 'continue', from: 'confirm', to: 'in-progress', contract: 'AppGrantState', copyKey: 'download.continue' },
      { event: 'scope-grew', from: 'in-progress', to: 'revised-scope', contract: 'ConsentCostRow', copyKey: 'download.revised-scope' },
      { event: 'continue', from: 'revised-scope', to: 'in-progress', contract: 'AppGrantState', copyKey: 'download.continue' },
      { event: 'cancel', from: 'in-progress', to: 'cancelled', contract: 'WholeActionProgress', copyKey: 'download.cancelled-chunks-kept' },
      { event: 'failure', from: 'in-progress', to: 'error', contract: 'WholeActionProgress', copyKey: 'download.error-retry' },
      { event: 'retry', from: 'error', to: 'in-progress', contract: 'AppGrantState', copyKey: 'download.continue' },
    ],
    focus: 'Continue on open; the invoking Generate or Encode control on close',
    escape: 'Cancel',
    back: 'Cancel',
    history: 'no history entry',
  }),
  cropConfirm: surface<'proposed' | 'detector-failed' | 'committed' | 'abandoned'>({
    reference: locked('crop image.png'),
    states: ['proposed', 'detector-failed', 'committed', 'abandoned'],
    transitions: [
      { event: 'ok', from: 'proposed', to: 'committed', contract: 'TileActionState', copyKey: 'crop.ok' },
      { event: 'ok', from: 'detector-failed', to: 'committed', contract: 'TileActionState', copyKey: 'crop.ok' },
      { event: 'cancel', from: 'proposed', to: 'abandoned', contract: 'none', copyKey: 'crop.cancel' },
      { event: 'cancel', from: 'detector-failed', to: 'abandoned', contract: 'none', copyKey: 'crop.cancel' },
    ],
    focus: 'OK on open; the tile on commit; the invoking control on Cancel',
    escape: 'Cancel (abandons)',
    back: 'Cancel (abandons)',
    history: 'one entry while open, popped by Back',
  }),
  cropFailedToAlign: surface<'detector-failed'>({
    reference: locked('failed to align.png'),
    states: ['detector-failed'],
    transitions: [],
    focus: 'Adjust Crop',
    escape: 'Cancel (abandons)',
    back: 'Cancel (abandons)',
    history: 'as crop confirmation',
  }),
  cropEditor: surface<'editing' | 'used' | 'cancelled'>({
    reference: locked('crop 2.png'),
    states: ['editing', 'used', 'cancelled'],
    transitions: [
      { event: 'use-crop', from: 'editing', to: 'used', contract: 'none', copyKey: 'crop.use-crop' },
      { event: 'cancel', from: 'editing', to: 'cancelled', contract: 'none', copyKey: 'crop.editor-cancel' },
    ],
    focus: 'the crop box; Adjust Crop on return to the confirmation',
    escape: 'editor Cancel (returns to the previous proposal)',
    back: 'editor Cancel',
    history: 'one entry above the confirmation, popped by Back',
  }),
  multiFace: surface<'detecting' | 'choosing' | 'over-ceiling' | 'committed' | 'cancelled'>({
    reference: { kind: 'new-design', requirement: 'PLAN.md#ui-flow-matrix-and-open-journey-contracts' },
    states: ['detecting', 'choosing', 'over-ceiling', 'committed', 'cancelled'],
    transitions: [
      { event: 'faces-detected', from: 'detecting', to: 'choosing', contract: 'BatchSelection', copyKey: 'multi.choose' },
      { event: 'click', from: 'choosing', to: 'choosing', contract: 'BatchSelection', copyKey: 'multi.click-order' },
      { event: 'click-over-ceiling', from: 'choosing', to: 'over-ceiling', contract: 'BatchSelection', copyKey: 'multi.over-ceiling' },
      { event: 'deselect', from: 'over-ceiling', to: 'choosing', contract: 'BatchSelection', copyKey: 'multi.click-order' },
      { event: 'commit', from: 'choosing', to: 'committed', contract: 'TileActionState', copyKey: 'multi.commit' },
      { event: 'cancel', from: 'choosing', to: 'cancelled', contract: 'none', copyKey: 'multi.cancel' },
    ],
    focus: 'the first detected face',
    escape: 'Cancel (nothing inserted)',
    back: 'Cancel',
    history: 'one entry while open',
  }),
  tiles: surface<TileActionState['state']>({
    reference: { kind: 'legacy-surface', surface: 'candidate face tile, control 551b6072' },
    states: ['empty-or-invalid', 'ready', 'queued', 'active', 'cancelling', 'failed-retryable', 'retry-pixels-lost', 'file-pending', 'file-failed', 'verified-result', 'static-selection-pending'],
    transitions: [
      { event: 'generate', from: 'ready', to: 'queued', contract: 'TileActionState', copyKey: 'tile.queued' },
      { event: 'start', from: 'queued', to: 'active', contract: 'WholeActionProgress', copyKey: 'tile.progress' },
      { event: 'cancel', from: 'active', to: 'cancelling', contract: 'TileActionState', copyKey: 'tile.cancelling' },
      { event: 'stopped', from: 'cancelling', to: 'failed-retryable', contract: 'TileActionState', copyKey: 'tile.cancelled-retry' },
      { event: 'failed', from: 'active', to: 'failed-retryable', contract: 'TileActionState', copyKey: 'tile.failed-retry' },
      { event: 'retry', from: 'failed-retryable', to: 'queued', contract: 'TileActionState', copyKey: 'tile.queued' },
      { event: 'pixels-evicted', from: 'failed-retryable', to: 'retry-pixels-lost', contract: 'TileActionState', copyKey: 'tile.encode-image' },
      { event: 'pixels-ready', from: 'active', to: 'file-pending', contract: 'TileActionState', copyKey: 'tile.preparing-file' },
      { event: 'file-ready', from: 'file-pending', to: 'verified-result', contract: 'ExportIdentity', copyKey: 'tile.result' },
      { event: 'file-failed', from: 'file-pending', to: 'file-failed', contract: 'TileActionState', copyKey: 'tile.file-retry' },
    ],
    focus: "the tile's primary command",
    escape: 'none',
    back: 'none',
    history: 'none',
  }),
  namesPicker: surface<'closed' | 'cold-loading' | 'loaded' | 'error' | 'search' | 'picked' | 'invalidated'>({
    reference: { kind: 'new-design', requirement: 'PLAN.md#ui-flow-matrix-and-open-journey-contracts' },
    states: ['closed', 'cold-loading', 'loaded', 'error', 'search', 'picked', 'invalidated'],
    transitions: [
      { event: 'open-from-burger', from: 'closed', to: 'cold-loading', contract: 'none', copyKey: 'names.loading' },
      { event: 'loaded', from: 'cold-loading', to: 'loaded', contract: 'none', copyKey: 'names.loaded' },
      { event: 'failed', from: 'cold-loading', to: 'error', contract: 'none', copyKey: 'names.error-retry' },
      { event: 'type', from: 'loaded', to: 'search', contract: 'none', copyKey: 'names.search-interim' },
      { event: 'pick', from: 'loaded', to: 'picked', contract: 'TileActionState', copyKey: 'names.picked' },
      { event: 'target-revised', from: 'loaded', to: 'invalidated', contract: 'none', copyKey: 'names.target-changed' },
      { event: 'dismiss', from: 'loaded', to: 'closed', contract: 'none', copyKey: 'names.dismiss' },
    ],
    focus: 'the first name; the burger menu of that face on close',
    escape: 'dismiss (the tile is left intact)',
    back: 'dismiss (touch Back exits)',
    history: 'one entry while open',
  }),
  resultActions: surface<'none' | 'preparing-file' | 'ready' | 'share-cancelled'>({
    reference: { kind: 'legacy-surface', surface: 'candidate result Save/Share, control 551b6072 (post-result Crop and Hold to compare removed)' },
    states: ['none', 'preparing-file', 'ready', 'share-cancelled'],
    transitions: [
      { event: 'result', from: 'none', to: 'preparing-file', contract: 'ExportIdentity', copyKey: 'result.preparing-file' },
      { event: 'file-ready', from: 'preparing-file', to: 'ready', contract: 'ExportIdentity', copyKey: 'result.save-share' },
      { event: 'format-change', from: 'ready', to: 'preparing-file', contract: 'ExportIdentity', copyKey: 'result.preparing-file' },
      { event: 'share-cancel', from: 'ready', to: 'share-cancelled', contract: 'none', copyKey: 'result.share-cancelled-silent' },
    ],
    focus: 'Save after the file is ready',
    escape: 'none',
    back: 'none',
    history: 'none',
  }),
  morphResult: surface<'none' | 'producing' | 'current' | 'invalidated' | 'cancelled'>({
    reference: { kind: 'legacy-surface', surface: 'candidate morph result (play/slider), control 551b6072' },
    states: ['none', 'producing', 'current', 'invalidated', 'cancelled'],
    transitions: [
      { event: 'create-morph', from: 'none', to: 'producing', contract: 'WholeActionProgress', copyKey: 'morph.producing' },
      { event: 'complete', from: 'producing', to: 'current', contract: 'ExportIdentity', copyKey: 'morph.play' },
      { event: 'cancel', from: 'producing', to: 'cancelled', contract: 'none', copyKey: 'morph.cancelled-no-partial' },
      { event: 'face-or-setting-changed', from: 'current', to: 'invalidated', contract: 'none', copyKey: 'morph.invalidated' },
      { event: 'create-morph', from: 'invalidated', to: 'producing', contract: 'WholeActionProgress', copyKey: 'morph.producing' },
    ],
    focus: 'Play on completion',
    escape: 'none',
    back: 'none',
    history: 'none',
  }),
  fileOpen: surface<'still' | 'missing' | 'damaged' | 'incompatible' | 'photo-encoding-offered' | 'unsupported-mp4'>({
    reference: { kind: 'new-design', requirement: 'PLAN.md#ui-flow-matrix-and-open-journey-contracts' },
    states: ['still', 'missing', 'damaged', 'incompatible', 'photo-encoding-offered', 'unsupported-mp4'],
    transitions: [
      { event: 'open-valid', from: 'missing', to: 'still', contract: 'RecoveryClassification', copyKey: 'open.reopened' },
      { event: 'encode-explicitly', from: 'missing', to: 'photo-encoding-offered', contract: 'RecoveryClassification', copyKey: 'open.encode-photo' },
      { event: 'open-damaged', from: 'missing', to: 'damaged', contract: 'RecoveryClassification', copyKey: 'open.damaged' },
      { event: 'open-incompatible', from: 'missing', to: 'incompatible', contract: 'RecoveryClassification', copyKey: 'open.incompatible' },
      { event: 'open-mp4', from: 'missing', to: 'unsupported-mp4', contract: 'none', copyKey: 'open.mp4-unsupported' },
    ],
    focus: 'the reopened tile, or the offered action',
    escape: 'none',
    back: 'none',
    history: 'none',
  }),
});

export const MODAL_STACK: readonly ModalStackRule[] = Object.freeze([
  { modal: 'cold-download', owns: ['escape', 'back', 'focus'], back: 'cancel', focusReturnsTo: 'invoking-control', above: null },
  { modal: 'crop-confirm', owns: ['escape', 'back', 'focus'], back: 'cancel', focusReturnsTo: 'invoking-control', above: null },
  { modal: 'crop-editor', owns: ['escape', 'back', 'focus'], back: 'cancel', focusReturnsTo: 'invoking-control', above: 'crop-confirm' },
  { modal: 'multi-face', owns: ['escape', 'back', 'focus'], back: 'cancel', focusReturnsTo: 'invoking-control', above: null },
  { modal: 'names-picker', owns: ['escape', 'back', 'focus'], back: 'cancel', focusReturnsTo: 'invoking-control', above: null },
]);

/** Candidate behaviour read from the control that the contract does not keep: typed as defects, never states. */
export interface CandidateDefect {
  readonly surface: keyof typeof SURFACES;
  readonly what: string;
  readonly evidence: string;
}
