// The blend view (fm-2kse, fm-56e6) as pure model, reducers and route. Blend and Morph share one list of faces with a
// weight per face (by id; unset = an equal share): a face added, edited or removed in either mode is the same face;
// weights (Reset, Make it 1, the sum line, 0.05 steps in 0-1, Shuffle), the all-zero refusal, weight-0 skipping,
// one regeneration per commit, Add to morph, session persistence and migration of the older separate slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg, type Msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { Effect } from '../../src/controller/effects.ts';
import type { Face, Input, State } from '../../src/controller/state.ts';
import { init } from '../../src/controller/init.ts';
import {
  BLEND_RESULT,
  blendSlots,
  emptyBlend,
  restoreWeights,
  shuffleWeights,
  stepWeight,
  sumLine,
  weightSum,
} from '../../src/controller/blend.ts';
import {
  BLEND_HASH,
  enterBlend,
  inBlend,
  keepViewOnAnchors,
  leaveBlend,
  settleArrival,
  subscribeRoute,
  type RouteWindow,
} from '../../shell/blend-route.ts';
import { BLEND_KEY, rememberBlend, restoreBlend } from '../../shell/session/blend-store.ts';

const base: State = (() => {
  const s = init({
    today: '2026-10-28',
    url: 'https://next.facemorph.me/',
    consentAnswered: true,
    sliderPreference: false,
    sliderPosition: 1,
  }).state;
  return {
    ...s,
    Downloads: { ...s.Downloads, known: true, routeReady: true, photoReady: true },
  };
})();
const face = (id: string): Face => ({
  id,
  raw: false,
  url: `blob:${id}`,
  label: id,
  sourceMode: 'text',
  sourceFile: null,
});
const morph = (count: number, extra: Partial<State> = {}): State => {
  const inputs: Input[] = Array.from({ length: count }, (_, i) => ({
    id: `face-${i}`,
    mode: i % 2 ? 'seed' : 'text',
    value: i % 2 ? String(1000 + i) : `words ${i}`,
    file: null,
  }));
  return { ...base, Inputs: inputs, Faces: [], ...extra };
};
const step = (s: State, m: Msg, facts = {}) => {
  const t = reduce(m, s, facts);
  assert.ok(t, m.type);
  return t;
};
const open = (s: State) => step(s, msg('BlendView', true));
const weights = (s: State) => blendSlots(s.Inputs, s.Blend!.weights).map((slot) => slot.weight);
const runs = (effects: readonly Effect[]) =>
  effects.filter((e): e is Extract<Effect, { type: 'runBlend' }> => e.type === 'runBlend');
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// ---- one shared list of faces ---------------------------------------------------------------------------------------

test('Blend shows the morph faces themselves at equal shares, also for a 150-face row; nothing is copied', () => {
  const row = morph(3);
  const opened = open(row);
  assert.equal(opened.state.Inputs, row.Inputs);
  assert.deepEqual(opened.effects, [], 'no copies');
  for (const w of weights(opened.state)) close(w, 1 / 3);
  for (const w of weights(open(morph(150)).state)) close(w, 1 / 150);
});

test('add, edit, remove with Undo and Start over act on the one list in either mode', () => {
  let s = open(morph(2)).state;
  s = step(s, msg('BlendWeight', 'face-0', 0.7)).state;
  // A face added (as Add face does in either mode) has an equal share; the set weight stays.
  s = step(s, msg('AddAt', s.Inputs.length), { newFaceId: 'face-new' }).state;
  assert.deepEqual(
    s.Inputs.map((i) => i.id),
    ['face-0', 'face-1', 'face-new'],
  );
  close(weights(s)[0]!, 0.7);
  close(weights(s)[2]!, 1 / 3);
  s = step(s, msg('Edit', 'face-new', 'grace hopper')).state;
  assert.equal(s.Inputs[2]!.value, 'grace hopper');
  // Remove has the morph's Undo; Undo brings the face back with its weight.
  const removed = step(s, msg('Remove', 'face-0')).state;
  assert.deepEqual(
    removed.Inputs.map((i) => i.id),
    ['face-1', 'face-new'],
  );
  assert.ok(removed.Undo, 'the same Undo notice');
  const undone = step(removed, msg('Undo')).state;
  assert.deepEqual(
    undone.Inputs.map((i) => i.id),
    ['face-0', 'face-1', 'face-new'],
  );
  close(weights(undone)[0]!, 0.7);
  // Start over clears the one list (two fresh empty faces) for both modes.
  const over = step(undone, msg('StartOver'), { startOverIds: ['face-a', 'face-b'] }).state;
  assert.deepEqual(
    over.Inputs.map((i) => i.id),
    ['face-a', 'face-b'],
  );
  for (const w of weights(over)) close(w, 0.5);
});

