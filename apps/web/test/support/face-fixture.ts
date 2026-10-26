// Faces set up by controller fixture (face.many, fm-id4c): the mounted Product's store is read off the React root
// (a devtools hook installed before the bundle, like parity/elmish-probe.ts) and messages are dispatched to it.
// Setup only: every graded press goes through support/operate.ts at the control's visible position.
import type { Page } from 'playwright';

/** Installed with addInitScript: keeps the mounted controller store as window.__fmStore. */
export const STORE_HOOK = `(() => {
  const find = (fiber) => {
    for (let f = fiber, depth = 0; f && depth < 40; f = f.child, depth++) {
      const p = f.memoizedProps;
      if (p && typeof p.store?.dispatch === 'function' && typeof p.store?.getState === 'function') return p.store;
    }
    return null;
  };
  const previous = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous ?? {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject(renderer) { this.renderers.set(1, renderer); return 1; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  };
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const chained = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (id, root, ...rest) {
    if (!window.__fmStore) { const s = find(root.current); if (s) window.__fmStore = s; }
    return chained?.call(this, id, root, ...rest);
  };
  window.__FACEMORPH_FACE_TRACE__ = [];
})();`;

export interface FixtureFace {
  readonly id: string;
  readonly mode: string;
  readonly value: string;
}

/** The controller's faces, in order. */
export const faceList = (page: Page): Promise<FixtureFace[]> =>
  page.evaluate(() =>
    (
      window as unknown as {
        __fmStore: { getState(): { Inputs: { id: string; mode: string; value: string }[] } };
      }
    ).__fmStore
      .getState()
      .Inputs.map(({ id, mode, value }) => ({ id, mode, value })),
  );

/**
 * Exactly `count` faces with distinct words (`words-<n>`), any open Undo notice ended. Setup, not graded.
 * Seeds are used for every third face so content identity covers both kinds.
 */
export async function setFaces(page: Page, count: number): Promise<FixtureFace[]> {
  await page.waitForFunction(() => !!(window as unknown as { __fmStore?: unknown }).__fmStore);
  await page.evaluate((n) => {
    type S = {
      Inputs: { id: string; mode: string; value: string }[];
      Undo?: { seq: number };
    };
    const store = (
      window as unknown as {
        __fmStore: { getState(): S; dispatch(m: { type: string; args: unknown[] }): void };
      }
    ).__fmStore;
    const send = (type: string, ...args: unknown[]) => store.dispatch({ type, args });
    const end = () => {
      const seq = store.getState().Undo?.seq;
      if (seq !== undefined) send('UndoExpired', seq);
    };
    end();
    while (store.getState().Inputs.length < n) {
      const before = store.getState().Inputs.length;
      send('AddAt', before);
      if (store.getState().Inputs.length === before)
        throw new Error('AddAt was refused during setup');
    }
    while (store.getState().Inputs.length > n) {
      send('Remove', store.getState().Inputs.at(-1)!.id);
      end();
    }
    store.getState().Inputs.forEach((input, i) => {
      if (i % 3 === 2) {
        if (input.mode !== 'seed') send('Mode', input.id, 'seed');
        send('Edit', input.id, String(7000 + i));
      } else {
        if (input.mode !== 'text') send('Mode', input.id, 'text');
        send('Edit', input.id, `words-${i + 1}`);
      }
    });
  }, count);
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-next-face]').length > 0 &&
      (
        window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
      ).__fmStore.getState().Inputs.length === n,
    count,
  );
  return faceList(page);
}

/** The face trace (runner): every invalidateFace and slot cancel since the page loaded. */
export const faceTrace = (page: Page): Promise<{ type: string; id: string; at: number }[]> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __FACEMORPH_FACE_TRACE__: { type: string; id: string; at: number }[];
        }
      ).__FACEMORPH_FACE_TRACE__,
  );

/**
 * `count` word faces through the arrival restore (RestoredLast on a fresh page), which is not an admission path:
 * the setup for a page whose admission budget is already over. Setup, not graded.
 */
export async function restoreFaces(page: Page, count: number): Promise<FixtureFace[]> {
  await page.waitForFunction(() => !!(window as unknown as { __fmStore?: unknown }).__fmStore);
  await page.evaluate((n) => {
    type S = { JobId: number; Inputs: { value: string }[]; Kind: string };
    const store = (
      window as unknown as {
        __fmStore: { getState(): S; dispatch(m: { type: string; args: unknown[] }): void };
      }
    ).__fmStore;
    const s = store.getState();
    if (s.JobId !== 0 || s.Inputs[0]?.value !== 'hello')
      throw new Error('restoreFaces needs a fresh page');
    const inputs = Array.from({ length: n }, (_, i) => ({
      id: `face-r${i + 1}`,
      mode: 'text',
      value: `words-${i + 1}`,
      file: null,
    }));
    store.dispatch({
      type: 'RestoredLast',
      args: [
        {
          faces: [],
          videoUrl: '',
          projectJson: '',
          message: '',
          errorMessage: '',
          restored: true,
          inputs,
          kind: s.Kind,
          width: 1,
          pinch: false,
          frames: 16,
          fps: 16,
          photoChoices: null,
        },
      ],
    });
  }, count);
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('section.next-face').length > 0 &&
      (
        window as unknown as { __fmStore: { getState(): { Inputs: unknown[] } } }
      ).__fmStore.getState().Inputs.length === n,
    count,
  );
  return faceList(page);
}
