// Controller/runner accounting evidence only: no decoding, inference or phone performance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { createPhotoTasks } from '../../src/controller/photo-tasks.ts';
import { createController, classificationFailure } from '../../src/controller/runner.ts';
import { admitTo, retainedPhotoBytes } from '../../src/controller/admission.ts';
import { createStore } from '../../src/controller/store.ts';
import { msg } from '../../src/controller/msg.ts';
import { photo, dequeue } from '../../src/controller/reducers/photo.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { Effect } from '../../src/controller/effects.ts';
import type { ClassifiedStill } from '../../src/controller/msg.ts';
import { state, offer } from './photo-inputs.ts';

const MB = 2 ** 20;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const sized = (size: number): File =>
  Object.defineProperty(new File([], 'photo.jpg'), 'size', { value: size });

test('photo tasks reserve before invocation and release after fulfillment/rejection dispatch, including sync throws', async () => {
  const tasks = createPhotoTasks(),
    a = sized(80 * MB),
    b = sized(60 * MB);
  const wait = deferred<number>();
  const running = tasks.run(
    [a],
    () => {
      assert.deepEqual(tasks.files(), [a]);
      assert.equal(admitTo(state, { files: [b] }, { pendingPhotoFiles: tasks.files() }).ok, false);
      return wait.promise;
    },
    () => {
      assert.deepEqual(tasks.files(), [a]);
    },
    () => {
      assert.fail('unexpected rejection');
    },
  );
  assert.deepEqual(tasks.files(), [a]);
  wait.resolve(1);
  await running;
  assert.deepEqual(tasks.files(), []);
  const failure = new Error('read failed');
  await tasks.run(
    [a],
    () => {
      throw failure;
    },
    () => assert.fail(),
    (error) => {
      assert.equal(error, failure);
      assert.deepEqual(tasks.files(), [a], 'failure dispatch still owns its input');
    },
  );
  assert.deepEqual(tasks.files(), []);
  await assert.rejects(
    tasks.run(
      [a],
      async () => 1,
      () => {
        throw failure;
      },
      () => {},
    ),
    failure,
  );
  assert.deepEqual(tasks.files(), [], 'even a callback failure releases only its task');
});

test('classify→select→preview→crop handovers retain one shared Blob without admission gaps or double charging', async () => {
  const tasks = createPhotoTasks(),
    file = sized(80 * MB);
  const files = [file, file];
  let current = photo(msg('PickPhoto', 'face-1', files), state)!.state;
  const stages: string[] = [];
  let nextTask: Promise<void> | undefined;
  const facts = () => ({ pendingPhotoFiles: tasks.files(), photoRevision: 1 });
  const check = () => {
    assert.equal(
      admitTo(current, { files: [file] }, facts()).ok,
      true,
      'same Blob is admitted once',
    );
    assert.equal(
      admitTo(current, { files: [sized(49 * MB)] }, facts()).ok,
      false,
      'another entry cannot cross the limit',
    );
  };
  const entries: ClassifiedStill[] = files.map((file, index) => ({
    index,
    file,
    bytes: file.size,
    kind: 'missing',
    reason: null,
  }));
  const preview = { ...offer('preview.jpg'), file };
  await tasks.run(
    files,
    async () => {
      stages.push('classify');
      check();
      return entries;
    },
    (entries) => {
      const selected = photo(
        msg('Classified', 'face-1', current.StillSeq!, true, 'face-1', entries),
        current,
        facts(),
      )!;
      current = selected.state;
      assert.equal(selected.effects.at(-1)?.type, 'selectPhoto');
      nextTask = tasks.run(
        files,
        async () => {
          stages.push('select');
          check();
          return { kind: 'photo' as const, file };
        },
        (selection) => {
          const previewed = photo(msg('Photo', 'face-1', selection), current)!;
          current = previewed.state;
          assert.equal(previewed.effects[0]?.type, 'previewPhoto');
          nextTask = tasks.run(
            [file],
            async () => {
              stages.push('preview');
              check();
              return preview;
            },
            (offer) => {
              current = photo(msg('Photo', 'face-1', { kind: 'crop', offer }), current)!.state;
              check();
            },
            () => assert.fail(),
          );
        },
        () => assert.fail(),
      );
    },
    () => assert.fail(),
  );
  await nextTask;
  await turn();
  assert.deepEqual(stages, ['classify', 'select', 'preview']);
  assert.equal(retainedPhotoBytes(current), file.size, 'crop state adopts the file');
  assert.deepEqual(tasks.files(), []);
  const crop = deferred<Blob>();
  const running = tasks.run(
    [file],
    () => {
      stages.push('crop');
      current = { ...current, Crop: null };
      check();
      return crop.promise;
    },
    (result) => {
      current = {
        ...current,
        Inputs: [{ ...current.Inputs[0]!, file: result }, current.Inputs[1]!],
      };
      check();
    },
    () => assert.fail(),
  );
  crop.resolve(file);
  await running;
  assert.equal(retainedPhotoBytes(current), file.size);
  assert.deepEqual(tasks.files(), []);
});

