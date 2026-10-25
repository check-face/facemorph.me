// Legacy crop-dialog reference (fm-bbhu, plan:face.design): every visual element and interaction of the locked crop
// references and classic's EncodeImageDialog.fs, each marked reproduce or deliberate difference with its owning bead.
// face.encode (fm-fy2.17.1) and face.crop-editor (fm-z0et) tests iterate this list; geometry and colours are in
// docs/design/legacy-encode-dialog-geometry.json and legacy-encode-dialog-colours.json (scripts/design/measure-legacy-dialog.py).
//
// Sources: the locked images in reference-locks/2026-10-11-original-plan-and-images/images/ (SHA-256 in that bundle's
// SHA256SUMS and PLAN.md#supplied-ui-references) and EncodeImageDialog.fs in facemorph.me-classic history at 05aca4a
// (2022-05-05, its last change).
//
// CROPPER BASIS: our own hand-written component (decided by the fm-bbhu spike, commit c2ed0d3, CI run 40086585902; the
// prototypes are removed afterwards, the evidence stays in that run's artifacts). Measured on eris in Chromium, Firefox
// and WebKit:
//   - Geometry against docs/design (tolerance 0.01 of modal width): hand-written 53/55 boxes at 1,280 px (misses: USE CROP
//     x and width by 0.013) and 39/55 at 390 px (fixed-pixel touch targets and text wrapping); react-advanced-cropper
//     0.20.1 36/55 and 22/55: its stencil is capped to the photo height (0.66 vs 0.705) and sits off-centre, and the oval,
//     eye markers and eight handles needed a copied RectangleStencil and custom handles.
//   - Touch at 390 px: both pass drag, each of the 8 handles and rotation; react-advanced-cropper swallows about the first
//     30 px of finger travel (DraggableElement activationDistance 30).
//   - Coordinates: over EXIF orientations 1/3/6/8 x rotations 0, 90 and 17.5 degrees both map to the same raw source pixels
//     within 1 px, so either round-trips into the contracts' ConfirmedCrop.
//   - Bundle (min+gzip): hand-written +1.3 KB over the shell; react-advanced-cropper +27.2 KB.
//   - Licence and maintenance: react-advanced-cropper is MIT, React >= 16.8, last npm release 0.20.1 on 2025-03-01 (none
//     in about 19 months), 16 open issues; the hand-written component has no dependency to maintain.
//   - Open extras (OPEN_CROPPER_EXTRAS): react-advanced-cropper has wheel/pinch zoom and an off-photo stencil
//     (imageRestriction 'none') as settings; the hand-written one already lets the stencil pass the photo edge and would
//     need a scale term in its view-to-source maths for zoom; the pre-upload tip is plain UI on either basis.

export type LegacySource = 'crop image.png' | 'crop 2.png' | 'failed to align.png' | 'recovered image.png' | 'EncodeImageDialog.fs';
export type DialogState = 'proposal' | 'editor' | 'failure';
export type Disposition = 'reproduce' | 'deliberate difference';

export interface LegacyElement {
  readonly id: string;
  readonly sources: readonly LegacySource[];
  readonly states: readonly DialogState[];
  readonly kind: 'title' | 'logo' | 'preview' | 'button' | 'stencil' | 'handle' | 'guide' | 'readout' | 'slider' | 'copy' | 'input' | 'icon';
  /** Exact visible text where the element carries text (as shown, including case). */
  readonly copy?: string;
  /** Dotted path in docs/design/legacy-encode-dialog-geometry.json to the element's measurement, where it was measurable. */
  readonly geometry?: string;
  readonly disposition: Disposition;
  /** For a deliberate difference: what changes and why. */
  readonly reason?: string;
  readonly planAnchor?: string;
  readonly owner: string;
}

export interface LegacyInteraction {
  readonly id: string;
  readonly source: LegacySource;
  readonly states: readonly DialogState[];
  readonly what: string;
  readonly disposition: Disposition;
  readonly reason?: string;
  readonly planAnchor?: string;
  readonly owner: string;
}

const ENCODE = 'fm-fy2.17.1'; // face.encode: card photo entry and crop confirmation
const EDITOR = 'fm-z0et'; // face.crop-editor: crop editor per crop 2.png and the alignment-failure path
const TILES = 'fm-25um'; // face.tiles: tile action states, paste, Encode image rename
const CROP_FIX = 'fm-6ib8'; // crop.fix: confirmed crop to e4e without redetection
const CONSENT = 'fm-9kr8'; // consent: Prepare encoder

