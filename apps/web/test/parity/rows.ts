// The frozen flow matrix (fm-hn9e): every journey of PLAN.md "UI flow matrix and open journey contracts" and every
// candidate defect of "Known candidate defects found by operating the live candidate — 18 October 2026", one row
// each, with a stable rowId (also its golden directory), its tag and, for non-parity rows, the owning workstream.
//   parity   present in the control and unchanged by the plan: the port must match the control exactly
//   changed  present but changed by a declared UX change or a defect repair: graded against the plan, never asserted
//   new      absent from the control: graded against the plan's specification
// flow-matrix.spec.ts runs each row against the verified control; a row that cannot be exercised there is a
// skipped test with its reason.

export type Tag = 'parity' | 'changed' | 'new';
export type Owner =
  | 'ws-face'
  | 'ws-morph'
  | 'ws-media'
  | 'ws-consent'
  | 'ws-diag'
  | 'ws-names'
  | 'ws-opctl'
  | 'ws-provider'
  | 'ws-crop'
  | 'ws-device'
  | 'ws-migration';
export type Variant =
  | 'cold-model'
  | 'model-cached'
  | 'output-cached'
  | 'narrow'
  | 'wide'
  | 'keyboard'
  | 'touch'
  | 'mouse'
  | 'offline'
  | 'changed-input'
  | 'unsupported-capability';

export interface Row {
  readonly rowId: string;
  readonly journey: string;
  readonly tag: Tag;
  /** The owning workstream; required for changed and new rows. */
  readonly owner?: Owner;
  /** Candidate defects this row repairs (PLAN.md numbering). */
  readonly defects?: readonly number[];
  /** The plan section the row's contract lives in (for changed/new rows: the declared change). */
  readonly plan: string;
  readonly variants: readonly Variant[];
  /** Why the control cannot exercise it, when it cannot. */
  readonly unexercisable?: string;
}

const FLOW = 'PLAN.md#ui-flow-matrix-and-open-journey-contracts';
const DEFECTS =
  'PLAN.md#known-candidate-defects-found-by-operating-the-live-candidate--18-october-2026';
const FACE = 'PLAN.md#face-controls-and-modals';

