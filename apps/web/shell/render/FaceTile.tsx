// The face card is the photo entry (choose, drop, paste); one operation action sits beside the field.
import CloseIcon from '@mui/icons-material/Close';
import PhotoIcon from '@mui/icons-material/Photo';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { DragEvent } from 'react';
import { dragPhoto, openPhotoPicker, photoFiles } from '../../src/Next/photo-selection.mjs';
import { FaceField, pastedPhoto } from './FaceField.tsx';
import { FancyButton } from './FancyButton.tsx';
import type { Face, FaceMode, Input, PublicPreview } from './types.ts';
import { faceInputProblem } from '../../src/controller/derived.ts';
import type { HeldStill } from '../../src/controller/state.ts';
import { ResultActions, useResultFile, type ResultFiles } from './ResultActions.tsx';

export interface FaceTileProps {
  readonly item: Input;
  readonly label: string;
  /** The finished face for this input, if any (matched by the controller as classic does). */
  readonly face?: Face | undefined;
  readonly preview?: PublicPreview | undefined;
  readonly active: boolean;
  readonly queued: boolean;
  readonly preparing: boolean;
  /** Fraction of the active job, 0 when indeterminate. */
  readonly fraction: number;
  /** The active job's status line. */
  readonly status: string;
  readonly stopping?: boolean;
  readonly retry?: boolean;
  readonly photoEncodingAvailable?: boolean;
  readonly onNotice?: (message: string) => void;
  readonly onResultNotice?: (message: string) => void;
  /** Whether Remove is offered: never on the last face, so a morph always has something to morph from. */
  readonly removable: boolean;
  readonly onEdit: (value: string) => void;
  readonly onMode: (mode: FaceMode) => void;
  readonly onBrowse: () => void;
  readonly onPhoto: (files: File[]) => void;
  readonly onRequestCrop?: () => void;
  readonly onResumePhoto?: (() => void) | undefined;
  readonly onPhotos: (files: File[]) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onShare: () => void;
  readonly onSave: () => void;
  readonly resultFiles?: ResultFiles | undefined;
  /** Changes for every registered result, including a same-named replacement photo. */
  readonly resultRevision?: number | undefined;
  /** A still this face holds as media (fm-4f5m): shown and saved as it is, never computed with. */
  readonly held?: HeldStill | undefined;
  /** The explicit Use as photo action on a held still. */
  readonly onUseAsPhoto?: () => void;
  /** Paints raw pixels into the canvas (bridge drawFace). */
  readonly drawFace?: (canvas: HTMLCanvasElement | null, id: string) => void;
  readonly displayMilestone?: (name: 'preview' | 'generated-visible' | 'restored-visible') => void;
}

const state = (item: Input, face: Face | undefined, preview: PublicPreview | undefined) =>
  item.mode === 'photo'
    ? 'photo'
    : item.mode === 'project'
      ? 'project'
      : face
        ? 'filled'
        : preview
          ? 'preview'
          : 'empty';

