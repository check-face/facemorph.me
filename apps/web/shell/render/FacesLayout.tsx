// The faces area's content (classic Product.fs view, lines 1236-1266). N=2, the common case: classic's grid at
// >= 1000 px and a vertical stack below, with the morph between the two faces and the same insertion connector
// before, between and after the pair at every width (A-1). One face: the lone tile and the reason it has no
// Remove. Three or more (face.many, fm-id4c): one contained strip at every width that scrolls sideways inside
// itself, never the page, with a visible cue (which faces show, Previous/Next, edge fades and a scrollbar); past
// VIRTUALISE_AFTER faces it renders only the tiles near the view. Start over is a visible control at the top of the
// face row (fm-2if3) whenever there is something to clear; the Undo notice for Remove and Start over is a compact
// snackbar row just above the faces, in a live region, covering nothing. Focus moves to a neighbour's Remove after a
// removal.
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { UndoNotice } from '../../src/controller/reducers/undo.ts';
import { Connector, faceLabel, tilesWithConnectors } from './Connectors.tsx';
import { facesMode, visibleRange } from './faces-mode.ts';
import type { Input } from './types.ts';
import './faces-many.css';

export interface FacesLayoutProps {
  readonly inputs: readonly Input[];
  readonly tile: (item: Input, index: number, label: string) => ReactNode;
  readonly morphSlot: ReactNode;
  readonly videoSlot: ReactNode;
  readonly onAddAt: (position: number) => void;
  /** The open Remove/Start over notice, if any. */
  readonly undo?: UndoNotice | undefined;
  readonly onUndo?: () => void;
  /** Start over: two empty faces in one action, undoable (fm-id4c); shown at the top of the face row (fm-2if3). */
  readonly onStartOver?: () => void;
}

const add = (className: string, label: string, onClick: () => void) => (
  <div className={`next-connector ${className}`}>
    <IconButton className="next-connector-add" aria-label={label} onClick={onClick}>
      <AddIcon />
    </IconButton>
  </div>
);

/** Where focus goes once a removal or Undo has re-rendered: a face index and what to focus there. */
interface FocusAfter {
  readonly index: number;
  readonly gone?: string;
  readonly restore?: boolean;
}

function undoText(undo: UndoNotice): string {
  return undo.kind === 'start-over'
    ? `Started over: ${undo.hidden.length} ${undo.hidden.length === 1 ? 'face' : 'faces'} cleared.`
    : `Removed ${faceLabel(undo.index)}.`;
}

function focusFace(root: HTMLElement | null, id: string | undefined): void {
  if (!root || !id) return;
  const tile = root.querySelector<HTMLElement>(`[data-next-face="${CSS.escape(id)}"]`);
  const target =
    tile?.querySelector<HTMLElement>('.next-face-close') ??
    tile?.querySelector<HTMLElement>('.next-field input, input:not([hidden]), button');
  target?.focus({ preventScroll: false });
}

