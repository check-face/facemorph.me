// The blend view's deep link (fm-2kse): `#blend` is a plain hash, so it works on static hosting with no server
// routing and survives reload. It carries no faces or results. The main page always sits under the view in
// history, so Back (even after arriving by the deep link) returns to it. Only `#blend` selects a view: while the
// view is open, Help and footer anchors scroll to their target without changing the hash. Dialogs push their own
// history entries (render/Dialogs.tsx), so Back closes an open names picker or crop modal before the view.

export const BLEND_HASH = '#blend';
const MARK = 'facemorphBlend';
const CHANGED = 'facemorph-route';

/** The parts of `window` the route uses; tests pass a fake. */
export interface RouteWindow {
  readonly location: { readonly hash: string; readonly pathname: string; readonly search: string };
  readonly history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url?: string): void;
    replaceState(state: unknown, unused: string, url?: string): void;
    back(): void;
  };
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean): void;
  dispatchEvent(event: Event): boolean;
  setTimeout(handler: () => void, ms: number): unknown;
}

export const inBlend = (win: RouteWindow): boolean => win.location.hash === BLEND_HASH;
const marked = (win: RouteWindow): boolean =>
  !!(win.history.state as Record<string, unknown> | null)?.[MARK];
const state = (win: RouteWindow, extra: Record<string, unknown> = {}) => ({
  ...(win.history.state as Record<string, unknown> | null),
  ...extra,
});
const page = (win: RouteWindow): string => win.location.pathname + win.location.search;
const changed = (win: RouteWindow) => void win.dispatchEvent(new Event(CHANGED));

/**
 * Arrival: a deep link (`/#blend` typed, pasted or followed) gets the main page put under it, so Back leaves the view
 * for the main page instead of leaving the site. A reload in the view keeps the entries it already has.
 */
export function settleArrival(win: RouteWindow): void {
  if (!inBlend(win) || marked(win)) return;
  const { [MARK]: _mark, ...rest } = state(win);
  win.history.replaceState(rest, '', page(win));
  win.history.pushState({ ...rest, [MARK]: true }, '', `${page(win)}${BLEND_HASH}`);
}
/** Blend faces: opens the view as a new history entry. */
export function enterBlend(win: RouteWindow): void {
  if (inBlend(win)) return;
  win.history.pushState(state(win, { [MARK]: true }), '', `${page(win)}${BLEND_HASH}`);
  changed(win);
}
/** Back to morph: the same as browser Back when the view's entry sits over the main page. */
export function leaveBlend(win: RouteWindow): void {
  if (!inBlend(win)) return;
  if (marked(win)) {
    win.history.back();
    return;
  }
  const { [MARK]: _mark, ...rest } = state(win);
  win.history.replaceState(rest, '', page(win));
  changed(win);
}
/** Calls `listener` with whether the view is open whenever the route may have changed. */
export function subscribeRoute(win: RouteWindow, listener: (open: boolean) => void): () => void {
  const notify = () => listener(inBlend(win));
  for (const type of ['hashchange', 'popstate', CHANGED]) win.addEventListener(type, notify);
  return () => {
    for (const type of ['hashchange', 'popstate', CHANGED]) win.removeEventListener(type, notify);
  };
}

/** The anchor a click lands on, if it is a same-page `#…` link (closest() keeps nested elements working). */
interface Clicked {
  readonly defaultPrevented?: boolean;
  preventDefault(): void;
  readonly target: {
    closest?(selector: string): { getAttribute(name: string): string | null } | null;
  } | null;
}
/**
 * While the view is open, a same-page anchor other than `#blend` scrolls to its target and never changes the hash
 * (a handler that rewrites the hash, like the Privacy & reports link's, is put back). Returns the cleanup.
 */
export function keepViewOnAnchors(win: RouteWindow, scrollTo: (id: string) => void): () => void {
  const click = (event: Event) => {
    const e = event as unknown as Clicked;
    if (!inBlend(win)) return;
    const anchor = e.target?.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href === BLEND_HASH) return;
    e.preventDefault();
    const id = decodeURIComponent(href.slice(1));
    if (id) scrollTo(id);
    // Other click handlers may still write their own hash; the view keeps its own.
    win.setTimeout(() => {
      if (!inBlend(win))
        win.history.replaceState(win.history.state, '', `${page(win)}${BLEND_HASH}`);
    }, 0);
  };
  win.addEventListener('click', click, true);
  return () => win.removeEventListener('click', click, true);
}
