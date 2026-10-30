// The crop surfaces (fm-k09b), per the locked crop image.png, crop 2.png and failed to align.png: the confirmation of
// the detector's proposal (or the failed-to-align and did-not-run variants), and the "Crop your image" editor with a
// square stencil moved by drag and resized from eight handles, a face oval with two eye markers, the 90-degree rotate
// button with its degree readout, the fine-rotation slider and the guidance copy. The guides are drawn over the photo
// and never reach the encoder pixels: the reducers turn the stencil into a crop rectangle and angle only.
import Button from '@mui/material/Button';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CROP_HANDLES, cropLayout, cropPreview, type CropHandle } from '../facade/helpers.ts';
import Logo from '../../src/public/logo.svg?react';
import { msg, type Msg } from '../../src/controller/msg.ts';
import type { CropDetect } from '../../src/controller/state.ts';
import type { CropView } from '../../src/controller/msg.ts';
import './crop.css';

type Dispatch = (message: Msg) => void;

export const GUIDANCE_BOLD =
  'Cropping is generally not necessary, as faces are usually auto detected.';
export const GUIDANCE_LINES = [
  'Try to leave a bit above the top of the head and below the chin.',
  'Lining up the eyes is most important.',
] as const;
export const FAILED_LINE = 'Unable to auto align face.';
export const FAILED_GUIDANCE =
  "When the face isn't aligned you may get strange results. Try a different image or manually crop it. Make sure the entire face is in frame and looking towards the camera.";
export const NOT_RUN_LINE = "Face detection didn't run, so check the crop.";
export const FINDING_LINE = 'Finding faces…';

const HANDLE_NAMES: Record<CropHandle, string> = {
  nw: 'top left',
  n: 'top',
  ne: 'top right',
  e: 'right',
  se: 'bottom right',
  s: 'bottom',
  sw: 'bottom left',
  w: 'left',
};

function RotateIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M7 3v11a3 3 0 0 0 3 3h11" />
      <path d="M3 7h11a3 3 0 0 1 3 3v11" />
      <path d="M15.5 3.2a8.5 8.5 0 0 1 5.3 5.3" />
      <path d="M8.5 20.8a8.5 8.5 0 0 1-5.3-5.3" />
    </svg>
  );
}

/** The square the encoder gets, at whatever size its box is. */
export function CropPreview({ url, view, label }: { url: string; view: CropView; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width || 300);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="next-encode-preview" aria-label={label ?? 'Confirmed crop preview'}>
      <img
        src={url}
        alt="Proposed face crop"
        draggable={false}
        style={{
          width: view.previewWidth,
          height: view.previewHeight,
          transformOrigin: '0 0',
          transform: cropPreview(view, width),
        }}
      />
    </div>
  );
}

/** The whole photo, as the failed-to-align screen shows it (and while faces are being found). */
function WholePhoto({ url, view }: { url: string; view: CropView }) {
  return (
    <div className="next-encode-whole" aria-label="Your photo">
      <img
        src={url}
        alt="Your photo"
        draggable={false}
        style={{ aspectRatio: `${view.previewWidth} / ${view.previewHeight}` }}
      />
    </div>
  );
}

/** The "Encode an image" confirmation for one photo, in the state faces-first left it. */
export function CropConfirmation({
  url,
  view,
  detect,
  dispatch,
}: {
  url: string;
  view: CropView;
  detect: CropDetect | undefined;
  dispatch: Dispatch;
}) {
  const close = () => dispatch(msg('CropCancel'));
  const failed = detect === 'none';
  const finding = detect === 'waiting' || detect === 'running';
  return (
    <div
      className="next-encode-panel next-encode-confirmation"
      data-next-crop-state={detect ?? 'one'}
    >
      <header className="next-encode-header">
        <h2>Encode an image</h2>
        <Logo aria-label="FaceMorph logo" />
      </header>
      {failed || finding ? (
        <WholePhoto url={url} view={view} />
      ) : (
        <CropPreview url={url} view={view} />
      )}
      {finding ? (
        <p className="next-encode-finding" role="status">
          {FINDING_LINE}
        </p>
      ) : null}
      <Button
        className={failed ? 'next-encode-adjust next-encode-adjust-failed' : 'next-encode-adjust'}
        variant={failed ? 'contained' : 'text'}
        onClick={() => dispatch(msg('CropAdjust'))}
      >
        ADJUST CROP
      </Button>
      {failed ? (
        <div className="next-encode-failed" role="alert">
          <p className="next-encode-failed-line">{FAILED_LINE}</p>
          <p className="next-encode-failed-guidance">{FAILED_GUIDANCE}</p>
        </div>
      ) : detect === 'not-run' ? (
        <p className="next-encode-not-run" role="status">
          {NOT_RUN_LINE}
        </p>
      ) : null}
      {failed ? null : (
        <p className="next-encode-explanation">Encoding recreates the face; details may change.</p>
      )}
      <footer className="next-encode-footer">
        <Button className="next-encode-cancel" onClick={close}>
          CANCEL
        </Button>
        <Button
          className="next-encode-ok"
          variant="contained"
          disabled={detect === 'running'}
          onClick={() => dispatch(msg('CropAccept'))}
        >
          OK
        </Button>
      </footer>
    </div>
  );
}