// ---- weights --------------------------------------------------------------------------------------------------------

test('Reset gives 1/N; Make it 1 scales every weight in proportion; Shuffle adds up to 1 within 0-1', () => {
  let s = open(morph(3)).state;
  s = step(s, msg('BlendWeight', 'face-0', 1)).state;
  s = step(s, msg('BlendWeight', 'face-1', 0.5)).state;
  // face-2 keeps its equal share (1/3).
  const before = weights(s);
  const made = step(s, msg('BlendNormalize')).state;
  close(weightSum(blendSlots(made.Inputs, made.Blend!.weights)), 1);
  weights(made).forEach((w, i) => close(w, before[i]! / before.reduce((a, b) => a + b, 0)));
  for (const w of weights(step(made, msg('BlendReset')).state)) close(w, 1 / 3);
  for (let k = 0; k < 20; k++) {
    const w = shuffleWeights(5, Math.random);
    close(
      w.reduce((a, b) => a + b, 0),
      1,
    );
    assert.ok(w.every((x) => x >= 0 && x <= 1));
  }
  const shuffled = step(s, msg('BlendWeights', [0.2, 0.3, 0.5])).state;
  assert.deepEqual(weights(shuffled), [0.2, 0.3, 0.5]);
});

test('the sum line shows only outside 0.8-1.2; weights step by 0.05 within 0-1', () => {
  const slots = (ws: number[]) =>
    ws.map((weight, i) => ({ input: morph(ws.length).Inputs[i]!, weight }));
  assert.equal(sumLine(slots([0.5, 0.5])), null);
  assert.equal(sumLine(slots([0.4, 0.4])), null);
  assert.match(
    sumLine(slots([1, 0.35]))!,
    /Weights add up to 1\.35\. Faces usually look most natural at 1\./,
  );
  assert.match(sumLine(slots([0.3, 0.4]))!, /add up to 0\.70/);
  assert.deepEqual(
    [stepWeight(0.33), stepWeight(1.4), stepWeight(-0.2), stepWeight(0.1)],
    [0.35, 1, 0, 0.1],
  );
});

// ---- running ---------------------------------------------------------------------------------------------------------

test('all-zero weights are refused in one line; weight-0 faces are skipped; one run per commit, newest wins', () => {
  let s = open(morph(3)).state;
  s = step(s, msg('BlendWeights', [0, 0, 0])).state;
  const refused = step(s, msg('BlendRun'));
  assert.equal(refused.state.Blend!.error, 'Give at least one face a weight other than 0.');
  assert.equal(runs(refused.effects).length, 0);
  s = step(s, msg('BlendWeights', [0.5, 0, 0.5])).state;
  const first = step(s, msg('BlendRun'));
  assert.deepEqual(
    runs(first.effects)[0]!.inputs.map((i) => i.id),
    ['face-0', 'face-2'],
  );
  const second = step(first.state, msg('BlendWeight', 'face-0', 0.7));
  const [older, newer] = [runs(first.effects)[0]!.revision, runs(second.effects)[0]!.revision];
  assert.ok(newer > older);
  assert.equal(
    step(second.state, msg('BlendCompleted', older, face('x'))).state.Blend,
    second.state.Blend,
  );
  const done = step(second.state, msg('BlendCompleted', newer, face('x'))).state;
  assert.equal(done.Blend!.faces.find((f) => f.id === BLEND_RESULT)?.url, 'blob:x');
  // A face the blend waited for joins the shared list's faces, shown in both modes.
  assert.ok(
    step(done, msg('BlendSlotReady', face('face-0'))).state.Faces.some((f) => f.id === 'face-0'),
  );
  // Leaving the view cancels a pending blend synthesis only.
  const pending = step(done, msg('BlendRun')).state;
  const left = step(pending, msg('BlendView', false));
  assert.deepEqual(left.effects, [{ type: 'cancelBlend' }]);
  assert.equal(left.state.Inputs, pending.Inputs);
});