export function FaceTile(p: FaceTileProps) {
  const { item, label, preview, active, queued, preparing } = p;
  // A shown held still stands in for the face: Save and Share hand over its original bytes.
  const shown = p.held?.url ? p.held : undefined;
  const face: Face | undefined = shown
    ? { id: item.id, raw: false, url: shown.url, label, sourceMode: 'held', sourceFile: shown.file }
    : p.face;
  const canGenerate =
    !face &&
    ((item.mode === 'photo' && !!item.file) ||
      ((item.mode === 'text' || item.mode === 'seed') && !faceInputProblem(item)));
  const working = active || queued || preparing;
  const resultFile = useResultFile(
    face
      ? (shown?.file ??
          `${item.id}:${p.resultRevision}:${face.url}:${face.sourceMode}:${face.label}:${item.value}`)
      : null,
    p.resultFiles,
  );
  const filePending = resultFile.status === 'preparing';
  const fileFailed = resultFile.status === 'failed';
  const action = p.stopping ? 'Cancelling' : working ? 'Cancel' : p.retry ? 'Retry' : 'Generate';
  const drag = (leaving: boolean) => (e: DragEvent<HTMLElement>) => dragPhoto(e, false, leaving);
  const determinate = active && p.fraction > 0;
  const choose = () => openPhotoPicker(item.id);
  const chosen = (files: File[]) => {
    if (files.length > 1) p.onPhotos(files);
    else if (files.length) p.onPhoto(files);
  };
  const entry = p.photoEncodingAvailable === false ? 'Open saved image' : 'Encode image';
  return (
    <section
      className={`next-face box${active ? ' next-face-active' : ''}`}
      data-next-face={item.id}
      data-next-state={state(item, face, preview)}
      onDragOver={drag(false)}
      onDragLeave={drag(true)}
      onDrop={(e) => {
        dragPhoto(e, false, true);
        chosen(photoFiles(e));
      }}
      onPaste={(e) => {
        if (!e.defaultPrevented) pastedPhoto(e, p.onPhoto, p.onNotice);
      }}
    >
      <input
        id={`photo-${item.id}`}
        type="file"
        hidden
        accept="image/*,video/mp4"
        aria-label={entry}
        onChange={(e) => chosen(photoFiles(e))}
      />
      <div className="next-face-image">
        {face && face.raw ? (
          <canvas
            ref={(el) => p.drawFace?.(el, item.id)}
            width={1024}
            height={1024}
            className="next-face-img"
            aria-label={`Generated face from ${label}`}
            role="img"
          />
        ) : shown ? (
          <img
            src={shown.url}
            alt={`Saved image for ${label}`}
            width={1024}
            height={1024}
            className="next-face-img"
            data-next-held={shown.kind}
          />
        ) : face ? (
          <img
            onLoad={() => {
              p.displayMilestone?.(
                item.mode === 'project' ? 'restored-visible' : 'generated-visible',
              );
            }}
            src={face.url}
            alt={`Generated face from ${label}`}
            width={1024}
            height={1024}
            className="next-face-img"
          />
        ) : preview ? (
          <>
            <img
              onLoad={() => p.displayMilestone?.('preview')}
              src={preview.url}
              alt={`Preview of ${label}`}
              width={1024}
              height={1024}
              className="next-face-img"
              data-public-preview="true"
            />
          </>
        ) : (item.mode === 'text' || item.mode === 'seed') && item.value !== '' ? (
          <p className="next-face-hint">
            {faceInputProblem(item) ? '' : 'Press Generate to make this face'}
          </p>
        ) : (
          <button
            type="button"
            className="next-face-empty"
            tabIndex={-1}
            aria-label={entry}
            onClick={choose}
          >
            <PhotoIcon />
            <span>{entry}</span>
          </button>
        )}
        {(active || preparing) && (
          <div
            className="next-face-progress"
            role="progressbar"
            aria-label={`${label} progress`}
            {...(determinate ? { 'aria-valuenow': p.fraction * 100 } : {})}
          >
            <div
              className={`next-face-progress-fill${determinate ? ' next-face-progress-determinate' : ''}`}
              {...(determinate ? { style: { transform: `scaleX(${p.fraction})` } } : {})}
            />
          </div>
        )}
        {/* Remove sits on the image it closes, visible at rest on touch and desktop. */}
        {p.removable && (
          <Tooltip title={`Remove ${label}`}>
            <IconButton
              className="next-face-close"
              aria-label={`Remove ${label}`}
              size="small"
              onClick={p.onRemove}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {(active || queued || preparing) && (
        <div className="next-tile-status" role="status">
          <span>{active ? p.status : preparing ? 'Preparing photo…' : 'Queued'}</span>
        </div>
      )}
      {p.onResumePhoto && (
        <div className="next-tile-status" role="status">
          <span>Encoding needs the photo encoder. Your chosen photo is kept in this tab.</span>
          <Button size="small" disabled={working} onClick={p.onResumePhoto}>
            Resume encoding
          </Button>
        </div>
      )}
      {p.held && (
        <div
          className="next-tile-status next-face-held"
          role="status"
          data-next-held={p.held.kind}
          data-reason-key={p.held.reason.reasonKey}
        >
          <span>
            {p.held.reason.text} <a href={p.held.reason.helpAnchor}>Why?</a>
          </span>
          {p.held.photoAction && p.onUseAsPhoto && (
            <Button color="inherit" variant="text" size="small" onClick={p.onUseAsPhoto}>
              Use as photo
            </Button>
          )}
        </div>
      )}
      <div className="next-input-row">
        <FaceField
          item={item}
          label={label}
          disabled={false}
          onEdit={p.onEdit}
          onMode={p.onMode}
          onBrowse={p.onBrowse}
          onPick={choose}
          {...(p.onRequestCrop ? { onRequestCrop: p.onRequestCrop } : {})}
          canRun={!!canGenerate && !working}
          onRun={p.onRun}
          onPhoto={p.onPhoto}
          {...(p.onNotice ? { onNotice: p.onNotice } : {})}
          {...(p.photoEncodingAvailable !== undefined
            ? { photoEncodingAvailable: p.photoEncodingAvailable }
            : {})}
        />
        {(working || (!face && (canGenerate || item.mode === 'text' || item.mode === 'seed'))) && (
          <FancyButton
            variant="contained"
            size="small"
            className="next-face-generate next-face-operation"
            aria-label={`${action} ${label}`}
            disabled={p.stopping || (!working && !canGenerate)}
            onClick={working ? p.onCancel : p.onRun}
          >
            {action}
          </FancyButton>
        )}
        {!working && (filePending || fileFailed) && (
          <FancyButton
            variant="contained"
            size="small"
            className="next-face-generate next-face-operation next-file-preparation"
            aria-label={`${filePending ? 'Preparing file' : 'Retry file preparation'} ${label}`}
            disabled={filePending}
            onClick={resultFile.retry}
          >
            {filePending ? 'Preparing file…' : 'Retry'}
          </FancyButton>
        )}
      </div>
      {/* A state mirror for tooling that reads the per-face source as a select; never focusable. */}
      <select
        className="next-sr"
        value={item.mode}
        tabIndex={-1}
        disabled
        aria-label="Face source"
        onChange={() => {}}
      >
        {[
          ...(item.mode === 'project' ? [['project', 'Restored face']] : []),
          ['text', 'Name or words'],
          ['seed', 'Seed'],
          ['photo', 'Photo'],
        ].map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      <div className="next-actions next-face-actions">
        {face && p.resultFiles ? (
          <ResultActions
            kind="image"
            state={resultFile}
            files={p.resultFiles}
            onNotice={p.onResultNotice}
          />
        ) : (
          face && (
            <>
              <Button color="inherit" variant="text" onClick={p.onShare}>
                Share image
              </Button>
              <Button color="inherit" variant="text" onClick={p.onSave}>
                Save image
              </Button>
            </>
          )
        )}
      </div>
    </section>
  );
}
