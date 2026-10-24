// One face tile (classic Product.fs viewFace, lines 866-956): the image slot (generated canvas or image, a cached
// public preview, or an empty photo drop target), the tile progress, the Remove control on the image, the
// status line with Cancel, the field and Generate, the hidden source mirror, the photo row, Hold to compare and
// the finished face's Share/Save actions. The `.next-*` DOM contract is the control's.
// Buttons classic left uncoloured get color="inherit": MUI 4's default Button colour was the text colour, MUI 5+ made it primary.
import CloseIcon from '@mui/icons-material/Close';
import PhotoIcon from '@mui/icons-material/Photo';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { DragEvent } from 'react';
import { dragPhoto, openPhotoPicker, photoFiles } from '../../src/Next/photo-selection.mjs';
import { FaceField } from './FaceField.tsx';
import { FancyButton } from './FancyButton.tsx';
import type { Face, FaceMode, Input, PublicPreview } from './types.ts';

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
  /** Whether Remove is offered: never on the last face, so a morph always has something to morph from. */
  readonly removable: boolean;
  /** The source photo is being compared in place of the generated face. */
  readonly comparing: boolean;
  /** The source photo's URL for Hold to compare ('' when there is none). */
  readonly sourcePhotoUrl: string;
  readonly onEdit: (value: string) => void;
  readonly onMode: (mode: FaceMode) => void;
  readonly onBrowse: () => void;
  readonly onPhoto: (files: File[]) => void;
  readonly onPhotos: (files: File[]) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onRequestCrop: () => void;
  readonly onCompare: (on: boolean) => void;
  readonly onShare: () => void;
  readonly onSave: () => void;
  /** Paints raw pixels into the canvas (bridge drawFace). */
  readonly drawFace?: (canvas: HTMLCanvasElement | null, id: string) => void;
  readonly displayMilestone?: (name: string) => void;
  readonly onWarmPhotoTools?: () => void;
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
    (item.mode === 'project' && !!face) ||
    (item.mode === 'photo' && !!item.file) ||
    ((item.mode === 'text' || item.mode === 'seed') && item.value.trim() !== '');
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
      <input
        id={`photo-${item.id}`}
        type="file"
        hidden
        accept="image/*,video/mp4"
        aria-label="Choose photo"
        onChange={(e) => p.onPhoto(photoFiles(e))}
      />
      <div className="next-face-image">
        {face && face.raw && !p.comparing ? (
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
              if (!p.comparing)
                p.displayMilestone?.(
                  item.mode === 'project' ? 'restored-visible' : 'generated-visible',
                );
            }}
            src={p.comparing ? p.sourcePhotoUrl : face.url}
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
            <span className="next-sr">Cached preview</span>
          </>
        ) : (
          // The empty tile is a photo drop target, never a bare plus: the plus belongs to the connectors.
          <button
            type="button"
            className="next-face-empty"
            tabIndex={-1}
            aria-label="Choose photo"
            onClick={() => {
              p.onWarmPhotoTools?.();
              openPhotoPicker(item.id);
            }}
          >
            <PhotoIcon />
            <span>Drop a photo, or tap to choose</span>
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
        {/* Remove sits on the image it closes, visible at rest on touch and desktop (defect 1's repair is face controls'). */}
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
          <Button color="inherit" size="small" onClick={p.onCancel}>
            Cancel
          </Button>
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
          onPick={() => openPhotoPicker(item.id)}
          {...(p.onWarmPhotoTools ? { onWarmPhotoTools: p.onWarmPhotoTools } : {})}
        />
        <FancyButton
          variant="contained"
          size="small"
          className="next-face-generate"
          aria-label={`Generate ${label}`}
          disabled={!canGenerate || active || preparing || queued}
          onClick={p.onRun}
        >
          Generate
        </FancyButton>
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
      {item.mode === 'photo' && (
        <div className="next-file">
          <span>{item.value}</span>
          <Button
            color="inherit"
            variant="text"
            size="small"
            disabled={active || !item.file}
            onClick={p.onRequestCrop}
          >
            Crop photo
          </Button>
        </div>
      )}
      {face && p.sourcePhotoUrl !== '' && (
        <button
          type="button"
          className="next-compare"
          onPointerDown={() => p.onCompare(true)}
          onPointerUp={() => p.onCompare(false)}
          onPointerLeave={() => p.onCompare(false)}
          onPointerCancel={() => p.onCompare(false)}
          onBlur={() => p.onCompare(false)}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              p.onCompare(true);
            }
          }}
          onKeyUp={() => p.onCompare(false)}
        >
          Hold to compare
        </button>
      )}
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
