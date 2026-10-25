// One operation action inside each face image; fields preserve exact input identity.
import CloseIcon from '@mui/icons-material/Close';
import PhotoIcon from '@mui/icons-material/Photo';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { DragEvent } from 'react';
import { dragPhoto, photoFiles } from '../../src/Next/photo-selection.mjs';
import { FaceField } from './FaceField.tsx';
import { FancyButton } from './FancyButton.tsx';
import type { Face, FaceMode, Input, PublicPreview } from './types.ts';
import { faceInputProblem } from '../../src/controller/derived.ts';

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
  /** Whether Remove is offered: never on the last face, so a morph always has something to morph from. */
  readonly removable: boolean;
  readonly onEdit: (value: string) => void;
  readonly onMode: (mode: FaceMode) => void;
  readonly onBrowse: () => void;
  readonly onPhoto: (files: File[]) => void;
  readonly onOpenEncode: () => void;
  readonly onRequestCrop?: () => void;
  readonly onPhotos: (files: File[]) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onShare: () => void;
  readonly onSave: () => void;
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
  const { item, label, face, preview, active, queued, preparing } = p;
  const canGenerate =
    !face &&
    ((item.mode === 'photo' && !!item.file) ||
      ((item.mode === 'text' || item.mode === 'seed') && !faceInputProblem(item)));
  const working = active || queued || preparing;
  const action = p.stopping ? 'Cancelling' : working ? 'Cancel' : p.retry ? 'Retry' : 'Generate';
  const drag = (leaving: boolean) => (e: DragEvent<HTMLElement>) => dragPhoto(e, false, leaving);
  const determinate = active && p.fraction > 0;
  return (
    <section
      className={`next-face box${active ? ' next-face-active' : ''}`}
      data-next-face={item.id}
      data-next-state={state(item, face, preview)}
      onDragOver={drag(false)}
      onDragLeave={drag(true)}
      onDrop={(e) => {
        dragPhoto(e, false, true);
        const files = photoFiles(e);
        if (files.length > 1) p.onPhotos(files);
        else p.onPhoto(files);
      }}
    >
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
        ) : item.mode === 'text' || item.mode === 'seed' ? (
          <p className="next-face-hint">
            {faceInputProblem(item) ? '' : 'Press Generate to make this face'}
          </p>
        ) : (
          <button
            type="button"
            className="next-face-empty"
            tabIndex={-1}
            aria-label={p.photoEncodingAvailable === false ? 'Open saved image' : 'Encode image'}
            onClick={p.onOpenEncode}
          >
            <PhotoIcon />
            <span>{p.photoEncodingAvailable === false ? 'Open saved image' : 'Encode image'}</span>
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
        {(working || (!face && (canGenerate || item.mode === 'text' || item.mode === 'seed'))) && (
          <FancyButton
            variant="contained"
            className="next-face-generate next-face-operation"
            aria-label={`${action} ${label}`}
            disabled={p.stopping || (!working && !canGenerate)}
            onClick={working ? p.onCancel : p.onRun}
          >
            {action}
          </FancyButton>
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
      <div className="next-input-row">
        <FaceField
          item={item}
          label={label}
          disabled={false}
          onEdit={p.onEdit}
          onMode={p.onMode}
          onBrowse={p.onBrowse}
          onPick={p.onOpenEncode}
          {...(p.onRequestCrop ? { onRequestCrop: p.onRequestCrop } : {})}
          canRun={!!canGenerate && !working}
          onRun={p.onRun}
          onPhoto={p.onPhoto}
          {...(p.onNotice ? { onNotice: p.onNotice } : {})}
          {...(p.photoEncodingAvailable !== undefined
            ? { photoEncodingAvailable: p.photoEncodingAvailable }
            : {})}
        />
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
        {face && (
          <>
            <Button color="inherit" variant="text" onClick={p.onShare}>
              Share image
            </Button>
            <Button color="inherit" variant="text" onClick={p.onSave}>
              Save image
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
