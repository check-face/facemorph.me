// Product.fs modal surfaces. The controller owns selections, jobs and acquisition; these views only dispatch.
import Button from '@mui/material/Button';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CropConfirmation, CropEditor } from './CropEditor.tsx';
import { msg, type Msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import { downloadDecision, type DownloadBundle } from '../../src/controller/download-decision.ts';
import { codecMissingBytes } from '../../src/controller/derived.ts';

export type Dispatch = (message: Msg) => void;
export { downloadMegabytes as megabytes } from '../../src/controller/derived.ts';
import {
  cannotKeepDownload,
  downloadStorageWarning,
  readDownloadStorage,
  type DownloadStorage,
} from '../../src/controller/download-storage.ts';
import { NOTICES_HREF } from './help.ts';

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

export function Modal({
  label,
  className,
  close,
  children,
  faceId,
  backReturnsToDialog = false,
  returnTo,
}: {
  label: string;
  className: string;
  close: () => void;
  children: ReactNode;
  faceId?: string;
  backReturnsToDialog?: boolean;
  /** Where focus returns when the modal closes, when it opens after asynchronous checks may have moved focus.
   * Resolved at close, so it can follow what the answer changed; `|` separates fallbacks, tried in order. */
  returnTo?: string | undefined;
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
    const resolve = () =>
      returnTo
        ?.split('|')
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find(Boolean);
    const previous = faceId
      ? document.querySelector<HTMLElement>(
          `[data-next-face="${CSS.escape(faceId)}"] [aria-label="Change mode"]`,
        )
      : (resolve() ?? document.activeElement);
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
      const back = faceId ? previous : (resolve() ?? previous);
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [faceId, returnTo]);
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
              'a[href], button, input, textarea, select, [tabindex]',
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

/** The legacy names grid's tile floor (facemorph-names ImageGrid: minmax(min(200px, 35vw), 1fr)). */
export const NAME_TILE = 200;
/** Rows rendered above and below the visible ones. Live images stay at (visible rows + 1 + 2 * this) * columns. */
export const NAME_OVERSCAN_ROWS = 2;
const STEPS: Record<string, (columns: number, page: number) => number> = {
  ArrowRight: () => 1,
  ArrowLeft: () => -1,
  ArrowDown: (columns) => columns,
  ArrowUp: (columns) => -columns,
  PageDown: (columns, page) => columns * page,
  PageUp: (columns, page) => -columns * page,
  Home: () => -Infinity,
  End: () => Infinity,
};

/**
 * Fullscreen, headerless, gapless names grid with names over the faces (the legacy picker's look).
 * Only the rows in view (plus a small overscan) are rendered, so scrolling the whole list never
 * accumulates thousands of images; arrow keys move focus across windows. Escape, browser/host
 * Back and, on touch browsers, a small floating Back close it; focus returns to the opener.
 */
export function NamesDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  if (state.Browse === null) return null;
  const close = () => dispatch(msg('CloseNames'));
  return (
    <Modal
      label="Browse names"
      className="next-name-dialog next-names"
      close={close}
      faceId={state.Browse}
    >
      <NamesGrid
        names={state.Names}
        error={state.NamesError}
        choose={(value) => dispatch(msg('ChooseName', value))}
        close={close}
      />
    </Modal>
  );
}

function NamesGrid({
  names,
  error,
  choose,
  close,
}: {
  names: State['Names'];
  error: string | undefined;
  choose: (value: string) => void;
  close: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => ({
    width: document.documentElement.clientWidth,
    height: innerHeight,
    top: 0,
  }));
  const [active, setActive] = useState(0);
  const focusActive = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setView((v) =>
        v.width === element.clientWidth && v.height === element.clientHeight
          ? v
          : { ...v, width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor(view.width / Math.min(NAME_TILE, 0.35 * innerWidth)));
  const tile = view.width / columns;
  const rows = Math.ceil(names.length / columns);
  const visibleRows = Math.max(1, Math.floor(view.height / tile));
  const firstRow = Math.max(0, Math.floor(view.top / tile) - NAME_OVERSCAN_ROWS);
  const lastRow = Math.min(rows, Math.ceil((view.top + view.height) / tile) + NAME_OVERSCAN_ROWS);
  const first = firstRow * columns;
  const shown = names.slice(first, Math.min(names.length, lastRow * columns));
  const tabbable = active >= first && active < first + shown.length ? active : first;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (focusActive.current) {
      element.querySelector<HTMLElement>(`[data-name-index="${active}"]`)?.focus({
        preventScroll: true,
      });
      focusActive.current = false;
    }
    // A focused face scrolled out of the window unmounts; keep focus (and Escape) in the dialog.
    const dialog = element.closest('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) element.focus({ preventScroll: true });
  });
  useEffect(() => {
    // Names that arrive after opening take focus from the empty grid.
    if (names.length && document.activeElement === scroller.current) {
      focusActive.current = true;
      setActive(0);
    }
  }, [names.length]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key];
    const element = scroller.current;
    if (!step || !element || !names.length) return;
    event.preventDefault();
    const focused = Number(
      (document.activeElement as HTMLElement | null)?.dataset['nameIndex'] ?? tabbable,
    );
    const next = Math.max(0, Math.min(names.length - 1, focused + step(columns, visibleRows)));
    const rowTop = Math.floor(next / columns) * tile;
    let top = element.scrollTop;
    if (rowTop < top) top = rowTop;
    else if (rowTop + tile > top + element.clientHeight) top = rowTop + tile - element.clientHeight;
    element.scrollTop = top;
    focusActive.current = true;
    setActive(next);
    setView((v) => ({ ...v, top: element.scrollTop }));
  };
  return (
    <>
      <div
        ref={scroller}
        className="next-names-scroller"
        data-overscan-rows={NAME_OVERSCAN_ROWS}
        tabIndex={-1}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          setView((v) => (v.top === top ? v : { ...v, top }));
        }}
        onKeyDown={move}
      >
        {names.length > 0 ? (
          <div className="next-names-space" style={{ height: rows * tile }}>
            <div
              className="next-name-grid"
              style={{
                top: firstRow * tile,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: `${tile}px`,
              }}
            >
              {shown.map((name, offset) => (
                <button
                  key={name.value}
                  type="button"
                  className="next-name-choice"
                  data-name-index={first + offset}
                  tabIndex={first + offset === tabbable ? 0 : -1}
                  onFocus={() => setActive(first + offset)}
                  onClick={() => choose(name.value)}
                >
                  <img src={name.image} alt="" width={NAME_TILE} height={NAME_TILE} />
                  <span>{name.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="next-names-status" role="alert">
            <p>Names could not be loaded. {error}</p>
            <Button variant="outlined" color="inherit" onClick={close}>
              Close
            </Button>
          </div>
        ) : (
          <p className="next-names-status" role="status">
            Loading names…
          </p>
        )}
      </div>
      <button type="button" className="next-names-back" aria-label="Back" onClick={close}>
        <span aria-hidden="true">‹</span> Back
      </button>
    </>
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
        <CropEditor url={crop.url} view={crop.view} dispatch={dispatch} />
      ) : (
        <CropConfirmation
          url={crop.url}
          view={crop.view}
          detect={crop.detect}
          dispatch={dispatch}
        />
      )}
    </Modal>
  );
}

