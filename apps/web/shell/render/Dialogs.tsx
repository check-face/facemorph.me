// Product.fs modal surfaces. The controller owns selections, jobs and acquisition; these views only dispatch.
import Button from '@mui/material/Button';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cropFrame } from '../facade/helpers.ts';
import Logo from '../../src/public/logo.svg?react';
import { msg, type Msg } from '../../src/controller/msg.ts';
import type { CropChoice, State } from '../../src/controller/state.ts';

export type Dispatch = (message: Msg) => void;
export { megabytes } from '../../src/controller/derived.ts';
import { megabytes } from '../../src/controller/derived.ts';

// A programmatic close traverses history asynchronously. A subsequent modal must not treat that traversal
// (including React StrictMode's setup/cleanup probe) as the person pressing Back on the new modal.
let returning: Promise<void> | null = null;
function returnFromDialog(token: string): void {
  if (history.state?.facemorphDialog !== token) return;
  returning = new Promise((resolve) => {
    addEventListener(
      'popstate',
      () => {
        returning = null;
        resolve();
      },
      { once: true },
    );
    history.back();
  });
}

function Modal({
  label,
  className,
  close,
  children,
  faceId,
  backReturnsToDialog = false,
}: {
  label: string;
  className: string;
  close: () => void;
  children: ReactNode;
  faceId?: string;
  backReturnsToDialog?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useEffectEvent(close);
  const popped = useEffectEvent((token: string) => {
    const returns = backReturnsToDialog;
    dismiss();
    // Editor Back restores the proposal in this same modal. Replace the consumed
    // history entry so the next Back still belongs to confirmation, not the page.
    if (returns) history.pushState({ ...history.state, facemorphDialog: token }, '');
  });
  useLayoutEffect(() => {
    const previous = faceId
      ? document.querySelector<HTMLElement>(
          `[data-next-face="${CSS.escape(faceId)}"] [aria-label="Change mode"]`,
        )
      : document.activeElement;
    const inert: { element: HTMLElement; previous: boolean }[] = [];
    let branch: Element | null = root.current;
    while (branch?.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          inert.push({ element: sibling, previous: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const target =
      root.current?.querySelector<HTMLElement>('.next-crop-view') ??
      root.current?.querySelector<HTMLElement>('button, input:not([type="file"])');
    target?.focus();
    return () => {
      for (const item of inert) item.element.inert = item.previous;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [faceId]);
  useEffect(() => {
    const token = crypto.randomUUID();
    let mounted = true;
    let listening = false;
    const back = () => popped(token);
    void (async () => {
      await returning;
      if (!mounted) return;
      history.pushState({ ...history.state, facemorphDialog: token }, '');
      addEventListener('popstate', back);
      listening = true;
    })();
    return () => {
      mounted = false;
      if (listening) {
        removeEventListener('popstate', back);
        returnFromDialog(token);
      }
    };
  }, []);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'Tab') {
          const controls = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button, input, textarea, select, [tabindex]',
            ),
          ].filter(
            (item) =>
              item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0,
          );
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      {children}
    </div>
  );
}

export function NamesDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  if (state.Browse === null) return null;
  const names = state.Names.filter((n) =>
    n.name.toLowerCase().includes(state.NameQuery.toLowerCase()),
  );
  return (
    <Modal
      label="Browse names"
      className="next-name-dialog"
      close={() => dispatch(msg('CloseNames'))}
    >
      <div className="next-name-panel box">
        <div className="next-topline">
          <h2>Browse names</h2>
          <Button onClick={() => dispatch(msg('CloseNames'))}>Close</Button>
        </div>
        <input
          className="next-text-input"
          aria-label="Search names"
          placeholder="Search names"
          value={state.NameQuery}
          onChange={(e) => dispatch(msg('SearchNames', e.target.value))}
        />
        <div className="next-name-grid">
          {names.slice(0, state.NameLimit).map((name) => (
            <Button
              key={name.value}
              className="next-name-choice"
              onClick={() => dispatch(msg('ChooseName', name.value))}
            >
              <img src={name.image} alt="" loading="lazy" width={200} height={200} />
              <span>{name.name}</span>
            </Button>
          ))}
        </div>
        {state.Names.length === 0 && (
          <p role="status">
            {state.Error
              ? 'Names could not be loaded. Close this window and try again.'
              : 'Loading names…'}
          </p>
        )}
        {state.Names.length > 0 && names.length === 0 && (
          <p role="status">No names match your search.</p>
        )}
        <Button onClick={() => dispatch(msg('MoreNames'))}>Show more</Button>
      </div>
    </Modal>
  );
}

export function DetectedDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const choice = state.PhotoChoice;
  if (!choice) return null;
  return (
    <Modal
      label="Which face?"
      className="next-crop-dialog next-name-dialog"
      close={() => dispatch(msg('DismissDetected'))}
    >
      <div className="next-face-picker">
        <h2>Which face?</h2>
        <p>More than one face here. Tap the one you mean.</p>
        <div className="next-face-picker-image">
          <img src={choice.url} alt="Select a face from your photo" />
          {choice.boxes.map((box, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Choose face ${i + 1}`}
              onClick={() => dispatch(msg('ChooseDetected', i))}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          ))}
        </div>
        <Button onClick={() => dispatch(msg('DismissDetected'))}>Cancel</Button>
      </div>
    </Modal>
  );
}

function CropEditor({ crop, dispatch }: { crop: CropChoice; dispatch: Dispatch }) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.focus();
    const measure = () => dispatch(msg('CropViewport', element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dispatch]);
  const placed = cropFrame(crop.view, crop.view.viewport);
  return (
    <div className="next-crop-panel box">
      <div className="next-topline">
        <h2>Crop your image</h2>
        <Button onClick={() => dispatch(msg('CropCancel'))}>CANCEL</Button>
      </div>
      <p>
        Drag to move, or use the arrow keys. Zoom to fill the square. Only this square is processed.
      </p>
      <div
        ref={area}
        className="next-crop-view"
        aria-label="Crop area"
        role="application"
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 320 : 40;
          const pan: Record<string, readonly [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          const delta = pan[e.key];
          if (delta) {
            e.preventDefault();
            dispatch(msg('CropPan', ...delta));
          } else if (['+', '=', '-', '_'].includes(e.key)) {
            e.preventDefault();
            dispatch(msg('CropZoom', crop.view.zoom + (['+', '='].includes(e.key) ? 0.25 : -0.25)));
          }
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const from = drag.current;
          if (from) {
            drag.current = { x: e.clientX, y: e.clientY };
            dispatch(msg('CropPan', e.clientX - from.x, e.clientY - from.y));
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <img
          src={crop.url}
          alt="Photo being cropped"
          className="next-crop-image"
          draggable={false}
          style={{
            width: placed.width,
            height: placed.height,
            left: placed.x,
            top: placed.y,
            transformOrigin: `${placed.originX}px ${placed.originY}px`,
            transform: `rotate(${placed.rotation}deg)`,
          }}
        />
      </div>
      <label className="next-crop-zoom">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.1}
          aria-label="Zoom"
          value={crop.view.zoom}
          onChange={(e) => dispatch(msg('CropZoom', Number(e.target.value)))}
        />
      </label>
      <div className="next-actions">
        <Button onClick={() => dispatch(msg('CropRotate'))}>Rotate</Button>
        <Button variant="contained" onClick={() => dispatch(msg('CropUse'))}>
          Use Crop
        </Button>
      </div>
    </div>
  );
}

export function CropDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const crop = state.Crop;
  // Fresh photos arrive from the face card; this modal only confirms or adjusts their crop.
  // A consent replaces this modal. There is only one focus trap and one history owner.
  if (!crop || state.Gate) return null;
  const close = () => dispatch(msg('CropCancel'));
  return (
    <Modal
      label="Encode an image"
      className="next-crop-dialog next-encode-dialog"
      faceId={crop.faceId}
      backReturnsToDialog={!!crop.previousView}
      close={close}
    >
      {crop.previousView ? (
        <CropEditor crop={crop} dispatch={dispatch} />
      ) : (
        <div className="next-encode-panel next-encode-confirmation">
          <header className="next-encode-header">
            <h2>Encode an image</h2>
            <Logo aria-label="FaceMorph logo" />
          </header>
          <CropPreview crop={crop} />
          <Button className="next-encode-adjust" onClick={() => dispatch(msg('CropAdjust'))}>
            ADJUST CROP
          </Button>
          <p className="next-encode-explanation">
            Encoding recreates the face; details may change.
          </p>
          <footer className="next-encode-footer">
            <Button className="next-encode-cancel" onClick={close}>
              CANCEL
            </Button>
            <Button
              className="next-encode-ok"
              variant="contained"
              onClick={() => dispatch(msg('CropAccept'))}
            >
              OK
            </Button>
          </footer>
        </div>
      )}
    </Modal>
  );
}

function CropPreview({ crop }: { crop: CropChoice }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const placed = cropFrame(crop.view, width);
  return (
    <div ref={ref} className="next-encode-preview" aria-label="Confirmed crop preview">
      <img
        src={crop.url}
        alt="Proposed face crop"
        draggable={false}
        style={{
          width: placed.width,
          height: placed.height,
          left: placed.x,
          top: placed.y,
          transformOrigin: `${placed.originX}px ${placed.originY}px`,
          transform: `rotate(${placed.rotation}deg)`,
        }}
      />
    </div>
  );
}

export function DownloadDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  if (!state.Gate) return null;
  const photo = state.Gate[0] === 'photo';
  const size = photo
    ? state.Downloads.photoBytes + (state.Downloads.routeReady ? 0 : state.Downloads.routeBytes)
    : state.Downloads.routeBytes;
  return (
    <Modal
      label={photo ? 'Download the photo encoder?' : 'Download the face model?'}
      className="next-crop-dialog next-download-dialog"
      close={() => dispatch(msg('GateCancel'))}
    >
      <div className="next-crop-panel box">
        <h2>{photo ? 'Download the photo encoder?' : 'Download the face model?'}</h2>
        <p>
          {photo
            ? `Photos are turned into faces on this device, so it needs the photo encoder once: ${megabytes(size)}. Your photo never leaves your device.`
            : `Faces are made on this device, so it needs the face model once: ${megabytes(size)}.`}
        </p>
        <p>
          It’s saved for next time. Your browser may ask whether this site can keep it; saying yes
          stops it being cleared when space runs low.
        </p>
        <div className="next-actions">
          <Button onClick={() => dispatch(msg('GateCancel'))}>Cancel</Button>
          <Button
            variant="contained"
            className="next-download-accept"
            onClick={() => dispatch(msg('GateAccept'))}
          >
            Download and continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
