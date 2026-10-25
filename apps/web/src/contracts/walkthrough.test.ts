// fm-4ri7: executable type walkthroughs, not UI/runtime evidence. Only contract
// modules are imported. The Node test runner lives in test/contracts/walkthrough.test.ts.
import {
  FFHQ_1024_DESCRIPTOR,
  sameModelEndpoints,
  type IdentifiedLatent,
  type ModelDescriptor,
} from '../../../../packages/stylegan-js/src/contracts/descriptor.ts';
import type { RecoveredStill } from '@facemorph/stylegan-js';
import {
  CROP_PREPROCESSING_POLICY_V1, createConfirmedCrop,
} from '../../../../packages/stylegan-js/src/contracts/crop-policy.ts';
import { applyClick, type BatchSelection } from './batch.ts';
import type { AppGrantState } from './consent-state.ts';
import { exportIdentity, withEditedName, type ExportIdentity, type ExportKind } from './export-identity.ts';
import type { ConsentCostRow } from './preflight.ts';
import type { WholeActionProgress } from './progress.ts';
import { classifyRecovery, type RecoveryClassification } from './recovery-classification.ts';
import type { RouteSnapshot } from './scheduler.ts';
import type { TileActionState } from './tiles.ts';
import { SURFACES, type ContractType, type NamesPickerState, type Transition } from './ui-states.ts';

interface Payloads {
  TileActionState: TileActionState;
  WholeActionProgress: WholeActionProgress;
  AppGrantState: AppGrantState;
  ConsentCostRow: ConsentCostRow;
  RouteSnapshot: RouteSnapshot;
  ExportIdentity: ExportIdentity;
  BatchSelection: BatchSelection;
  RecoveryClassification: RecoveryClassification;
  none: null;
}
// New contract tags must acquire their actual type here; there is no unknown/any escape.
type MissingPayload = Exclude<ContractType, keyof Payloads>;
export const allPayloadsCovered: [MissingPayload] extends [never] ? true : false = true;
type SurfaceName = keyof typeof SURFACES;
type State<S extends SurfaceName> = (typeof SURFACES)[S]['states'][number];
export type WalkStep = {
  [C in ContractType]: {
    readonly surface: SurfaceName;
    readonly from: string;
    readonly event: string;
    readonly to: string;
    readonly contract: C;
    readonly value: Payloads[C];
  };
}[ContractType];

function step<S extends SurfaceName, C extends ContractType>(
  surface: S, from: State<S>, event: string, to: State<S>, contract: C, value: Payloads[C],
) {
  const row: Transition<string> | undefined = SURFACES[surface].transitions.find(
    (t) => t.from === from && t.event === event && t.to === to && t.contract === contract,
  );
  if (!row) throw new Error(`Missing contract transition: ${surface} ${from} --${event}--> ${to} (${contract})`);
  return { surface, from, event, to, contract, value };
}

const idle: TileActionState = { state: 'ready', commands: ['generate'] };
const pending: TileActionState = { state: 'static-selection-pending', commands: ['retry'] };
const verified: TileActionState = { state: 'verified-result', commands: ['result-actions'], resultRevision: 1 };
const progress: WholeActionProgress = { kind: 'indeterminate', action: 'morph', attemptId: 'morph-2' };
const descriptor: ModelDescriptor = FFHQ_1024_DESCRIPTOR;
const route: RouteSnapshot = {
  requested: 'webgpu', fallbackScope: 'none', modelSha256: descriptor.identity.modelSha256,
  runtimeSha256: 'walkthrough-runtime',
};
const stillFor = (name: string, kind: ExportKind = 'webp') => exportIdentity({
  kind, crops: [], orderedInputs: [name], modelIdentity: descriptor.identity.modelSha256,
  format: kind === 'webp' ? 'webp-lossless' : kind, encodingOptions: {},
}, { origin: 'result-name', text: name });
const still = stillFor('first-name');
const movie = exportIdentity({
  kind: 'mp4', crops: [], orderedInputs: ['first-name', 'second-name'],
  morph: { mode: 'linear', settings: { frames: 2 } }, modelIdentity: descriptor.identity.modelSha256,
  format: 'mp4', encodingOptions: {},
}, { origin: 'result-name', text: 'two-names' });

