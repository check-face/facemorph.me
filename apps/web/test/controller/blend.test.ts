// The blend view (face.blend-view, fm-2kse) as pure model, reducers and route: `#blend` routing, first-open seeding,
// copies, weights (1/N, Reset, Make it 1, the sum line, 0.05 steps in 0-1, Shuffle), all-zero refusal, weight-0
// skipping, no slot count limit and session persistence of slots and weights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { msg, type Msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { Effect } from '../../src/controller/effects.ts';
import type { Face, Input, State } from '../../src/controller/state.ts';
import { init } from '../../src/controller/init.ts';
import {
  BLEND_RESULT,
  addSlot,
  blendRefusal,
  emptyBlend,
  makeItOne,
  resetWeights,
  restoreSlots,
  shuffleWeights,
  stepWeight,
  storedSlots,
  sumLine,
  weightSum,
  type BlendSlot,
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
const ids = (n: number) => Array.from({ length: n }, (_, i) => `blend-${i}`);
const step = (s: State, m: Msg, facts = {}) => {
  const t = reduce(m, s, facts);
  assert.ok(t, m.type);
  return t;
};
const open = (s: State) => step(s, msg('BlendView', true), { blendIds: ids(s.Inputs.length + 1) });
const weights = (s: State) => s.Blend!.slots.map((slot) => slot.weight);
const runs = (effects: readonly Effect[]) =>
  effects.filter((e): e is Extract<Effect, { type: 'runBlend' }> => e.type === 'runBlend');
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// ---- seeding and copies ---------------------------------------------------------------------------------------------

test('first open copies every latent-capable morph face as a slot at equal weights, in order', () => {
  const photo = new File([new Uint8Array(4)], 'p.jpg', { type: 'image/jpeg' });
  const s = morph(2, {
    Inputs: [
      { id: 'face-a', mode: 'text', value: 'ada', file: null },
      { id: 'face-b', mode: 'text', value: '', file: null }, // no latent yet and cannot get one
      { id: 'face-c', mode: 'photo', value: 'p.jpg', file: photo },
      { id: 'face-d', mode: 'seed', value: '42', file: null },
      { id: 'face-e', mode: 'project', value: 'Restored face', file: null }, // finished: has a latent
    ],
    Faces: [face('face-a'), face('face-e')],
  });
  const opened = open(s);
  const slots = opened.state.Blend!.slots;
  assert.deepEqual(
    slots.map((slot) => [slot.input.mode, slot.input.value]),
    [
      ['text', 'ada'],
      ['photo', 'p.jpg'],
      ['seed', '42'],
      ['project', 'Restored face'],
    ],
  );
  assert.ok(slots.every((slot) => slot.input.id.startsWith('blend-')));
  for (const w of weights(opened.state)) close(w, 1 / 4);
  // Finished morph faces are copied (latent and pixels) under the slot's own id, never shared.
  assert.deepEqual(
    opened.effects.filter((e) => e.type === 'copyFace'),
    [
      { type: 'copyFace', from: 'face-a', to: slots[0]!.input.id },
      { type: 'copyFace', from: 'face-e', to: slots[3]!.input.id },
    ],
  );
  assert.deepEqual(
    opened.state.Blend!.faces.map((f) => f.id),
    [slots[0]!.input.id, slots[3]!.input.id],
  );
  assert.equal(opened.state.Inputs, s.Inputs, 'the morph faces are untouched');
  // A second open keeps the slots as they are.
  assert.equal(open(opened.state).state.Blend, opened.state.Blend);
});

test('first open from a 150-face morph row seeds 150 slots at 1/150', () => {
  const opened = open(morph(150));
  assert.equal(opened.state.Blend!.slots.length, 150);
  for (const w of weights(opened.state)) close(w, 1 / 150);
  close(weightSum(opened.state.Blend!.slots), 1);
});

test('slots are copies: editing a slot never changes a morph face, or the reverse', () => {
  const s = open(morph(2, { VideoUrl: 'blob:video' })).state;
  const slot = s.Blend!.slots[0]!.input.id;
  const edited = step(s, msg('Edit', slot, 'grace hopper'));
  assert.equal(edited.state.Blend!.slots[0]!.input.value, 'grace hopper');
  assert.deepEqual(edited.state.Inputs, s.Inputs, 'morph faces unchanged');
  assert.equal(edited.state.VideoUrl, 'blob:video', 'the morph video stays');
  assert.ok(
    !edited.effects.some((e) =>
      ['rememberView', 'invalidateMorph', 'invalidateArrivalRestore'].includes(e.type),
    ),
    'no morph session effect from a slot edit',
  );
  assert.deepEqual(
    edited.effects.filter((e) => e.type === 'invalidateFace'),
    [{ type: 'invalidateFace', id: slot }],
  );
  const morphEdit = step(edited.state, msg('Edit', 'face-0', 'changed'));
  assert.equal(morphEdit.state.Inputs[0]!.value, 'changed');
  assert.deepEqual(morphEdit.state.Blend!.slots, edited.state.Blend!.slots, 'slots unchanged');
  // Mode and names reach the slot too, through the same reducers.
  const seeded = step(edited.state, msg('Mode', slot, 'seed'));
  assert.equal(seeded.state.Blend!.slots[0]!.input.mode, 'seed');
  const browsing = step(seeded.state, msg('BrowseNames', slot));
  assert.equal(browsing.state.Browse, slot);
  const chosen = step(browsing.state, msg('ChooseName', 'ada'));
  assert.deepEqual(
    [chosen.state.Blend!.slots[0]!.input.mode, chosen.state.Blend!.slots[0]!.input.value],
    ['text', 'ada'],
  );
  assert.deepEqual(chosen.state.Inputs, s.Inputs);
  // The slot's own Generate is an ordinary face job aimed at the slot.
  const generated = step({ ...chosen.state, PendingJobs: [], Busy: false }, msg('RunFace', slot));
  const execute = generated.effects.find((e) => e.type === 'execute');
  assert.ok(execute && execute.type === 'execute');
  assert.equal(execute.request.target, slot);
  assert.deepEqual(
    execute.request.inputs.map((i) => i.id),
    [slot],
  );
  assert.ok(!generated.effects.some((e) => e.type === 'rememberView'));
  // Its finished face joins the slot, and the morph video stays.
  const done = step(
    { ...generated.state, VideoUrl: 'blob:video' },
    msg('Completed', generated.state.JobId, {
      errorMessage: '',
      faces: [face(slot), face('face-0')],
      videoUrl: '',
      projectJson: '',
      message: 'Face updated.',
      restored: false,
      inputs: [],
      kind: '',
      width: 0,
      pinch: false,
      frames: 16,
      fps: 16,
      photoChoices: null,
      cropFace: null,
      refusal: null,
    }),
  );
  assert.ok(done.state.Blend!.faces.some((f) => f.id === slot));
  assert.equal(done.state.VideoUrl, 'blob:video');
});

// ---- weights --------------------------------------------------------------------------------------------------------

test('a new slot gets 1/N and the other weights are left alone; there is no slot count limit', () => {
  let s = open(morph(3)).state;
  s = step(s, msg('BlendWeight', s.Blend!.slots[0]!.input.id, 0.6)).state;
  const before = weights(s);
  s = step(s, msg('BlendAdd'), { blendIds: ['blend-new'] }).state;
  assert.deepEqual(weights(s).slice(0, 3), before);
  close(weights(s)[3]!, 1 / 4);
  let many: readonly BlendSlot[] = [];
  for (let i = 0; i < 1000; i++) many = addSlot(many, `blend-${i}`);
  assert.equal(many.length, 1000);
  close(many[999]!.weight, 1 / 1000);
  // A thousand weighted word slots still blend: one weighted sum, never a count refusal.
  const words = many.map((slot, i) => ({ ...slot, input: { ...slot.input, value: `w ${i}` } }));
  assert.equal(blendRefusal(words), null);
  const ran = step({ ...base, Blend: { ...emptyBlend(), slots: words } }, msg('BlendRun'));
  assert.equal(runs(ran.effects)[0]!.inputs.length, 1000);
});

test('Reset gives 1/N; Make it 1 scales every weight in proportion', () => {
  const slots = [0.2, 0.4, 0.9, 0].map((weight, i) => ({
    input: { id: `blend-${i}`, mode: 'text' as const, value: `w${i}`, file: null },
    weight,
  }));
  for (const slot of resetWeights(slots)) close(slot.weight, 1 / 4);
  const scaled = makeItOne(slots);
  close(weightSum(scaled), 1);
  for (let i = 0; i < 3; i++) close(scaled[i]!.weight / scaled[0]!.weight, slots[i]!.weight / 0.2);
  assert.equal(scaled[3]!.weight, 0);
  // All-zero weights cannot be scaled: they stay, and the run is refused.
  const zero = slots.map((slot) => ({ ...slot, weight: 0 }));
  assert.deepEqual(makeItOne(zero), zero);
  // Through the reducer.
  const s = { ...base, Blend: { ...emptyBlend(), slots } };
  close(weightSum(step(s, msg('BlendNormalize')).state.Blend!.slots), 1);
  for (const w of weights(step(s, msg('BlendReset')).state)) close(w, 0.25);
});

test('the sum line shows only outside 0.8-1.2', () => {
  const at = (...ws: number[]) =>
    sumLine(
      ws.map((weight, i) => ({
        input: { id: `blend-${i}`, mode: 'text' as const, value: 'x', file: null },
        weight,
      })),
    );
  assert.equal(at(0.5, 0.5), null);
  assert.equal(at(0.4, 0.4), null, '0.8 is inside');
  assert.equal(at(0.6, 0.6), null, '1.2 is inside');
  assert.equal(at(0.35, 0.4), 'Weights add up to 0.75. Faces usually look most natural at 1.');
  assert.equal(at(0.7, 0.65), 'Weights add up to 1.35. Faces usually look most natural at 1.');
  assert.equal(at(1 / 3, 1 / 3, 1 / 3), null, 'thirds round to 1');
});

test('weights step by 0.05 within 0-1; values outside are never exposed', () => {
  assert.equal(stepWeight(0.37), 0.35);
  assert.equal(stepWeight(0.38), 0.4);
  assert.equal(stepWeight(0.1), 0.1, 'old 0.1 values stay reproducible');
  assert.equal(stepWeight(-0.5), 0);
  assert.equal(stepWeight(1.7), 1);
  assert.equal(stepWeight(Number.NaN), 0);
  const s = open(morph(2)).state;
  const id = s.Blend!.slots[0]!.input.id;
  assert.equal(step(s, msg('BlendWeight', id, 2)).state.Blend!.slots[0]!.weight, 1);
  assert.equal(step(s, msg('BlendWeight', id, -2)).state.Blend!.slots[0]!.weight, 0);
});

test('Shuffle weights: random weights within 0-1 that add up to 1', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const n of [1, 2, 3, 8, 16, 40, 100]) {
    for (let k = 0; k < 20; k++) {
      const ws = shuffleWeights(n, random);
      assert.equal(ws.length, n);
      close(
        ws.reduce((a, b) => a + b, 0),
        1,
      );
      assert.ok(ws.every((w) => w >= 0 && w <= 1));
    }
  }
  // One press is one regeneration once a blend has been asked for.
  let s = open(morph(3)).state;
  s = step(s, msg('BlendRun')).state;
  const pressed = step(s, msg('BlendWeights', shuffleWeights(3, random)));
  assert.equal(runs(pressed.effects).length, 1);
  close(weightSum(pressed.state.Blend!.slots), 1);
});