/** "Crop your image": the whole photo under a square stencil (locked crop 2.png). */
export function CropEditor({
  url,
  view,
  dispatch,
  faceLabel,
}: {
  url: string;
  view: CropView;
  dispatch: Dispatch;
  /** "Face N of M" when one pick of the Choose faces view is adjusted. */
  faceLabel?: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    handle: CropHandle | null;
    x: number;
    y: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.focus();
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) dispatch(msg('CropViewport', width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dispatch]);
  const layout = cropLayout(view);
  const start = (event: ReactPointerEvent<HTMLElement>, handle: CropHandle | null) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      id: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
    };
    area.current?.setPointerCapture?.(event.pointerId);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };
  const degrees = Math.round(view.rotation);
  return (
    <div className="next-encode-panel next-crop-editor">
      <header className="next-encode-header">
        <h2>Crop your image</h2>
        {faceLabel ? (
          <span className="next-crop-face-label">{faceLabel}</span>
        ) : (
          <Logo aria-label="FaceMorph logo" />
        )}
      </header>
      <div
        ref={area}
        className="next-crop-view"
        aria-label="Crop area"
        aria-roledescription="Crop square: drag to move, drag a handle to resize, arrow keys to move, plus and minus to resize"
        role="application"
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 4;
          const moves: Record<string, readonly [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const delta = moves[e.key];
          if (delta) {
            e.preventDefault();
            dispatch(msg('CropPan', ...delta));
          } else if (['+', '=', '-', '_'].includes(e.key)) {
            e.preventDefault();
            const grow = ['+', '='].includes(e.key) ? step : -step;
            dispatch(msg('CropResize', 'se', grow, grow));
            dispatch(msg('CropPan', -grow / 2, -grow / 2));
          }
        }}
        onPointerMove={(e) => {
          const from = drag.current;
          if (!from || from.id !== e.pointerId) return;
          e.preventDefault();
          const dx = e.clientX - from.x;
          const dy = e.clientY - from.y;
          drag.current = { ...from, x: e.clientX, y: e.clientY };
          dispatch(from.handle ? msg('CropResize', from.handle, dx, dy) : msg('CropPan', dx, dy));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <img
          src={url}
          alt="Photo being cropped"
          className="next-crop-image"
          draggable={false}
          style={{
            width: view.previewWidth,
            height: view.previewHeight,
            transformOrigin: '0 0',
            transform: layout.transform,
          }}
        />
        <div
          className="next-crop-stencil"
          data-next-crop-stencil=""
          style={{
            left: layout.left,
            top: layout.top,
            width: layout.size,
            height: layout.size,
          }}
          onPointerDown={(e) => start(e, null)}
        >
          <span className="next-crop-oval" aria-hidden="true" />
          <span className="next-crop-eye next-crop-eye-left" aria-hidden="true" />
          <span className="next-crop-eye next-crop-eye-right" aria-hidden="true" />
          {CROP_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`next-crop-handle next-crop-handle-${handle}`}
              data-next-crop-handle={handle}
              aria-label={`Resize from the ${HANDLE_NAMES[handle]}`}
              onPointerDown={(e) => start(e, handle)}
            />
          ))}
        </div>
      </div>
      <div className="next-crop-rotate">
        <button
          type="button"
          className="next-crop-rotate-button"
          aria-label="Rotate 90 degrees"
          onClick={() => dispatch(msg('CropRotate'))}
        >
          <RotateIcon />
        </button>
        <span className="next-crop-degrees" aria-live="polite">
          {degrees}°
        </span>
      </div>
      <input
        className="next-crop-fine"
        type="range"
        min={-45}
        max={45}
        step={0.5}
        aria-label="Fine rotation"
        value={view.fine}
        onChange={(e) => dispatch(msg('CropTurn', Number(e.target.value)))}
      />
      <div className="next-crop-copy">
        <p>
          <b>{GUIDANCE_BOLD}</b>
        </p>
        {GUIDANCE_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <footer className="next-encode-footer">
        <Button className="next-encode-cancel" onClick={() => dispatch(msg('CropCancel'))}>
          CANCEL
        </Button>
        <Button
          className="next-encode-ok next-crop-use"
          variant="contained"
          onClick={() => dispatch(msg('CropUse'))}
        >
          USE CROP
        </Button>
      </footer>
    </div>
  );
}