test('removed and superseded task files remain charged independently until each settles', async () => {
  const tasks = createPhotoTasks(),
    first = sized(80 * MB),
    second = sized(48 * MB);
  const old = deferred<void>(),
    latest = deferred<void>();
  const one = tasks.run(
    [first],
    () => old.promise,
    () => {},
    () => {},
  );
  const two = tasks.run(
    [second],
    () => latest.promise,
    () => {},
    () => {},
  );
  // Removing their face or invalidating its token cannot settle the promises or free their inputs.
  const removed = reduce(msg('Remove', 'face-1'), state)!.state;
  assert.equal(removed.Undo?.hidden[0]?.input.id, 'face-1');
  assert.equal(
    admitTo(
      removed,
      { files: [sized(1)], replacing: 'face-1' },
      { pendingPhotoFiles: tasks.files() },
    ).ok,
    false,
  );
  latest.resolve();
  await two;
  assert.deepEqual(tasks.files(), [first], 'latest settlement does not release superseded work');
  assert.equal(
    admitTo(removed, { files: [sized(48 * MB)] }, { pendingPhotoFiles: tasks.files() }).ok,
    true,
  );
  old.reject(new Error('old task stopped'));
  await one;
  assert.deepEqual(tasks.files(), []);
});

test('dequeued selection and detected-face choice keep their source charged after state hands it off', async () => {
  const file = sized(80 * MB);
  const queued = dequeue({ ...state, PhotoQueue: [['face-1', file]] });
  const chosen = photo(
    msg('ChooseDetected', 0),
    {
      ...state,
      PhotoChoice: {
        id: 'face-1',
        file,
        boxes: [],
        url: '',
        previewWidth: 1,
        previewHeight: 1,
        scale: 1,
      },
    },
    { photoRevision: 1 },
  )!;
  assert.equal(queued.state.PhotoQueue.length, 0);
  assert.equal(chosen.state.PhotoChoice, null);
  for (const transition of [queued, chosen]) {
    const effect = transition.effects.find(
      (effect) => effect.type === 'selectPhoto' || effect.type === 'chooseDetectedFace',
    );
    assert.ok(effect && (effect.type === 'selectPhoto' || effect.type === 'chooseDetectedFace'));
    const files = effect.type === 'selectPhoto' ? effect.files : [effect.choice.file];
    const tasks = createPhotoTasks(),
      wait = deferred<void>();
    const running = tasks.run(
      files,
      () => wait.promise,
      () => {},
      () => {},
    );
    assert.equal(retainedPhotoBytes(transition.state), 0);
    assert.equal(
      admitTo(transition.state, { files: [sized(49 * MB)] }, { pendingPhotoFiles: tasks.files() })
        .ok,
      false,
    );
    wait.reject(new Error('selection stopped'));
    await running;
    assert.equal(
      admitTo(transition.state, { files: [sized(49 * MB)] }, { pendingPhotoFiles: tasks.files() })
        .ok,
      true,
    );
  }
});

test('token-scoped classifier failure removes its check before dispatch and ignores stale errors', () => {
  const effect: Extract<Effect, { type: 'classifyStills' }> = {
    type: 'classifyStills',
    key: 'face-1',
    token: 1,
    pick: true,
    target: 'face-1',
    files: [],
  };
  const store = createStore(
    { ...state, StillChecks: new Map([['face-1', 2]]), PreparingFaces: new Set(['face-1']) },
    {
      runEffects(effects) {
        for (const effect of effects)
          if (effect.type === 'dispatch') store.dispatch(effect.message);
      },
    },
  );
  store.update((current) => classificationFailure(current, effect, new Error('stale')));
  assert.equal(store.getState().StillChecks?.get('face-1'), 2);
  assert.equal(store.getState().PreparingFaces.has('face-1'), true);
  store.update((current) =>
    classificationFailure(current, { ...effect, token: 2 }, new Error('latest')),
  );
  assert.equal(store.getState().StillChecks?.has('face-1'), false);
  assert.equal(store.getState().PreparingFaces.has('face-1'), false);
  assert.equal(store.getState().Error, 'latest');
  const removed = reduce(msg('Remove', 'face-1'), {
    ...state,
    StillChecks: new Map([['face-1', 1]]),
  })!.state;
  const stopped = classificationFailure(removed, effect, new Error('removed read failed'));
  assert.equal(stopped.state.StillChecks?.has('face-1'), false);
  assert.equal(stopped.state.Error, removed.Error);
  assert.deepEqual(stopped.effects, [], 'a removed target cannot surface an obsolete read failure');
});