function name(faceId: string, selected: string) {
  // Each invocation targets a distinct stable tile; no engine acquisition is implied.
  return {
    target: { picker: 'picked', faceId, name: selected } satisfies NamesPickerState,
    steps: [
      step('namesPicker', 'closed', 'open-from-burger', 'cold-loading', 'none', null),
      step('namesPicker', 'cold-loading', 'loaded', 'loaded', 'none', null),
      step('namesPicker', 'loaded', 'pick', 'picked', 'TileActionState', pending),
      step('tiles', 'ready', 'select-name', 'static-selection-pending', 'TileActionState', pending),
      step('tiles', 'static-selection-pending', 'static-ready', 'verified-result', 'ExportIdentity', stillFor(selected)),
    ],
  };
}
export const firstName = name('face-1', 'first-name');
export const secondName = name('face-2', 'second-name');

export const selectionHistory: BatchSelection[] = [];
export const orderedSelection = ['b#1', 'a#0', 'b#1', 'a#1', 'b#1'].reduce<BatchSelection>(
  (selection, candidate) => {
    // Validate the literal input rather than casting an arbitrary string into CandidateId.
    if (candidate !== 'a#0' && candidate !== 'a#1' && candidate !== 'b#1') throw new Error('Unknown candidate');
    const next = applyClick(selection, { candidate });
    selectionHistory.push(next);
    return next;
  },
  { files: [{ id: 'a', kind: 'photo', candidates: ['a#0', 'a#1'] }, { id: 'b', kind: 'photo', candidates: ['b#1'] }], order: [] },
);

export const confirmedPhotos = orderedSelection.order.map((candidate, index) => ({
  candidate,
  crop: createConfirmedCrop({
    sourceRevision: candidate.startsWith('a#') ? 1 : 2, sourceDigest: (candidate.startsWith('a#') ? 'a' : 'b').repeat(64),
    rect: { left: 10 + index, top: 20, width: 100, height: 100 }, rotationDegrees: 90,
    exifOrientation: 1, exifApplied: false, policyVersion: CROP_PREPROCESSING_POLICY_V1.version,
    policyParams: CROP_PREPROCESSING_POLICY_V1,
  }),
}));

function retrySteps(action: 'face' | 'photo') {
  const actionProgress: WholeActionProgress = { ...progress, action, attemptId: '1' };
  const firstCrop = confirmedPhotos[0];
  if (!firstCrop) throw new Error('The photo walk requires a confirmed selection');
  const result = action === 'face' ? still : exportIdentity({
    kind: 'webp', crops: [firstCrop.crop.confirmedCropId], orderedInputs: [firstCrop.candidate],
    modelIdentity: descriptor.identity.modelSha256, format: 'webp-lossless', encodingOptions: {},
  });
  return [
    step('tiles', 'empty-or-invalid', 'input', 'ready', 'TileActionState', idle),
    step('tiles', 'ready', 'generate', 'queued', 'TileActionState', { state: 'queued', commands: ['cancel'], attemptId: '1' }),
    step('tiles', 'queued', 'start', 'active', 'WholeActionProgress', actionProgress),
    step('tiles', 'active', 'cancel', 'cancelling', 'TileActionState', { state: 'cancelling', commands: [], attemptId: '1' }),
    step('tiles', 'cancelling', 'stopped', 'failed-retryable', 'TileActionState', { state: 'failed-retryable', commands: ['retry'], retryPixels: true }),
    step('tiles', 'failed-retryable', 'retry', 'queued', 'TileActionState', { state: 'queued', commands: ['cancel'], attemptId: '2' }),
    step('tiles', 'queued', 'start', 'active', 'WholeActionProgress', { ...actionProgress, attemptId: '2' }),
    step('tiles', 'active', 'pixels-ready', 'file-pending', 'TileActionState', { state: 'file-pending', commands: [], resultRevision: 1 }),
    step('tiles', 'file-pending', 'file-ready', 'verified-result', 'ExportIdentity', result),
  ];
}