// ---- running ---------------------------------------------------------------------------------------------------------

test('all-zero weights are refused with one plain line; weight-0 slots are skipped', () => {
  let s = open(morph(3)).state;
  const [a, b, c] = s.Blend!.slots.map((slot) => slot.input.id) as [string, string, string];
  s = step(s, msg('BlendWeight', a, 0)).state;
  const ran = step(s, msg('BlendRun'));
  const [run] = runs(ran.effects);
  assert.ok(run);
  assert.deepEqual(
    run.inputs.map((i) => i.id),
    [b, c],
  );
  close(run.weights[0]!, 1 / 3);
  s = step(ran.state, msg('BlendWeight', b, 0)).state;
  const zero = step(s, msg('BlendWeight', c, 0));
  assert.equal(zero.state.Blend!.error, 'Give at least one face a weight other than 0.');
  assert.equal(zero.state.Blend!.running, null);
  assert.equal(runs(zero.effects).length, 0);
  assert.ok(
    zero.effects.some((e) => e.type === 'cancelBlend'),
    'the pending blend is cancelled',
  );
});

test('one regeneration per committed weight; a newer change supersedes; results install by revision', () => {
  let s = open(morph(2)).state;
  const id = s.Blend!.slots[0]!.input.id;
  // Before any blend was asked for, weights only move.
  assert.equal(runs(step(s, msg('BlendWeight', id, 0.3)).effects).length, 0);
  const first = step(s, msg('BlendRun'));
  s = first.state;
  const second = step(s, msg('BlendWeight', id, 0.7));
  assert.equal(runs(second.effects).length, 1);
  const [older, newer] = [runs(first.effects)[0]!.revision, runs(second.effects)[0]!.revision];
  assert.ok(newer > older);
  s = second.state;
  // The superseded blend settles without a result; the newest installs.
  assert.equal(step(s, msg('BlendCompleted', older, face('x'))).state.Blend, s.Blend);
  const done = step(s, msg('BlendCompleted', newer, face('x'))).state;
  assert.equal(done.Blend!.running, null);
  assert.equal(done.Blend!.faces.find((f) => f.id === BLEND_RESULT)?.url, 'blob:x');
  // A failure offers Retry; a refused model file asks through the existing download question.
  const again = step(done, msg('BlendRun'));
  const rev = runs(again.effects)[0]!.revision;
  const failed = step(again.state, msg('BlendFailed', rev, 'Out of memory.')).state;
  assert.deepEqual([failed.Blend!.error, failed.Blend!.retry], ['Out of memory.', true]);
  const again2 = step(failed, msg('BlendRun'));
  const refused = step(
    again2.state,
    msg(
      'BlendFailed',
      runs(again2.effects)[0]!.revision,
      'File x is not covered by an approved download.',
    ),
  ).state;
  assert.deepEqual(refused.Gate, ['route', msg('BlendRun')]);
});