function Strip({
  inputs,
  tile,
  onAddAt,
  virtual,
  keep,
  startOver,
  notice,
}: {
  readonly inputs: readonly Input[];
  readonly tile: FacesLayoutProps['tile'];
  readonly onAddAt: (position: number) => void;
  readonly virtual: boolean;
  readonly keep: number | null;
  readonly startOver: ReactNode;
  readonly notice: ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 0, scroll: 0, pitch: 0 });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const tallest = useRef(0);
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const face = el.querySelector<HTMLElement>(':scope > .next-face');
    const connector = el.querySelector<HTMLElement>(':scope > .next-connector');
    const pitch =
      face && connector
        ? face.getBoundingClientRect().width + connector.getBoundingClientRect().width
        : 0;
    setView((v) =>
      v.left === el.scrollLeft &&
      v.width === el.clientWidth &&
      v.scroll === el.scrollWidth &&
      v.pitch === pitch
        ? v
        : { left: el.scrollLeft, width: el.clientWidth, scroll: el.scrollWidth, pitch },
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = strip.current;
    if (!el) return;
    let frameRequest = 0;
    const onScroll = () => {
      cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // The strip's height only grows while faces update, so the morph controls below it hold still.
    const resize = new ResizeObserver(() => {
      onScroll();
      const height = el.getBoundingClientRect().height;
      if (frame.current && height > tallest.current + 0.5) {
        tallest.current = height;
        frame.current.style.minHeight = `${Math.ceil(height)}px`;
      }
    });
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      resize.disconnect();
      cancelAnimationFrame(frameRequest);
    };
  }, [measure]);
  useLayoutEffect(measure, [inputs.length, measure]);

  const count = inputs.length;
  const pitch = view.pitch;
  const [start, end] =
    virtual && pitch > 0
      ? visibleRange(count, pitch, view.left, view.width, undefined, keep ?? focusIndex)
      : virtual
        ? [0, Math.min(count, 8)]
        : [0, count];
  const children: ReactNode[] = [];
  if (start > 0)
    children.push(
      <div
        key="before"
        className="next-strip-spacer"
        aria-hidden="true"
        style={{ width: `${start * pitch}px` }}
      />,
    );
  for (let index = start; index < end; index++) {
    const item = inputs[index]!;
    children.push(
      <Connector
        key={`add-${item.id}`}
        label={`Add a face before ${faceLabel(index)}`}
        onAdd={() => onAddAt(index)}
      />,
      tile(item, index, faceLabel(index)),
    );
  }
  if (end < count)
    children.push(
      <div
        key="after"
        className="next-strip-spacer"
        aria-hidden="true"
        style={{ width: `${(count - end) * pitch}px` }}
      />,
    );
  children.push(
    <Connector
      key="add-end"
      label={`Add a face after Face ${count}`}
      onAdd={() => onAddAt(count)}
    />,
  );
  const overflowing = view.scroll > view.width + 1;
  const before = view.left > 1;
  const after = view.left + view.width < view.scroll - 1;
  // Faces whose centre is inside the strip's view.
  const first = pitch > 0 ? Math.max(0, Math.round((view.left - pitch / 2) / pitch + 0.5)) : 0;
  const last =
    pitch > 0
      ? Math.min(count, Math.floor((view.left + view.width - pitch / 2) / pitch + 0.5))
      : count;
  const page = (direction: -1 | 1) =>
    strip.current?.scrollBy({
      left: direction * Math.max(pitch, view.width - (pitch > 0 ? 48 : 0)),
      behavior: 'smooth',
    });
  return (
    <div className="next-faces-many" data-next-face-count={count}>
      <div className="next-strip-head">
        {overflowing ? (
          <div className="next-strip-cue" data-next-scroll-cue="true">
            <IconButton
              className="next-strip-arrow"
              aria-label="Previous faces"
              disabled={!before}
              onClick={() => page(-1)}
            >
              <ChevronLeftIcon />
            </IconButton>
            <span aria-live="off">
              {last > first
                ? `${first + 1 === last ? `Face ${last}` : `Faces ${first + 1}–${last}`} of ${count}`
                : `${count} faces`}
              <span className="next-strip-hint">{' · scroll sideways for more'}</span>
            </span>
            <IconButton
              className="next-strip-arrow"
              aria-label="Next faces"
              disabled={!after}
              onClick={() => page(1)}
            >
              <ChevronRightIcon />
            </IconButton>
          </div>
        ) : (
          <span />
        )}
        {startOver}
      </div>
      {notice}
      <div
        ref={frame}
        className="next-strip-frame"
        data-more-before={String(before)}
        data-more-after={String(after)}
      >
        <div
          ref={strip}
          className="next-faces-row next-faces-strip"
          data-next-strip="true"
          data-next-face-count={count}
          data-next-rendered={end - start}
          data-next-virtual={String(virtual)}
          onFocus={(e) => {
            const id = (e.target as HTMLElement)
              .closest('[data-next-face]')
              ?.getAttribute('data-next-face');
            const index = id ? inputs.findIndex((i) => i.id === id) : -1;
            if (index >= 0 && index !== focusIndex) setFocusIndex(index);
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function FacesLayout({
  inputs,
  tile,
  morphSlot,
  videoSlot,
  onAddAt,
  undo,
  onUndo,
  onStartOver,
}: FacesLayoutProps) {
  const root = useRef<HTMLDivElement>(null);
  // Where focus goes after the removal or Undo re-renders (a ref: the effect consumes it), and the tile the
  // virtualised strip must keep rendered meanwhile.
  const pending = useRef<FocusAfter | null>(null);
  const [keep, setKeep] = useState<number | null>(null);
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const { mode, virtual } = facesMode(Math.max(1, inputs.length), width);
  // A press on a face's Remove: remember where it was, so focus lands on a neighbour once it is gone.
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const close = target.closest('.next-face-close');
    const id = close?.closest('[data-next-face]')?.getAttribute('data-next-face');
    if (!close || !id) return;
    const index = inputs.findIndex((i) => i.id === id);
    if (index < 0) return;
    pending.current = { index, gone: id };
    setKeep(index);
  };
  useLayoutEffect(() => {
    const focusAfter = pending.current;
    if (!focusAfter) return;
    if (focusAfter.gone && inputs.some((i) => i.id === focusAfter.gone)) return;
    pending.current = null;
    // Restored by Undo: the face back at its place; removed: the face now there (the next one), else the one before.
    focusFace(root.current, inputs[Math.min(focusAfter.index, inputs.length - 1)]?.id);
  }, [inputs]);

  const notice = (
    <div className="next-undo-notice" role="status" aria-live="polite" data-next-undo-notice="">
      {undo && onUndo ? (
        <>
          <span>{undoText(undo)}</span>
          <Button
            variant="text"
            size="small"
            className="next-undo"
            onClick={() => {
              pending.current = { index: undo.index, restore: true };
              setKeep(undo.index);
              onUndo();
            }}
          >
            Undo
          </Button>
        </>
      ) : null}
    </div>
  );
  // Nothing to clear at two empty faces, so Start over shows only once there is.
  const startOver =
    onStartOver &&
    (inputs.length !== 2 || inputs.some((i) => i.value !== '' || i.file || i.mode !== 'text')) ? (
      <Button
        color="inherit"
        variant="text"
        size="small"
        className="next-start-over"
        startIcon={<RestartAltIcon />}
        onClick={onStartOver}
      >
        Start over
      </Button>
    ) : null;
  const head = startOver ? <div className="next-faces-head">{startOver}</div> : null;
  // Outside the strip the notice exists only while it is open, so two faces render exactly as before (the parity
  // DOM contract); its role=status announces it as it appears.
  const openNotice = undo && onUndo ? notice : null;
  const [first, second] = inputs;
  if (mode === 'pair-grid' || mode === 'pair-stack') {
    if (first && second)
      return (
        <>
          {head}
          {openNotice}
          <div ref={root} className="next-morph-content n2" onClickCapture={onClickCapture}>
            <div className="next-morph-cell next-morph-from">{tile(first, 0, 'Morph from')}</div>
            <div className="next-morph-cell next-morph-morph">{morphSlot}</div>
            <div className="next-morph-cell next-morph-to">{tile(second, 1, 'Morph to')}</div>
            <div className="next-morph-cell next-morph-vid">{videoSlot}</div>
            {add('next-connector-lead', 'Add a face before Morph from', () => onAddAt(0))}
            {add('next-connector-stack', 'Add a face between these two', () => onAddAt(1))}
            {add('next-connector-trail', 'Add a face after Morph to', () => onAddAt(2))}
          </div>
        </>
      );
  }
  if (mode === 'strip')
    return (
      <div ref={root} className="next-morph-content n3 next-many" onClickCapture={onClickCapture}>
        <Strip
          inputs={inputs}
          tile={tile}
          onAddAt={onAddAt}
          virtual={virtual}
          keep={keep}
          startOver={startOver}
          notice={notice}
        />
        {morphSlot}
        {videoSlot}
      </div>
    );
  return (
    <>
      {head}
      {openNotice}
      <div ref={root} className="next-morph-content n3" onClickCapture={onClickCapture}>
        <div className="next-faces-row" data-next-face-count={inputs.length}>
          {tilesWithConnectors(inputs, tile, onAddAt)}
        </div>
        <p className="next-last-face-note" role="note">
          This is your only face, so it has no Remove. Add a face to make a morph.
        </p>
        {morphSlot}
        {videoSlot}
      </div>
    </>
  );
}