test('Add to morph puts the shown blend at the end of a long row through the admission check', () => {
  for (const count of [3, 64, 150]) {
    const opened = step(open(morph(count)).state, msg('BlendRun'));
    const revision = runs(opened.effects)[0]!.revision;
    const shown = step(
      opened.state,
      msg('BlendCompleted', revision, { ...face('x'), label: 'Blend of 3 faces' }),
    ).state;
    const added = step(shown, msg('BlendAddToMorph'), { newFaceId: 'face-new' });
    assert.deepEqual(added.state.Inputs.at(-1), {
      id: 'face-new',
      mode: 'project',
      value: 'Blend of 3 faces',
      file: null,
    });
    assert.deepEqual(added.state.Inputs.slice(0, count), shown.Inputs);
    assert.ok(
      added.effects.some(
        (e) => e.type === 'copyFace' && e.from === BLEND_RESULT && e.to === 'face-new',
      ),
    );
    assert.ok(
      !added.effects.some((e) => e.type === 'runBlend' || e.type === 'dispatch'),
      'zero inference',
    );
    assert.equal(added.state.Status, `Blend of 3 faces added to the morph as face ${count + 1}.`);
    const refused = step(shown, msg('BlendAddToMorph'), {
      newFaceId: 'face-new',
      storedSessionBytes: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(refused.state.Inputs, shown.Inputs);
    assert.match(refused.state.Status, /^Not added: a saved session can hold at most/);
  }
});

// ---- persistence ------------------------------------------------------------------------------------------------------

test('weights survive a reload by face id; the older separate slots migrate to the shared list', () => {
  const items = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as unknown as Storage;
  rememberBlend(emptyBlend({ 'face-0': 0.25, 'face-1': 0.5 }), { sessionStorage });
  const restored = restoreBlend({ sessionStorage });
  assert.deepEqual(restored, { 'face-0': 0.25, 'face-1': 0.5 });
  const started = init({
    today: '2026-10-28',
    url: 'https://next.facemorph.me/#blend',
    consentAnswered: true,
    sliderPreference: false,
    sliderPosition: 1,
    blend: restored,
  }).state;
  const s = open({ ...started, Inputs: morph(3).Inputs });
  const w = weights(s.state);
  assert.deepEqual([w[0], w[1]], [0.25, 0.5]);
  close(w[2]!, 1 / 3);
  // Version 1 (separate slots): the slots are dropped, a weight is kept where its id is a face's.
  items.set(
    BLEND_KEY,
    JSON.stringify({
      v: 1,
      slots: [
        { id: 'blend-a', mode: 'text', value: 'ada', weight: 0.4 },
        { id: 'face-1', mode: 'seed', value: '42', weight: 0.6 },
      ],
    }),
  );
  const migrated = restoreBlend({ sessionStorage });
  const faces = blendSlots(morph(2).Inputs, migrated).map((slot) => slot.weight);
  assert.deepEqual(faces, [0.5, 0.6]);
  assert.deepEqual(restoreWeights({ v: 99 }), {});
  const throwing = {
    get sessionStorage(): Storage {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => rememberBlend(emptyBlend(), throwing));
  assert.deepEqual(restoreBlend(throwing), {});
});

// ---- `#blend` routing -------------------------------------------------------------------------------------------------

/** A browser history and its events, enough for the route: push, replace, Back and reload. */
function browser(url: string) {
  const entries: { state: unknown; url: string }[] = [{ state: null, url }];
  let index = 0;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fire = (type: string, event: unknown = { type }) => {
    for (const listener of listeners.get(type) ?? []) listener(event as Event);
  };
  const here = () => new URL(entries[index]!.url);
  const win: RouteWindow = {
    get location() {
      const u = here();
      return { hash: u.hash, pathname: u.pathname, search: u.search };
    },
    history: {
      get state() {
        return entries[index]!.state;
      },
      pushState(state, _unused, next) {
        entries.splice(index + 1);
        entries.push({ state, url: new URL(next ?? here().href, here()).href });
        index++;
      },
      replaceState(state, _unused, next) {
        entries[index] = { state, url: new URL(next ?? here().href, here()).href };
      },
      back() {
        if (index === 0) return;
        const before = here().hash;
        index--;
        fire('popstate');
        if (here().hash !== before) fire('hashchange');
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      fire(event.type, event);
      return true;
    },
    setTimeout(handler) {
      handler();
      return 0;
    },
  };
  return { win, entries: () => entries.map((e) => e.url), index: () => index, fire };
}

test('#blend: the button enters, Back to morph and browser Back leave, reload stays', () => {
  const { win, entries } = browser('https://next.facemorph.me/');
  const seen: boolean[] = [];
  subscribeRoute(win, (open) => seen.push(open));
  settleArrival(win);
  assert.equal(inBlend(win), false);
  enterBlend(win);
  assert.equal(inBlend(win), true);
  assert.deepEqual(entries(), [
    'https://next.facemorph.me/',
    `https://next.facemorph.me/${BLEND_HASH}`,
  ]);
  // Reload in the view: the same entries, still the view.
  settleArrival(win);
  assert.equal(entries().length, 2);
  assert.equal(inBlend(win), true);
  // Browser Back returns to the main page.
  win.history.back();
  assert.equal(inBlend(win), false);
  // Back to morph is the same as Back.
  enterBlend(win);
  leaveBlend(win);
  assert.equal(inBlend(win), false);
  assert.deepEqual(seen.slice(0, 2), [true, false]);
});

test('#blend deep link: the main page goes under the view, so Back returns to it, not off the site', () => {
  const { win, entries, index } = browser('https://next.facemorph.me/?x=1#blend');
  settleArrival(win);
  assert.equal(inBlend(win), true);
  assert.deepEqual(entries(), [
    'https://next.facemorph.me/?x=1',
    'https://next.facemorph.me/?x=1#blend',
  ]);
  assert.equal(index(), 1);
  win.history.back();
  assert.equal(inBlend(win), false);
  assert.equal(entries().length, 2);
  // A plain hash with no faces or results in it.
  assert.ok(entries().every((url) => !/face|seed|result/.test(new URL(url).hash)));
});

test('Help and footer anchors scroll without changing the hash; Back closes an open picker first', () => {
  const { win, fire } = browser('https://next.facemorph.me/');
  enterBlend(win);
  const scrolled: string[] = [];
  keepViewOnAnchors(win, (id) => scrolled.push(id));
  const click = (href: string, rewrite?: string) => {
    let prevented = false;
    fire('click', {
      type: 'click',
      preventDefault: () => (prevented = true),
      target: { closest: () => ({ getAttribute: () => href }) },
    });
    // A later handler (the Privacy & reports link's) may write its own hash; the view puts its own back.
    if (rewrite) win.history.replaceState(win.history.state, '', rewrite);
    return prevented;
  };
  assert.equal(click('#debug-reporting'), true);
  assert.equal(click('#help-photos'), true);
  assert.deepEqual(scrolled, ['debug-reporting', 'help-photos']);
  assert.equal(inBlend(win), true);
  // A handler that rewrites the hash synchronously during the click is undone by the deferred restore.
  const { win: other, fire: fireOther } = browser('https://next.facemorph.me/');
  enterBlend(other);
  const queued: (() => void)[] = [];
  const deferred = Object.assign(Object.create(other) as RouteWindow, {
    setTimeout: (h: () => void) => queued.push(h),
  });
  keepViewOnAnchors(deferred, () => {});
  fireOther('click', {
    type: 'click',
    preventDefault: () => {},
    target: { closest: () => ({ getAttribute: () => '#debug-reporting' }) },
  });
  other.history.replaceState(other.history.state, '', '#debug-reporting');
  for (const h of queued) h();
  assert.equal(inBlend(other), true);
  // The names picker's modal pushes its own entry (render/Dialogs.tsx Modal): Back closes only the picker.
  let picker = true;
  win.addEventListener('popstate', () => {
    if ((win.history.state as { facemorphDialog?: string } | null)?.facemorphDialog !== 'p')
      picker = false;
  });
  win.history.pushState({ ...(win.history.state as object), facemorphDialog: 'p' }, '');
  win.history.back();
  assert.equal(picker, false, 'the picker closed');
  assert.equal(inBlend(win), true, 'the view stays');
  // Outside the view anchors behave as before.
  win.history.back();
  assert.equal(inBlend(win), false);
  assert.equal(click('#debug-reporting'), false);
});