export const LEGACY_ELEMENTS: readonly LegacyElement[] = [
  // Titles. The same dark modal chrome in all three states.
  { id: 'title-encode', sources: ['crop image.png'], states: ['proposal'], kind: 'title', copy: 'Encode an image', geometry: 'dialogs.confirmation.title', disposition: 'reproduce', owner: ENCODE },
  { id: 'title-crop', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'title', copy: 'Crop your image', geometry: 'dialogs.editor.title', disposition: 'reproduce', owner: EDITOR },
  { id: 'title-failure', sources: ['failed to align.png', 'EncodeImageDialog.fs'], states: ['failure'], kind: 'title', copy: 'Encode an image', geometry: 'dialogs.failure.title',
    disposition: 'deliberate difference', reason: 'The legacy failure screen was titled "Upload an image"; nothing is uploaded now and the flow is one "Encode an image" dialog.',
    planAnchor: 'PLAN.md#crop-fidelity-and-export-flow-clarification', owner: EDITOR },
  { id: 'logo', sources: ['crop image.png', 'crop 2.png', 'failed to align.png', 'EncodeImageDialog.fs'], states: ['proposal', 'editor', 'failure'], kind: 'logo',
    geometry: 'dialogs.confirmation.logo', disposition: 'reproduce', owner: ENCODE },
  // Confirmation (proposal) state.
  { id: 'proposal-preview', sources: ['crop image.png'], states: ['proposal'], kind: 'preview', geometry: 'dialogs.confirmation.preview', disposition: 'reproduce', owner: ENCODE },
  { id: 'adjust-crop', sources: ['crop image.png'], states: ['proposal'], kind: 'button', copy: 'ADJUST CROP', geometry: 'dialogs.confirmation.adjust_crop_text', disposition: 'reproduce', owner: ENCODE },
  { id: 'cancel', sources: ['crop image.png', 'crop 2.png', 'failed to align.png', 'EncodeImageDialog.fs'], states: ['proposal', 'editor', 'failure'], kind: 'button', copy: 'CANCEL',
    geometry: 'dialogs.confirmation.cancel', disposition: 'reproduce', owner: ENCODE },
  { id: 'ok', sources: ['crop image.png', 'failed to align.png', 'EncodeImageDialog.fs'], states: ['proposal', 'failure'], kind: 'button', copy: 'OK', geometry: 'dialogs.confirmation.ok',
    disposition: 'reproduce', owner: ENCODE },
  { id: 'encode-explanation', sources: [], states: ['proposal'], kind: 'copy',
    disposition: 'deliberate difference', reason: 'One short explanation in the confirmation modal that encoding recreates the face and may change details (wording is face.encode\'s); the locked images have none.',
    planAnchor: 'PLAN.md#confirmed-crop-encoding', owner: ENCODE },
  // Editor state (crop 2.png).
  { id: 'editor-photo-frame', sources: ['crop 2.png'], states: ['editor'], kind: 'preview', geometry: 'dialogs.editor.photo_frame', disposition: 'reproduce', owner: EDITOR },
  { id: 'stencil', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'stencil', geometry: 'dialogs.editor.stencil', disposition: 'reproduce', owner: EDITOR },
  ...(['top_left', 'top', 'top_right', 'right', 'bottom_right', 'bottom', 'bottom_left', 'left'] as const).map((at): LegacyElement => ({
    id: `handle-${at}`, sources: ['crop 2.png'], states: ['editor'], kind: 'handle', geometry: `dialogs.editor.handles.centres.${at}`, disposition: 'reproduce', owner: EDITOR,
  })),
  { id: 'oval-guide', sources: ['crop 2.png'], states: ['editor'], kind: 'guide', geometry: 'dialogs.editor.oval_guide', disposition: 'reproduce', owner: EDITOR },
  { id: 'eye-marker-left', sources: ['crop 2.png'], states: ['editor'], kind: 'guide', geometry: 'dialogs.editor.eye_markers', disposition: 'reproduce', owner: EDITOR },
  { id: 'eye-marker-right', sources: ['crop 2.png'], states: ['editor'], kind: 'guide', geometry: 'dialogs.editor.eye_markers', disposition: 'reproduce', owner: EDITOR },
  { id: 'rotate-icon', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'icon', geometry: 'dialogs.editor.rotate_icon', disposition: 'reproduce', owner: EDITOR },
  { id: 'degree-readout', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'readout', copy: '0°', geometry: 'dialogs.editor.rotate_readout', disposition: 'reproduce', owner: EDITOR },
  { id: 'rotation-slider', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'slider', geometry: 'dialogs.editor.slider_track', disposition: 'reproduce', owner: EDITOR },
  { id: 'guidance-bold', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'copy', copy: 'Cropping is generally not necessary, as faces are usually auto detected.',
    geometry: 'dialogs.editor.copy_block', disposition: 'reproduce', owner: EDITOR },
  { id: 'guidance-lines', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'copy',
    copy: 'Try to leave a bit above the top of the head and below the chin. Lining up the eyes is most important.', geometry: 'dialogs.editor.copy_block', disposition: 'reproduce', owner: EDITOR },
  { id: 'use-crop', sources: ['crop 2.png', 'EncodeImageDialog.fs'], states: ['editor'], kind: 'button', copy: 'USE CROP', geometry: 'dialogs.editor.use_crop', disposition: 'reproduce', owner: EDITOR },
  // Failure state (failed to align.png).
  { id: 'failure-preview', sources: ['failed to align.png', 'EncodeImageDialog.fs'], states: ['failure'], kind: 'preview', geometry: 'dialogs.failure.preview',
    disposition: 'reproduce', reason: 'The whole photo, not a square crop.', owner: EDITOR },
  { id: 'failure-crop', sources: ['failed to align.png', 'EncodeImageDialog.fs'], states: ['failure'], kind: 'button', copy: 'ADJUST CROP', geometry: 'dialogs.failure.crop_button',
    disposition: 'deliberate difference', reason: 'The red filled CROP button becomes ADJUST CROP with the same red fill, centred, so one name opens the editor everywhere.',
    planAnchor: 'PLAN.md#crop-fidelity-and-export-flow-clarification', owner: EDITOR },
  { id: 'failure-line', sources: ['failed to align.png', 'EncodeImageDialog.fs'], states: ['failure'], kind: 'copy', copy: 'Unable to auto align face.', geometry: 'dialogs.failure.failure_line',
    disposition: 'reproduce', reason: 'Shown when on-device detection cannot propose a crop; it never appears after a crop the person confirmed.', owner: EDITOR },
  { id: 'failure-guidance', sources: ['failed to align.png', 'EncodeImageDialog.fs'], states: ['failure'], kind: 'copy',
    copy: "When the face isn't aligned you may get strange results. Try a different image or manually crop it. Make sure the entire face is in frame and looking towards the camera.",
    geometry: 'dialogs.failure.guidance', disposition: 'deliberate difference',
    reason: 'The legacy text says "looking towards to camera" (sic); the typo is corrected by default. Otherwise word for word.', planAnchor: 'PLAN.md#crop-fidelity-and-export-flow-clarification', owner: EDITOR },
  // Legacy source step (EncodeImageDialog.fs only). Operator correction, 26 October 2026: there is no empty
  // source modal; the face card owns choose, drop and paste as in the classic candidate, and the dialog opens
  // only to confirm a fresh photo's crop.
  { id: 'file-chooser', sources: ['EncodeImageDialog.fs'], states: [], kind: 'input', copy: 'Choose image', disposition: 'deliberate difference',
    reason: "The face card's Encode image entry (empty card or mode menu) opens that card's own file chooser (JPEG, PNG and WebP as before); no source dialog.", planAnchor: 'PLAN.md#face-controls-and-modals', owner: ENCODE },
  { id: 'paste-field', sources: ['EncodeImageDialog.fs'], states: [], kind: 'input', copy: 'Or paste image here', disposition: 'deliberate difference',
    reason: "Paste goes into the face card's field: an image wins over coincident text; other clipboard content leaves the text unchanged with one message.", planAnchor: 'PLAN.md#face-controls-and-modals', owner: TILES },
  { id: 'prepare-encoder', sources: [], states: [], kind: 'button', copy: 'Prepare encoder', disposition: 'deliberate difference',
    reason: 'No source step holds it; acquisition consent owns encoder setup and its entry.', planAnchor: 'PLAN.md#face-controls-and-modals', owner: CONSENT },
  { id: 'rotate-90-button', sources: ['EncodeImageDialog.fs', 'crop 2.png'], states: ['editor'], kind: 'button', geometry: 'dialogs.editor.rotate_icon', disposition: 'reproduce',
    reason: 'The crop-rotate icon button: 90 degrees per press (EncodeImageDialog.fs rotateCrop), resetting the fine slider.', owner: EDITOR },
  // recovered image.png: controls the plan removes.
  { id: 'recovered-filename-caption', sources: ['recovered image.png'], states: [], kind: 'copy', disposition: 'deliberate difference',
    reason: 'The duplicate filename caption under a recovered face is removed.', planAnchor: 'PLAN.md#supplied-ui-references', owner: TILES },
  { id: 'recovered-crop-photo', sources: ['recovered image.png'], states: [], kind: 'button', copy: 'CROP PHOTO', disposition: 'deliberate difference',
    reason: 'No CROP PHOTO after encoding: cropping belongs to the Encode image dialog before encoding.', planAnchor: 'PLAN.md#supplied-ui-references', owner: TILES },
  { id: 'recovered-hold-to-compare', sources: ['recovered image.png'], states: [], kind: 'button', copy: 'Hold to compare', disposition: 'deliberate difference',
    reason: 'Hold to compare is removed.', planAnchor: 'PLAN.md#supplied-ui-references', owner: TILES },
];