export function DownloadDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const gate = state.Gate;
  const photo = gate?.[0] === 'photo';
  const [selection, setSelection] = useState<{
    gate: typeof gate;
    bundle: DownloadBundle;
  } | null>(null);
  const bundle = selection?.gate === gate ? selection.bundle : photo ? 'photo' : 'route';
  const decision = downloadDecision({
    downloads: state.Downloads,
    requiredScope: photo ? 'photo' : 'route',
    selectedBundle: bundle,
    photoCount: state.Inputs.filter(
      (input) =>
        input.mode === 'photo' && (gate?.[1].type !== 'RunFace' || input.id === gate[1].args[0]),
    ).length,
    // A morph whose video needs the codec fallback asks for its bytes in the Generate row (fm-9kr8).
    codecMissingBytes: codecMissingBytes(state, gate?.[1]),
  });
  const size = decision.totalBytes ?? 0;
  const known = state.Downloads.known;
  const [storageCheck, setStorageCheck] = useState<{
    gate: typeof gate;
    size: number;
    storage: DownloadStorage | null;
  } | null>(null);
  useEffect(() => {
    if (!gate || !known) return;
    let abandoned = false;
    void readDownloadStorage(navigator.storage).then((storage) => {
      if (!abandoned) setStorageCheck({ gate, size, storage });
    });
    return () => {
      abandoned = true;
    };
  }, [gate, size, known]);
  if (!gate) return null;
  const storage =
    storageCheck?.gate === gate && storageCheck.size === size ? storageCheck.storage : null;
  return (
    <Modal
      label={photo ? 'Download the photo encoder?' : 'Download the face model?'}
      className="next-crop-dialog next-download-dialog"
      close={() => dispatch(msg('GateCancel'))}
      // A Morph or Generate is answered only after its checks (MP4 probe, cache lookup), so focus returns to the
      // control that asked rather than wherever it was when the question opened (fm-9kr8).
      returnTo={
        gate[1].type === 'Run' && gate[1].args[0] === 'morph'
          ? '.next-primary-action'
          : gate[1].type === 'RunFace'
            ? // Declined, the face's Generate (or Retry) that asked; approved, that button is now the face's
              // Cancel, where an Enter would cancel what was just approved, so the face itself. Never its
              // field: focusing it opens a phone's keyboard over the page (release 40680693275).
              `[data-next-face="${CSS.escape(gate[1].args[0])}"] .next-face-generate[aria-label^="Generate "]|` +
              `[data-next-face="${CSS.escape(gate[1].args[0])}"] .next-face-generate[aria-label^="Retry "]|` +
              `section[data-next-face="${CSS.escape(gate[1].args[0])}"]`
            : undefined
      }
    >
      <div className="next-crop-panel box">
        <h2>{photo ? 'Download the photo encoder?' : 'Download the face model?'}</h2>
        <p>
          {photo
            ? 'Photos are turned into faces on this device. Your photo never leaves your device.'
            : 'Faces are made on this device.'}
        </p>
        <fieldset>
          <legend>Choose what to prepare</legend>
          <label>
            <input
              type="radio"
              name="download-bundle"
              checked={bundle === 'photo'}
              disabled={!state.Downloads.photoAvailable}
              onChange={() => setSelection({ gate, bundle: 'photo' })}
            />{' '}
            Generate and encode
          </label>{' '}
          <label>
            <input
              type="radio"
              name="download-bundle"
              checked={bundle === 'route'}
              onChange={() => setSelection({ gate, bundle: 'route' })}
            />{' '}
            Generate
          </label>
        </fieldset>
        {decision.rows.map((row) => (
          <div key={row.purpose} data-download-purpose={row.purpose}>
            <p>{row.text}</p>
            {row.bytes !== null && cannotKeepDownload(storage, row.bytes) && (
              <p className="next-download-storage">{downloadStorageWarning(row.amount!)}</p>
            )}
          </div>
        ))}
        {decision.photoPaused && (
          <p>
            Encoding needs the photo encoder. Your chosen photo stays in this tab until you resume
            or replace it.
          </p>
        )}
        <p>
          {decision.downloadCaveat} {decision.setupCaveat}
        </p>
        <p>
          Model files are saved on this device where storage is available. Your browser may ask
          whether this site can keep them; saying yes helps keep them when space runs low.
        </p>
        <p className="next-download-licences">
          <a href={NOTICES_HREF} target="_blank" rel="noopener">
            Model licences
          </a>
        </p>
        <div className="next-actions">
          <Button onClick={() => dispatch(msg('GateCancel'))}>Cancel</Button>
          <Button
            variant="contained"
            className="next-download-accept"
            onClick={() => dispatch(msg('GateAccept', bundle))}
          >
            Download and continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