test('actual runner refuses overlapping 80 MB picks before reading the second file; failure frees admission', async (t) => {
  // The retained bridge only needs these browser event surfaces for subscriptions. No bridge methods are replaced.
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const oldFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://next.facemorph.me/'),
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: () => 0,
  });
  t.after(() => {
    for (const [key, descriptor] of [
      ['window', oldWindow],
      ['location', oldLocation],
      ['requestAnimationFrame', oldFrame],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const controller = createController(
    {
      today: 'today',
      url: 'https://next.facemorph.me/',
      consentAnswered: true,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: { runtimeSha256: 'a'.repeat(64), modelSha256: 'b'.repeat(64) } },
  );
  const old = deferred<ArrayBuffer>(),
    next = deferred<ArrayBuffer>();
  let reads = 0;
  // These are actual 20 MB files; their reader is deferred to inspect the live asynchronous boundary.
  const payload = new Blob([new Uint8Array(20 * MB)]);
  const files = (read: () => Promise<ArrayBuffer>, bytes = 20 * MB) =>
    Array.from({ length: 4 }, () =>
      Object.defineProperty(new File([payload.slice(0, bytes)], 'photo.jpg'), 'arrayBuffer', {
        value: read,
      }),
    );
  const first = files(() => {
    reads++;
    return old.promise;
  });
  const second = files(() => {
    reads++;
    return next.promise;
  });
  controller.store.dispatch(msg('PickPhoto', 'face-1', first));
  assert.equal(reads, 1);
  controller.store.dispatch(msg('PickPhoto', 'face-2', second));
  assert.equal(reads, 1, 'refusal occurs before classification reads or bridge selection');
  assert.match(controller.store.getState().Status, /at most 128 MB/);
  old.reject(new Error('file read failed'));
  await turn();
  assert.equal(controller.store.getState().StillChecks?.has('face-1'), false);
  controller.store.dispatch(msg('PickPhoto', 'face-2', second));
  assert.equal(reads, 2, 'settled failure releases its reservation for retry');
  next.reject(new Error('retry read failed'));
  await turn();
  const stale = deferred<ArrayBuffer>(),
    latest = deferred<ArrayBuffer>();
  controller.store.dispatch(
    msg(
      'PickPhoto',
      'face-1',
      files(() => {
        reads++;
        return stale.promise;
      }, 10 * MB),
    ),
  );
  controller.store.dispatch(
    msg(
      'PickPhoto',
      'face-1',
      files(() => {
        reads++;
        return latest.promise;
      }, 10 * MB),
    ),
  );
  const latestToken = controller.store.getState().StillChecks?.get('face-1');
  assert.equal(reads, 4);
  controller.store.dispatch(
    msg(
      'PickPhoto',
      'face-2',
      files(() => {
        reads++;
        return Promise.reject(new Error('must not read'));
      }, 15 * MB),
    ),
  );
  assert.equal(reads, 4, 'superseded 40 MB still counts beside latest 40 MB');
  stale.reject(new Error('stale read failed'));
  await turn();
  assert.equal(controller.store.getState().StillChecks?.get('face-1'), latestToken);
  assert.equal(controller.store.getState().PreparingFaces.has('face-1'), true);
  assert.notEqual(controller.store.getState().Error, 'stale read failed');
  latest.reject(new Error('latest read failed'));
  await turn();
  assert.equal(controller.store.getState().StillChecks?.has('face-1'), false);
  assert.equal(controller.store.getState().PreparingFaces.has('face-1'), false);
  await controller.dispose();
});

test('every runner photo stage starts through the reserving thunk boundary', () => {
  const source = readFileSync(new URL('../../src/controller/runner.ts', import.meta.url), 'utf8');
  for (const name of [
    'classifyStills',
    'selectPhoto',
    'previewPhoto',
    'cropPhoto',
    'chooseDetectedFace',
  ])
    assert.match(
      source,
      new RegExp(
        `case '${name}':[\\s\\S]*?photoTask\\([\\s\\S]*?\\(\\) => (?:facade\\.)?${name === 'classifyStills' ? 'classify' : name}\\(`,
      ),
    );
});
