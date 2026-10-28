// The case manifest of verify.functional (fm-ejwq): the input journeys — words, seeds, names, photo, removing down
// to one face, the retained tools, the processing selector (folded fm-5kpx) and restored words (folded fm-5hww).
// Each case names the operated e2e test that runs it (file and test title), its steps (step IDs are
// `verify.functional/<case id>/<step>`), and the flow-matrix rows (apps/web/test/parity/rows.ts) or candidate
// defects it grades. test/build/verify-functional-cases.test.ts validates it with the harness's manifestProblems and
// checks that every named test exists. A part of the bead's scope with no operated case is listed in UNTESTED with
// its reason, never left out silently: a grader reads it as `untested`, not `passed`.
import type { Case, CaseManifest } from '../harness.ts';

export interface OperatedCase extends Case {
  /** The e2e test that operates this case: its file under apps/web/test/e2e/ and its exact test title. */
  readonly test: { readonly file: string; readonly title: string };
}

const BOTH = [390, 1280];

/** A CaseManifest whose cases also name their tests. */
export interface OperatedManifest extends CaseManifest {
  readonly cases: readonly OperatedCase[];
}

export const VERIFY_FUNCTIONAL: OperatedManifest = {
  bead: 'verify.functional',
  cases: [
    {
      id: 'words-boundaries',
      steps: [
        'empty',
        'whitespace',
        '512-bytes',
        '513-bytes',
        'long-pasted',
        'ime-composition',
        'enter-generates-once',
        'exact-text-cache-record',
        'autocapitalize-off',
      ],
      rows: ['words.generate-cpu', 'words.phone-capitalisation'],
      defects: [5],
      widths: BOTH,
      test: {
        file: 'face-controls.e2e.ts',
        title:
          'composed tile validation, exact values, Enter, Cancel and Retry at visible positions',
      },
    },
    {
      id: 'seed-boundaries',
      steps: [
        'seed-0',
        'seed-4294967295',
        'seed-minus-1',
        'seed-1.5',
        'seed-4294967296',
        'seed-empty',
        'seed-spaced',
      ],
      rows: ['seed.generate'],
      widths: BOTH,
      test: {
        file: 'face-controls.e2e.ts',
        title:
          'composed tile validation, exact values, Enter, Cancel and Retry at visible positions',
      },
    },
    {
      id: 'words-no-instant-picture',
      steps: [
        'type-banana',
        'press-generate-hint',
        'photo-entry-in-menu',
        'type-seed-389',
        'no-request-while-typing',
      ],
      rows: ['words.no-instant-picture'],
      defects: [8],
      widths: BOTH,
      test: {
        file: 'names.e2e.ts',
        title:
          'typing "389" and "banana" sends no preview or name-list request until Browse names opens',
      },
    },
    {
      id: 'names-burger-binding',
      steps: [
        'burger-1-of-1',
        'burger-2-of-3',
        'burger-64-of-64',
        'dismiss-returns-focus',
        'pick-fills-that-face',
        'no-adornment',
        'keyboard-tab-enter-arrows',
      ],
      rows: ['names.open-pick', 'keyboard-only'],
      defects: [4],
      widths: BOTH,
      test: {
        file: 'names.e2e.ts',
        title:
          'Browse names from each face burger binds the pick to that face (1 of 1, 2 of 3, 64 of 64) and by keyboard',
      },
    },
    {
      id: 'names-back-escape',
      steps: ['floating-back', 'escape', 'history-back', 'forward-no-reopen', 'focus-returns'],
      rows: ['names.modal-back-escape'],
      widths: BOTH,
      test: {
        file: 'names.e2e.ts',
        title:
          'floating Back, Escape and history Back close once; Forward does not reopen; focus returns',
      },
    },
    {
      id: 'names-list-error',
      steps: ['open-with-500', 'error-in-dialog', 'dismiss'],
      rows: ['names.slow-offline'],
      widths: BOTH,
      test: {
        file: 'names.e2e.ts',
        title: 'a name list answering 500 shows its error inside a dismissible dialog',
      },
    },
    {
      id: 'names-static-result',
      steps: [
        'pick-first-name',
        'no-model-request',
        'no-inference-job',
        'one-result-one-index-fetch',
        'save-recovers-latent',
        'release-runtime-identity',
        'typed-equals-picked',
        'capitalised-differs',
        'edit-enables-generate',
      ],
      rows: ['names.open-pick', 'names.edit-picked', 'names.exact-text'],
      widths: BOTH,
      test: {
        file: 'names.e2e.ts',
        title:
          'a picked name shows its published result with no model request or inference, and is the typed name',
      },
    },
    {
      id: 'names-outside-hosts',
      steps: ['open-names', 'pick-first', 'listed-hosts-only'],
      rows: ['names.open-pick'],
      widths: [1280],
      test: {
        file: 'names.e2e.ts',
        title: 'a full journey contacts only outside hosts listed in outside-requests.ts',
      },
    },
    {
      id: 'photo-paste-drop',
      steps: [
        'card-chooser',
        'card-paste-image',
        'main-field-paste-image',
        'main-field-paste-text',
        'paste-unsupported',
      ],
      rows: ['photo.paste-drop'],
      widths: BOTH,
      test: {
        file: 'encode.e2e.ts',
        title:
          'Card photo entry and confirmed crop: trusted chooser/paste, geometry, cancellation and focus',
      },
    },
    {
      id: 'photo-drop-classified',
      steps: [
        'matching-still',
        'held-stills',
        'damaged-still',
        'photo-opens-crop',
        'mixed-page-drop',
      ],
      rows: ['photo.paste-drop', 'reopen-still', 'recovery-damaged'],
      widths: BOTH,
      test: {
        file: 'still-entry.e2e.ts',
        title: 'still entry classifies every file before a face changes (desktop and phone)',
      },
    },
    {
      id: 'crop-confirm-adjust-no-face',
      steps: [
        'triple-ok',
        'oriented-exif-1-3-6-8',
        'no-face-ok',
        'multi-face-ok',
        'manual-crop-wplus',
        'phone-adjust-use-ok',
        'cancel-before-ok',
        'cancel-after-ok',
        'stale-revision',
      ],
      rows: ['crop.confirm-one', 'crop.adjust-rotate', 'crop.no-face'],
      widths: BOTH,
      test: {
        file: 'crop-acceptance.e2e.ts',
        title: 'confirmed crop and still recovery through the built UI (fm-d4mw)',
      },
    },
    {
      // fm-q5b9, fm-id4c item 12: several files open one batch view.
      id: 'photo-batch-view',
      steps: [
        'r-a2-b1-corrupt-omitted',
        'cancel-unchanged',
        'ok-click-order',
        'damaged-use-as-photo-explicit',
        'other-model-held',
        'encoding-refused-saved-subset',
        'single-still-direct',
        'paste-opens-view',
      ],
      rows: ['photo.paste-drop', 'reopen-still', 'recovery-damaged'],
      widths: BOTH,
      test: {
        file: 'batch.e2e.ts',
        title: 'the batch view: recovered stills beside crop candidates, Cancel, OK in click order',
      },
    },
    {
      id: 'remove-down-to-one',
      steps: [
        'matrix-counts',
        'twenty-taps-start-over-undo',
        'one-face-generate-save',
        'add-face-enabled',
      ],
      rows: ['remove-down-to-one', 'controls.add-remove', 'controls.undo-start-over'],
      defects: [7],
      widths: BOTH,
      test: {
        file: 'face-many.e2e.ts',
        title: 'face.many: layout, Remove, Undo and Start over operated at every count and width',
      },
    },
    {
      id: 'photo-refused-open-saved',
      steps: ['open-saved-image-label', 'saved-image-opens', 'saved-image-saves'],
      rows: ['photo.paste-drop'],
      widths: BOTH,
      test: {
        file: 'face-controls.e2e.ts',
        title:
          'photo encoding genuinely refused: every photo entry reads Open saved image and a saved image opens and saves',
      },
    },
    {
      id: 'provider-selector',
      steps: [
        'selector-above-first-plus',
        'every-option',
        'cpu-on-null-adapter',
        'no-gpu-asset',
        'locked-while-busy',
      ],
      rows: ['provider.select', 'phone-cpu-route'],
      widths: BOTH,
      test: {
        file: 'provider-selector.e2e.ts',
        title:
          'the processing selector above the faces: operated, every option, CPU on a null adapter, locked while busy',
      },
    },
    {
      id: 'restore-words',
      steps: [
        'reload-restores-words',
        'new-tab-restored-face',
        'stored-size',
        'clear',
        'storage-scan',
      ],
      rows: ['background-reload-close', 'defect.storage'],
      defects: [22],
      widths: BOTH,
      test: {
        file: 'session-words.e2e.ts',
        title:
          'session words across reload, new tab, stored size and Clear in the built destination',
      },
    },
    {
      id: 'restore-words-many',
      steps: ['project-import-many', 'stored-session-bound', 'reload'],
      rows: ['background-reload-close', 'defect.storage'],
      widths: BOTH,
      test: {
        file: 'session-words.e2e.ts',
        title:
          'many faces through a real project import, then the stored-session byte bound (no face count) on reload',
      },
    },
    {
      // session-words opens /?testing, types every face and presses Generate faces at its visible position.
      id: 'testing-bulk-generate',
      steps: ['open-testing-link', 'type-every-face', 'generate-faces', 'faces-made'],
      rows: ['testing-bulk-generate'],
      widths: BOTH,
      test: {
        file: 'session-words.e2e.ts',
        title:
          'session words across reload, new tab, stored size and Clear in the built destination',
      },
    },
    {
      id: 'retained-tools-links',
      steps: ['help-links', 'refusal-help', 'licence-links'],
      rows: ['testing-bulk-generate'],
      widths: BOTH,
      test: {
        file: 'help.e2e.ts',
        title: 'Help, refusal Help and licence links at their visible positions, phone and desktop',
      },
    },
    {
      id: 'issue-link',
      steps: ['footer-issue-link', 'bug-report-template', 'monorepo-repository'],
      rows: ['testing-bulk-generate', 'report-error'],
      widths: BOTH,
      test: {
        file: 'shell.e2e.ts',
        title: ': shell rows match the control, every link is operable, every emitted worker loads',
      },
    },
  ],
};

/** Parts of the bead's scope with no operated case yet; each is graded `untested` until a case runs it. */
export const UNTESTED: readonly {
  readonly rows: readonly string[];
  readonly part: string;
  readonly reason: string;
}[] = [];