export const walks = {
  inspect: [step('main', 'empty', 'inspect-interface', 'empty', 'none', null)],
  faces: [
    step('main', 'empty', 'add-face', 'one', 'TileActionState', idle),
    step('main', 'one', 'add-face', 'two-or-more', 'TileActionState', idle),
    step('main', 'two-or-more', 'add-face', 'many', 'TileActionState', idle),
  ],
  names: [...firstName.steps, ...secondName.steps],
  namesCleanup: [
    step('namesPicker', 'cold-loading', 'failed', 'error', 'none', null),
    step('namesPicker', 'error', 'retry', 'cold-loading', 'none', null),
    step('namesPicker', 'cold-loading', 'target-revised', 'invalidated', 'none', null),
    step('namesPicker', 'loaded', 'dismiss', 'closed', 'none', null),
    step('tiles', 'verified-result', 'edit', 'ready', 'TileActionState', idle),
  ],
  generateRetry: retrySteps('face'),
  photoRetry: retrySteps('photo'),
  morph: [
    step('morphResult', 'none', 'create-morph', 'producing', 'WholeActionProgress', progress),
    step('morphResult', 'producing', 'cancel', 'cancelled', 'none', null),
    step('morphResult', 'cancelled', 'retry', 'producing', 'WholeActionProgress', { ...progress, attemptId: 'morph-3' }),
    step('morphResult', 'producing', 'complete', 'current', 'ExportIdentity', movie),
    step('morphResult', 'current', 'play', 'current', 'ExportIdentity', movie),
    step('morphResult', 'current', 'scrub', 'current', 'ExportIdentity', movie),
  ],
  saveReload: [
    step('resultActions', 'none', 'result', 'preparing-file', 'ExportIdentity', movie),
    step('resultActions', 'preparing-file', 'file-ready', 'ready', 'ExportIdentity', movie),
    step('resultActions', 'ready', 'save', 'ready', 'ExportIdentity', movie),
    step('main', 'completed', 'reload', 'completed', 'TileActionState', verified),
    step('morphResult', 'current', 'reload', 'current', 'ExportIdentity', movie),
    step('tiles', 'verified-result', 'reload', 'verified-result', 'ExportIdentity', still),
    step('resultActions', 'ready', 'result-changed', 'preparing-file', 'ExportIdentity', still),
    step('resultActions', 'preparing-file', 'file-ready', 'ready', 'ExportIdentity', still),
    step('resultActions', 'ready', 'save', 'ready', 'ExportIdentity', still),
    step('resultActions', 'ready', 'save', 'ready', 'ExportIdentity', still),
    step('fileOpen', 'missing', 'open-valid', 'still', 'RecoveryClassification', 'matching'),
  ],
  photo: [
    step('fileOpen', 'missing', 'encode-explicitly', 'photo-encoding-offered', 'RecoveryClassification', 'missing'),
    step('multiFace', 'detecting', 'faces-detected', 'choosing', 'BatchSelection', { ...orderedSelection, order: [] }),
    ...selectionHistory.map((selection) => step('multiFace', 'choosing', 'click', 'choosing', 'BatchSelection', selection)),
    step('multiFace', 'choosing', 'commit', 'committed', 'TileActionState', idle),
    step('cropConfirm', 'proposed', 'adjust-crop', 'proposed', 'none', null),
    step('cropEditor', 'editing', 'cancel', 'cancelled', 'none', null),
    step('cropEditor', 'editing', 'use-crop', 'used', 'none', null),
    step('cropConfirm', 'proposed', 'use-crop', 'proposed', 'none', null),
    ...confirmedPhotos.map(() => step('cropConfirm', 'proposed', 'ok', 'committed', 'TileActionState', idle)),
  ],
  photoCleanup: [
    step('cropFailedToAlign', 'detector-failed', 'adjust-crop', 'detector-failed', 'none', null),
    step('cropConfirm', 'detector-failed', 'cancel', 'abandoned', 'none', null),
    step('multiFace', 'choosing', 'cancel', 'cancelled', 'none', null),
    step('tiles', 'failed-retryable', 'pixels-evicted', 'retry-pixels-lost', 'TileActionState', { state: 'retry-pixels-lost', commands: ['encode-image'], retryPixels: false }),
  ],
  consent: [
    step('coldDownload', 'confirm', 'cancel', 'cancelled', 'AppGrantState', { status: 'declined', owner: 'face:1' }),
    step('coldDownload', 'confirm', 'continue', 'in-progress', 'AppGrantState', { status: 'approved', owner: 'face:1', approvedBytes: 100 }),
    step('coldDownload', 'in-progress', 'failure', 'error', 'WholeActionProgress', progress),
    step('coldDownload', 'error', 'retry', 'in-progress', 'AppGrantState', { status: 'approved', owner: 'face:1', approvedBytes: 100 }),
    step('coldDownload', 'in-progress', 'cancel', 'cancelled', 'WholeActionProgress', progress),
  ],
  invalidate: [
    step('morphResult', 'current', 'face-or-setting-changed', 'invalidated', 'none', null),
    step('resultActions', 'ready', 'invalidate', 'none', 'none', null),
    step('resultActions', 'preparing-file', 'invalidate', 'none', 'none', null),
    step('namesPicker', 'picked', 'target-revised', 'invalidated', 'none', null),
    step('main', 'completed', 'remove-to-one', 'one', 'TileActionState', verified),
    step('main', 'one', 'undo', 'two-or-more', 'TileActionState', verified),
    step('main', 'completed', 'start-over', 'empty', 'none', null),
  ],
  shareFormat: [
    step('resultActions', 'ready', 'share', 'ready', 'ExportIdentity', still),
    step('resultActions', 'ready', 'share-cancel', 'share-cancelled', 'none', null),
    step('resultActions', 'share-cancelled', 'dismiss-share', 'ready', 'ExportIdentity', still),
    step('resultActions', 'ready', 'format-change', 'preparing-file', 'ExportIdentity', withEditedName(stillFor('first-name', 'png'), 'renamed')),
  ],
  unsupported: [
    step('fileOpen', 'missing', 'open-mp4', 'unsupported-mp4', 'none', null),
    step('morphResult', 'none', 'unsupported-route', 'none', 'RouteSnapshot', route),
    step('morphResult', 'none', 'identical-neighbours', 'none', 'none', null),
    step('morphResult', 'none', 'incompatible-endpoints', 'none', 'none', null),
    step('fileOpen', 'missing', 'open-damaged', 'damaged', 'RecoveryClassification', 'damaged'),
    step('fileOpen', 'missing', 'open-incompatible', 'incompatible', 'RecoveryClassification', 'incompatible-model'),
  ],
} satisfies Record<string, readonly WalkStep[]>;

export function descriptorWalkthrough() {
  const first: IdentifiedLatent = {
    space: 'w-plus', shape: [descriptor.latent.layers, descriptor.latent.width],
    values: new Float32Array(descriptor.latent.layers * descriptor.latent.width),
    modelSha256: descriptor.identity.modelSha256, noiseSha256: descriptor.identity.noiseSha256,
  };
  const second: IdentifiedLatent = { ...first, values: first.values.slice() };
  const recovered: RecoveredStill = {
    schemaVersion: 2, mime: 'image/webp', width: descriptor.output.shape[3], height: descriptor.output.shape[2],
    provenance: descriptor.identity, latent: first, imageSha256: 'a'.repeat(64),
    latentSha256: 'b'.repeat(64), baseImage: new Uint8Array(),
  };
  return {
    descriptor, first, second, recovered,
    accepted: sameModelEndpoints(descriptor, [first, second]),
    mixed: sameModelEndpoints(descriptor, [first, { ...second, modelSha256: 'different-model' }]),
    reopened: classifyRecovery({ kind: 'parsed', recovered }, { loaded: descriptor.identity, known: [descriptor.identity] }),
  };
}