export const LEGACY_INTERACTIONS: readonly LegacyInteraction[] = [
  { id: 'choose-file', source: 'EncodeImageDialog.fs', states: [], what: 'Choose an image file (JPEG, PNG, WebP).', disposition: 'deliberate difference',
    reason: "Chosen from the face card's own file chooser; a fresh photo then opens the crop confirmation.", planAnchor: 'PLAN.md#face-controls-and-modals', owner: ENCODE },
  { id: 'paste', source: 'EncodeImageDialog.fs', states: [], what: 'Paste an image from the clipboard; pasted text is refused with "Paste an actual image, not text."', disposition: 'deliberate difference',
    reason: "Pasted into the face card's field; text stays ordinary typing there, so only image or unsupported clipboard content is handled.", planAnchor: 'PLAN.md#face-controls-and-modals', owner: TILES },
  { id: 'detect-before-confirm', source: 'EncodeImageDialog.fs', states: ['proposal', 'failure'], what: 'Face detection proposes the crop.', disposition: 'deliberate difference',
    reason: 'On-device detection replaces the server call (POST with tryalign); the guidance copy stays.', planAnchor: 'PLAN.md#crop-fidelity-and-export-flow-clarification', owner: ENCODE },
  { id: 'confirm-before-encode', source: 'crop image.png', states: ['proposal'], what: 'Proposal, then ADJUST CROP or OK; encoding starts only after OK.', disposition: 'deliberate difference',
    reason: 'The old dialog encoded first and showed the result; the locked confirmation comes before encoding.', planAnchor: 'PLAN.md#crop-fidelity-and-export-flow-clarification', owner: ENCODE },
  { id: 'adjust-crop', source: 'crop image.png', states: ['proposal'], what: 'ADJUST CROP opens the editor on the proposed crop.', disposition: 'reproduce', owner: EDITOR },
  { id: 'drag-stencil', source: 'crop 2.png', states: ['editor'], what: 'Drag the square stencil over the photo.', disposition: 'reproduce', owner: EDITOR },
  ...(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((at): LegacyInteraction => ({
    id: `resize-${at}`, source: 'crop 2.png', states: ['editor'], what: `Resize the square stencil from the ${at} handle (aspect fixed at 1).`, disposition: 'reproduce', owner: EDITOR,
  })),
  { id: 'rotate-90', source: 'EncodeImageDialog.fs', states: ['editor'], what: 'Rotate the photo 90 degrees per press of the crop-rotate button.', disposition: 'reproduce', owner: EDITOR },
  { id: 'fine-rotate', source: 'EncodeImageDialog.fs', states: ['editor'], what: 'Fine-rotate with the slider from -45 to 45 degrees.', disposition: 'reproduce', owner: EDITOR },
  { id: 'readout-update', source: 'EncodeImageDialog.fs', states: ['editor'], what: 'The degree readout follows the slider live.', disposition: 'reproduce', owner: EDITOR },
  { id: 'cancel', source: 'EncodeImageDialog.fs', states: ['proposal', 'editor', 'failure'], what: 'CANCEL leaves the editor (back to the proposal) or closes the dialog without encoding.',
    disposition: 'reproduce', owner: ENCODE },
  { id: 'ok-or-use-crop', source: 'EncodeImageDialog.fs', states: ['proposal', 'editor', 'failure'], what: 'OK confirms the proposal; USE CROP confirms the edited crop, which goes straight to e4e.',
    disposition: 'deliberate difference', reason: 'A confirmed crop is encoded without re-detection (the candidate re-detects and loops).', planAnchor: 'PLAN.md#confirmed-crop-encoding', owner: CROP_FIX },
  { id: 'crop-from-failure', source: 'failed to align.png', states: ['failure'], what: 'The red button on the failure screen opens the editor on the whole photo.', disposition: 'reproduce', owner: EDITOR },
];

/** Open operator question (PLAN.md "Remaining choices", item 4): not built until answered; default is candidate behaviour. */
export const OPEN_CROPPER_EXTRAS = {
  question: 'Wheel and pinch zoom, a crop square that may extend past the photo edge, and the pre-upload "look straight forward" tip: include them?',
  default: 'candidate behaviour: none of the three',
  planAnchor: 'PLAN.md#remaining-choices-completion-and-cutover-authority',
} as const;