export const ROWS: readonly Row[] = [
  // Journeys (flow matrix, in its order).
  {
    rowId: 'first-visit',
    journey: 'First app visit: usable inputs, names and defaults; no model download on arrival',
    tag: 'parity',
    plan: FLOW,
    variants: ['cold-model', 'narrow', 'wide', 'mouse', 'touch'],
  },
  {
    rowId: 'return-retained',
    journey:
      'Return with completed retained work: display, play and save without regeneration; slider choice kept',
    tag: 'parity',
    plan: FLOW,
    variants: ['output-cached', 'wide'],
  },
  {
    rowId: 'phone-cpu-route',
    journey: 'Phone or CPU route: admitted face and morph work proceeds on the CPU',
    tag: 'parity',
    plan: FLOW,
    variants: ['narrow', 'touch', 'unsupported-capability'],
  },
  {
    rowId: 'words.generate-cpu',
    journey: 'Enter new words: one Generate inside the tile makes the face (CPU)',
    tag: 'parity',
    plan: FLOW,
    variants: ['cold-model', 'wide', 'mouse'],
  },
  {
    rowId: 'seed.generate',
    journey: 'Enter a numeric seed, including 0 and 4,294,967,295, and generate it',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide', 'mouse'],
  },
  {
    rowId: 'retry-unchanged',
    journey: 'Cancel a text or seed generation, then retry the unchanged input without typing',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide', 'mouse'],
  },
  {
    rowId: 'edit-running-tile',
    journey: 'Edit, change mode or remove a queued or running tile: only that tile is superseded',
    tag: 'changed',
    owner: 'ws-opctl',
    defects: [17],
    plan: FLOW,
    variants: ['model-cached', 'changed-input'],
  },
  {
    rowId: 'names.open-pick',
    journey: 'Open names from a face menu; the pick returns to that face',
    tag: 'changed',
    owner: 'ws-names',
    plan: 'PLAN.md#static-names-and-picker',
    variants: ['wide', 'narrow'],
  },
  {
    rowId: 'names.slow-offline',
    journey:
      'Pick a name on a cold, slow or offline connection: preview, validated static result, no synthesis fallback',
    tag: 'new',
    owner: 'ws-names',
    plan: FLOW,
    variants: ['offline'],
    unexercisable:
      'The control synthesizes a picked name; static prepared results do not exist in it.',
  },
  {
    rowId: 'names.edit-picked',
    journey:
      'Edit a picked name as text: the field holds ordinary text and editing re-enables Generate',
    tag: 'changed',
    owner: 'ws-names',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'names.exact-text',
    journey: 'Find a known name by typing it in the text field and generating',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide'],
  },
  {
    rowId: 'names.modal-back-escape',
    journey: 'Open and close the names modal with Back or Escape; the panel and work are kept',
    tag: 'changed',
    owner: 'ws-names',
    plan: FLOW,
    variants: ['keyboard', 'touch'],
  },
  {
    rowId: 'device-timing',
    journey: 'Run, skip or time out the device timing check without blocking',
    tag: 'new',
    owner: 'ws-device',
    plan: FLOW,
    variants: [],
    unexercisable:
      'The control has no device timing check; it estimates from priors and measurements only.',
  },
  {
    rowId: 'provider.select',
    journey: 'Select CPU or WebGPU and request computation; the actual route is shown',
    tag: 'changed',
    owner: 'ws-provider',
    plan: 'PLAN.md#provider-simplification',
    variants: ['wide', 'unsupported-capability'],
  },
  {
    rowId: 'consent.approve-refuse',
    journey: 'Approve or refuse a missing-model download; refusal abandons the continuation',
    tag: 'changed',
    owner: 'ws-consent',
    defects: [10, 19],
    plan: 'PLAN.md#consented-downloads-useful-overlap-and-cached-model-warming',
    variants: ['cold-model'],
  },
  {
    rowId: 'consent.quota-failure',
    journey: 'Download, cache or quota failure: bounded retry, truthful bytes, completed work kept',
    tag: 'changed',
    owner: 'ws-consent',
    plan: FLOW,
    variants: ['cold-model'],
  },
  {
    rowId: 'photo.replace-cancel',
    journey: 'Replace a face with a photo; cancel the picker or the crop',
    tag: 'changed',
    owner: 'ws-crop',
    defects: [17],
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'photo.paste-drop',
    journey: 'Paste an image, or drop one on a tile or the background',
    tag: 'changed',
    owner: 'ws-crop',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'photo.multi-file',
    journey: 'Drop several files containing several faces; one face-click sequence',
    tag: 'changed',
    owner: 'ws-crop',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'crop.confirm-one',
    journey: 'Confirm one detected crop; the exact preview geometry reaches one encoder attempt',
    tag: 'changed',
    owner: 'ws-crop',
    plan: 'PLAN.md#confirmed-crop-and-ordered-multi-selection-flow',
    variants: ['wide'],
  },
  {
    rowId: 'crop.adjust-rotate',
    journey:
      'Adjust or rotate a crop; cancel restores the proposal, Use crop returns to confirmation',
    tag: 'changed',
    owner: 'ws-crop',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'crop.no-face',
    journey: 'No detected face or refused detector assets: a visible manual crop path',
    tag: 'changed',
    owner: 'ws-crop',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'crop.multi-face',
    journey: 'Select several detected faces; review each; insert in click order',
    tag: 'changed',
    owner: 'ws-crop',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'photo.assets-absent',
    journey:
      'Confirm a photo with encoder or generator assets absent: scoped consent, overlapped acquisition, automatic encode',
    tag: 'new',
    owner: 'ws-consent',
    plan: FLOW,
    variants: ['cold-model'],
    unexercisable:
      'The control asks before the photo encoder download and does not overlap acquisition with crop selection.',
  },
  {
    rowId: 'photo.cancel-retry-encode',
    journey: 'Cancel then retry one confirmed photo encode in the same slot',
    tag: 'changed',
    owner: 'ws-opctl',
    plan: FLOW,
    variants: ['model-cached'],
  },
  {
    rowId: 'controls.add-remove',
    journey: 'Add and remove controls: stable ordered inputs, morph invalidated',
    tag: 'changed',
    owner: 'ws-face',
    defects: [1],
    plan: FACE,
    variants: ['wide', 'narrow', 'mouse', 'touch'],
  },
  {
    rowId: 'controls.many-faces',
    journey: 'Add many faces, then remove most: every face reachable at any count',
    tag: 'changed',
    owner: 'ws-face',
    defects: [2, 3, 18],
    plan: FACE,
    variants: ['wide', 'narrow'],
  },
  {
    rowId: 'controls.undo-start-over',
    journey: 'Undo a removal; start over',
    tag: 'new',
    owner: 'ws-face',
    defects: [3],
    plan: FACE,
    variants: [],
    unexercisable: 'The control has no Undo and no Start over.',
  },
  {
    rowId: 'keyboard-only',
    journey: 'Use every journey with the keyboard alone',
    tag: 'changed',
    owner: 'ws-face',
    defects: [4],
    plan: FACE,
    variants: ['keyboard'],
  },
  {
    rowId: 'morph.identical-neighbours',
    journey: 'Morph two identical neighbouring faces: a plain refusal before any work',
    tag: 'changed',
    owner: 'ws-morph',
    defects: [6],
    plan: 'PLAN.md#morph-pipeline',
    variants: ['wide'],
  },
  {
    rowId: 'words.no-instant-picture',
    journey:
      'Type a word with no instant picture: the tile says to press Generate; nothing sent per keystroke',
    tag: 'changed',
    owner: 'ws-face',
    defects: [8, 11],
    plan: FACE,
    variants: ['wide'],
  },
  {
    rowId: 'words.phone-capitalisation',
    journey: 'Type on a phone keyboard that capitalises: the text arrives exactly as typed',
    tag: 'changed',
    owner: 'ws-face',
    defects: [5],
    plan: FACE,
    variants: ['narrow', 'touch'],
  },
  {
    rowId: 'reload-after-morph',
    journey: 'Reload after a morph: faces and result return with their words',
    tag: 'changed',
    owner: 'ws-media',
    defects: [9],
    plan: FLOW,
    variants: ['output-cached'],
  },
  {
    rowId: 'offline-cached',
    journey: 'Use the page offline with models cached',
    tag: 'changed',
    owner: 'ws-opctl',
    defects: [15],
    plan: FLOW,
    variants: ['offline', 'model-cached'],
  },
  {
    rowId: 'morph.unfinished-inputs',
    journey: 'Morph unfinished valid text or seed inputs: Create morph generates them first',
    tag: 'changed',
    owner: 'ws-opctl',
    plan: FLOW,
    variants: ['model-cached'],
  },
  {
    rowId: 'morph.settings-start-cancel',
    journey: 'Change morph settings, start, cancel, retry',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide'],
  },
  {
    rowId: 'morph.play-slider',
    journey: 'Play the video and switch to the slider',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide', 'narrow'],
  },
  {
    rowId: 'save.face-mp4',
    journey: 'Save a face (WebP/PNG) or the morph (MP4)',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide'],
  },
  {
    rowId: 'share.cancel-unsupported',
    journey: 'Share, cancel a share, or use a host without file sharing (Save stays obvious)',
    tag: 'parity',
    plan: FLOW,
    variants: ['wide', 'unsupported-capability'],
  },
  {
    rowId: 'save.repeat-rename-format',
    journey: 'Save repeatedly, rename, change format, save after reload',
    tag: 'changed',
    owner: 'ws-media',
    plan: 'PLAN.md#media-and-recovery',
    variants: ['output-cached'],
  },
  {
    rowId: 'reopen-still',
    journey:
      'Reopen a recovery-bearing still: view and save at once, restore its latent without encoding',
    tag: 'changed',
    owner: 'ws-media',
    plan: 'PLAN.md#media-and-recovery',
    variants: ['wide'],
  },
  {
    rowId: 'reopen-mp4-deferred',
    journey: 'Reopen an external project-bearing MP4',
    tag: 'new',
    owner: 'ws-media',
    plan: FLOW,
    variants: [],
    unexercisable: 'Deferred by the operator (12 October): outside the current UI scope.',
  },
  {
    rowId: 'recovery-damaged',
    journey: 'Missing, damaged or incompatible still recovery, or unsupported media',
    tag: 'changed',
    owner: 'ws-media',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'background-reload-close',
    journey:
      'Background, reload or close during unfinished work: truthful interruption, completed work kept',
    tag: 'changed',
    owner: 'ws-opctl',
    defects: [17],
    plan: FLOW,
    variants: ['changed-input'],
  },
  {
    rowId: 'report-error',
    journey: 'Report an error with and without standing consent',
    tag: 'changed',
    owner: 'ws-diag',
    defects: [12, 13, 16],
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'remove-down-to-one',
    journey: 'Remove down to one face: Generate, Encode, Save and reload stay useful',
    tag: 'changed',
    owner: 'ws-face',
    defects: [1, 7],
    plan: FACE,
    variants: ['wide'],
  },
  {
    rowId: 'testing-bulk-generate',
    journey: 'Tester bulk Generate faces (?testing) and the support and contact links',
    tag: 'parity',
    plan: FLOW,
    variants: ['model-cached', 'wide'],
  },
  {
    rowId: 'debug-on-off',
    journey: 'Turn standing debug reports on and off, reload, or fail to persist the choice',
    tag: 'changed',
    owner: 'ws-diag',
    plan: FLOW,
    variants: ['wide'],
  },
  {
    rowId: 'desktop-package-link',
    journey: 'Follow a desktop-package or download recommendation',
    tag: 'changed',
    owner: 'ws-provider',
    plan: FLOW,
    variants: ['wide'],
  },
  // Candidate defects with no journey row of their own (each is a repair, never parity).
  {
    rowId: 'defect.inconsistent-sizes',
    journey: 'Download sizes agree in the toast, dialog and progress',
    tag: 'changed',
    owner: 'ws-consent',
    defects: [10],
    plan: DEFECTS,
    variants: ['cold-model'],
  },
  {
    rowId: 'defect.privacy-text',
    journey: 'Nothing is sent per keystroke; the privacy text names every outside request',
    tag: 'changed',
    owner: 'ws-names',
    defects: [11],
    plan: DEFECTS,
    variants: ['wide'],
  },
  {
    rowId: 'defect.names-contrast',
    journey: 'Names stay readable over images; a failed list shows its error in the dialog',
    tag: 'changed',
    owner: 'ws-names',
    defects: [14],
    plan: DEFECTS,
    variants: ['wide', 'narrow'],
  },
  {
    rowId: 'defect.typos',
    journey:
      'Copy and look fixes: plurals, missing spaces, the seed placeholder, the cold estimate, disabled Create morph, the crop panel',
    tag: 'changed',
    owner: 'ws-face',
    defects: [20],
    plan: DEFECTS,
    variants: ['wide'],
  },
  {
    rowId: 'defect.licence-page',
    journey: 'The licence and notices page is linked and true',
    tag: 'changed',
    owner: 'ws-provider',
    defects: [21],
    plan: DEFECTS,
    variants: ['wide'],
  },
  {
    rowId: 'defect.storage',
    journey: 'What is stored on the device is shown and can be cleared; the faces store is bounded',
    tag: 'changed',
    owner: 'ws-media',
    defects: [22],
    plan: DEFECTS,
    variants: ['wide'],
  },
  {
    rowId: 'defect.preview-badge',
    journey: 'Preview faces carry no badge (decided): listed so it is a choice',
    tag: 'changed',
    owner: 'ws-face',
    defects: [23],
    plan: DEFECTS,
    variants: ['wide'],
  },
];