test('a missing generator model opens the existing download question; Accept runs the blend', () => {
  const s = open(
    morph(2, { Downloads: { ...base.Downloads, routeReady: false }, DownloadConsent: new Set() }),
  ).state;
  const asked = step(s, msg('BlendRun'));
  assert.deepEqual(asked.state.Gate, ['route', msg('BlendRun')]);
  assert.equal(runs(asked.effects).length, 0);
  const accepted = step(asked.state, msg('GateAccept', 'route'));
  assert.equal(accepted.state.Gate, null);
  assert.ok(accepted.effects.some((e) => e.type === 'dispatch' && e.message.type === 'BlendRun'));
  assert.equal(runs(step(accepted.state, msg('BlendRun')).effects).length, 1);
});

test('leaving the view cancels a pending blend synthesis only', () => {
  const s = step(open(morph(2)).state, msg('BlendRun')).state;
  const left = step(s, msg('BlendView', false));
  assert.deepEqual(left.effects, [{ type: 'cancelBlend' }]);
  assert.equal(left.state.Blend!.running, null);
  assert.deepEqual(left.state.Blend!.slots, s.Blend!.slots, 'slots kept');
  assert.equal(step(left.state, msg('BlendView', false)).effects.length, 0);
});

// ---- persistence ------------------------------------------------------------------------------------------------------

test('session persistence: slots and weights survive a reload in the same tab; photo pixels do not', () => {
  const photo = new File([new Uint8Array(4)], 'me.jpg', { type: 'image/jpeg' });
  const blend = {
    ...emptyBlend(),
    slots: [
      { input: { id: 'blend-a', mode: 'text' as const, value: 'ada', file: null }, weight: 0.25 },
      { input: { id: 'blend-b', mode: 'seed' as const, value: '42', file: null }, weight: 0.5 },
      { input: { id: 'blend-c', mode: 'photo' as const, value: '', file: photo }, weight: 0.25 },
    ],
  };
  const items = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as unknown as Storage;
  rememberBlend(blend, { sessionStorage });
  assert.ok(!items.get(BLEND_KEY)!.includes('data:'), 'no pixels stored');
  const restored = restoreBlend({ sessionStorage });
  assert.deepEqual(
    restored.map((slot) => [slot.input.id, slot.input.mode, slot.input.value, slot.weight]),
    [
      ['blend-a', 'text', 'ada', 0.25],
      ['blend-b', 'seed', '42', 0.5],
      ['blend-c', 'photo', '', 0.25],
    ],
  );
  assert.equal(restored[2]!.input.file, null);
  // The restored photo slot asks for its photo again before it can blend.
  assert.equal(blendRefusal(restored), 'Face 3: choose its photo again.');
  // init carries the restored slots into the session, and the view keeps them on open.
  const started = init({
    today: '2026-10-28',
    url: 'https://next.facemorph.me/#blend',
    consentAnswered: true,
    sliderPreference: false,
    sliderPosition: 1,
    blend: restored,
  }).state;
  assert.deepEqual(started.Blend!.slots, restored);
  assert.deepEqual(open(started).state.Blend!.slots, restored);
  // Malformed or foreign records read as nothing.
  assert.deepEqual(restoreSlots({ v: 99, slots: [] }), []);
  assert.deepEqual(
    restoreSlots({ v: 1, slots: [{ id: 'face-1', mode: 'text', value: '', weight: 1 }] }),
    [],
  );
  assert.deepEqual(storedSlots(blend).slots[2], {
    id: 'blend-c',
    mode: 'photo',
    value: 'me.jpg',
    weight: 0.25,
  });
  // Absent or throwing storage keeps nothing and never throws.
  const throwing = {
    get sessionStorage(): Storage {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => rememberBlend(blend, throwing));
  assert.deepEqual(restoreBlend(throwing), []);
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
