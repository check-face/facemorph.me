// Called in the existing real-browser facade harness. No simulated bridge, model or browser API.
import { createController } from '../../src/controller/runner.ts';
import { msg } from '../../src/controller/msg.ts';
import type { Store } from '../../src/controller/store.ts';
import * as facade from '../../shell/facade/bridge.ts';
import { subscribeProgress, subscribeDownloads } from '../../src/controller/subscriptions.ts';
import * as helpers from '../../shell/facade/helpers.ts';
import { requestNext } from '../../src/operations/bridge-service.ts';
import type { Effect } from '../../src/controller/effects.ts';
import { viewSnapshot } from '../../src/controller/effects.ts';
import type { State } from '../../src/controller/state.ts';

// DevTools observes calls to these actual functions. No function is replaced or intercepted.
export function controllerTarget(name: string): unknown {
  return ({ ...facade, ...helpers, requestNext } as Record<string, unknown>)[name];
}
let routing: ReturnType<typeof createController> | undefined;
const probeInput = {
  id: 'routing',
  mode: 'text' as const,
  value: 'controller routing check',
  file: null,
};
async function identity() {
  const bytes = await (await fetch('/runtime/manifest.json')).arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { modelSourceSha256: string };
  const runtimeSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return { runtimeSha256, modelSha256: manifest.modelSourceSha256 };
}
export async function startControllerRouting() {
  routing = createController(
    {
      today: '2026-10-25',
      url: 'https://next.facemorph.me/?testing',
      consentAnswered: true,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
}
export async function controllerRoutingStep(type: Effect['type']) {
  if (!routing) throw new Error('Start the controller routing probe first');
  const store = routing.store;
  const view = { ...viewSnapshot(store.getState()), inputs: [probeInput] };
  const jobId = store.getState().JobId + 1;
  const invalidPhoto = new File(['invalid photo bytes'], 'invalid.jpg', { type: 'image/jpeg' });
  const descriptors: Record<string, Effect> = {
    selectPhoto: { type: 'selectPhoto', id: probeInput.id, files: [invalidPhoto] },
    previewPhoto: { type: 'previewPhoto', id: probeInput.id, file: invalidPhoto },
    cropPhoto: {
      type: 'cropPhoto',
      id: probeInput.id,
      file: invalidPhoto,
      revision: 1,
      area: { left: 0, top: 0, width: 1, height: 1 },
      options: { previewScale: 1, rotation: 0 },
    },
    chooseDetectedFace: {
      type: 'chooseDetectedFace',
      id: probeInput.id,
      revision: 1,
      index: 0,
      choice: {
        id: probeInput.id,
        file: invalidPhoto,
        boxes: [],
        url: '',
        previewWidth: 1,
        previewHeight: 1,
        scale: 1,
      },
    },
    revokeUrl: {
      type: 'revokeUrl',
      url: type === 'revokeUrl' ? URL.createObjectURL(invalidPhoto) : '',
    },
    invalidateFace: { type: 'invalidateFace', id: probeInput.id },
    invalidatePhotoSelections: { type: 'invalidatePhotoSelections', id: probeInput.id },
    publicPreview: { type: 'publicPreview', id: probeInput.id },
    setDebug: { type: 'setDebug', enabled: false, basis: 'checkbox' },
    rememberSlider: { type: 'rememberSlider', enabled: false, frame: 1 },
    rememberView: { type: 'rememberView', view },
    checkCachedFace: { type: 'checkCachedFace', input: probeInput },
    consentToDownload: { type: 'consentToDownload', scope: 'route' },
    downloadModels: { type: 'downloadModels', includePhoto: false },
    queueFace: { type: 'queueFace', id: probeInput.id, depth: 1 },
    cancelQueuedFace: { type: 'cancelQueuedFace', id: probeInput.id },
    saveMedia: { type: 'saveMedia', id: 'absent' },
    shareMedia: { type: 'shareMedia', id: 'absent' },
    exportProject: { type: 'exportProject', view },
    importProject: {
      type: 'importProject',
      file: new Blob(['invalid project']),
      jobId,
      provider: 'cpu',
      view,
    },
    execute: {
      type: 'execute',
      request: { ...view, action: 'face', target: probeInput.id, provider: 'cpu', jobId },
    },
    dispatch: { type: 'dispatch', message: msg('Notice', 'effect dispatch reached the queue') },
  };
  const effect = descriptors[type] ?? ({ type } as Effect);
  store.update((state) => ({
    state: {
      ...state,
      Inputs: [probeInput],
      ...(type === 'execute' || type === 'importProject' ? { Busy: true, JobId: jobId } : {}),
      PendingJobs: [],
      Error: null,
    },
    effects: [effect],
  }));
  if (['selectPhoto', 'previewPhoto', 'cropPhoto', 'chooseDetectedFace'].includes(type))
    await until(store, () => Boolean(store.getState().Error));
  if (type === 'execute')
    await until(store, () => store.getState().Stage === 'face' || !store.getState().Busy);
  if (type === 'cancelWork' || type === 'importProject')
    await until(store, () => !store.getState().Busy);
  return store.getState().Status;
}
export async function stopControllerRouting() {
  await routing?.dispose();
  routing = undefined;
}

function snapshot(store: Store): Record<string, unknown> {
  const state = store.getState();
  const fields: (keyof State)[] = [
    'Inputs',
    'Busy',
    'JobId',
    'Stage',
    'Status',
    'Fraction',
    'Kind',
    'Width',
    'Pinch',
    'Frames',
    'Fps',
    'Error',
    'FailureToast',
    'ActiveFace',
    'Warn',
    'Remaining',
    'PendingFaces',
    'PendingJobs',
    'PendingMorph',
    'PendingImport',
    'RunSettings',
    'Route',
    'Previews',
    'Invite',
    'ConsentPrompt',
  ];
  return Object.fromEntries(fields.map((field) => [field, state[field]]));
}

/** Actual async execution for the recorded jobs rows; snapshots are never fed back as Completed events. */
export async function controllerGoldenJourney(
  row:
    | 'retry-unchanged'
    | 'morph.settings-start-cancel'
    | 'testing-bulk-generate'
    | 'morph.play-slider',
) {
  const controller = createController(
    {
      today: '<today>',
      url:
        row === 'testing-bulk-generate'
          ? 'https://next.facemorph.me/?testing'
          : 'https://next.facemorph.me/',
      consentAnswered: row === 'morph.settings-start-cancel' || row === 'morph.play-slider',
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;

  try {
    if (row === 'retry-unchanged') store.dispatch(msg('Edit', 'face-2', 'parity sample'));
    store.dispatch(msg('DownloadNow', false));
    if (row === 'morph.settings-start-cancel' || row === 'morph.play-slider')
      store.dispatch(msg('Frames', 8));
    const action =
      row === 'retry-unchanged'
        ? msg('RunFace', 'face-2')
        : msg('Run', row === 'testing-bulk-generate' ? 'faces' : 'morph');
    let cancelled: Record<string, unknown> | null = null;
    let fractionBeforeCancel: number | null = null;
    if (row !== 'testing-bulk-generate') {
      // Subscribe before starting, so cancellation occurs at a real progress event even on cache hits.
      const running = until(store, () => store.getState().Stage === 'face');
      store.dispatch(action);
      await running;
      fractionBeforeCancel = store.getState().Fraction;
      store.dispatch(msg('Cancel'));
      await until(store, () => !store.getState().Busy);
      cancelled = snapshot(store);
      store.dispatch(row === 'retry-unchanged' ? msg('Retry') : action);
    } else store.dispatch(action);
    await settled(store);
    const slider: Record<string, unknown>[] = [];
    if (row === 'morph.play-slider') {
      store.dispatch(msg('UseSliderToggle', true));
      await until(store, () => store.getState().SliderFrames !== null);
      slider.push({
        ...snapshot(store),
        UseSlider: true,
        SliderFrame: store.getState().SliderFrame,
        frameCount: store.getState().SliderFrames!.length,
      });
      store.dispatch(msg('SliderFrameSet', store.getState().SliderFrames!.length));
      slider.push({
        ...snapshot(store),
        UseSlider: true,
        SliderFrame: store.getState().SliderFrame,
        frameCount: store.getState().SliderFrames!.length,
      });
    }
    const state = store.getState();
    return {
      slider,
      cancelled,
      fractionBeforeCancel,
      completed: snapshot(store),
      faces: state.Faces.map(({ id, raw, label, sourceMode, sourceFile }) => ({
        id,
        raw,
        label,
        sourceMode,
        sourceFile,
      })),
      video: Boolean(state.VideoUrl),
    };
  } finally {
    await controller.dispose();
  }
}

export async function controllerFoundationJourney(
  row: 'words.generate-cpu' | 'seed.generate' | 'names.exact-text',
) {
  const controller = createController(
    {
      today: row === 'seed.generate' ? '2026-10-24' : '<today>',
      url: 'https://next.facemorph.me/',
      consentAnswered: false,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;
  const observations: { file: string; model: Record<string, unknown> }[] = [];
  function record(file: string) {
    const state = store.getState();
    observations.push({
      file,
      model: {
        ...snapshot(store),
        Faces: state.Faces.map(({ id, raw, label, sourceMode, sourceFile }) => ({
          id,
          raw,
          label,
          sourceMode,
          sourceFile,
        })),
        VideoUrl: Boolean(state.VideoUrl),
      },
    });
  }
  async function generate(file: string) {
    const previous = store.getState().JobId;
    store.dispatch(msg('RunFace', 'face-2'));
    await until(
      store,
      () =>
        store.getState().Gate !== null ||
        store.getState().JobId > previous ||
        Boolean(store.getState().Error),
    );
    if (store.getState().Gate) store.dispatch(msg('GateAccept'));
    await until(store, () => store.getState().JobId > previous || Boolean(store.getState().Error));
    await settled(store);
    record(file);
  }
  try {
    await until(store, () => store.getState().Downloads.known);
    if (row === 'seed.generate') {
      store.dispatch(msg('Mode', 'face-2', 'seed'));
      record('01-seed-mode');
      for (const [value, typed, done] of [
        ['0', '02-typed-0', '03-generated-0'],
        ['4294967295', '04-typed-4294967295', '05-generated-4294967295'],
      ]) {
        store.dispatch(msg('Edit', 'face-2', value!));
        await until(
          store,
          () =>
            !store
              .getState()
              .Previews.some((preview) => preview.id === 'face-2' && preview.value !== value),
        );
        record(typed!);
        await generate(done!);
      }
    } else {
      if (row === 'words.generate-cpu') record('01-arrived');
      store.dispatch(msg('Edit', 'face-2', row === 'names.exact-text' ? 'hello' : 'parity sample'));
      // fm-25um: Edit keeps the literal value and issues no preview request.
      // The recorded comparison checks the declared preview delta explicitly.
      record(row === 'names.exact-text' ? '01-typed' : '02-typed');
      await generate(row === 'names.exact-text' ? '02-generated' : '03-generated');
    }
    return observations;
  } finally {
    await controller.dispose();
  }
}

function until(store: Store, accept: () => boolean, budget = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error('Controller transition did not arrive'));
    }, budget);
    const off = store.subscribe(() => {
      if (!accept()) return;
      clearTimeout(timeout);
      off();
      resolve();
    });
    if (accept()) {
      clearTimeout(timeout);
      off();
      resolve();
    }
  });
}

export async function controllerPhotoJourney() {
  const controller = createController(
    {
      today: '2026-10-25',
      url: 'https://next.facemorph.me/',
      consentAnswered: true,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;
  try {
    store.dispatch(msg('Provider', 'cpu'));
    await until(store, () => store.getState().Downloads.known);
    store.dispatch(
      msg('PickPhoto', 'face-1', [new File(['bad'], 'unreadable.jpg', { type: 'image/jpeg' })]),
    );
    await until(store, () => Boolean(store.getState().Error));
    const rejectionMessage = store.getState().Error;
    const rejectionClearedPreparing = !store.getState().PreparingFaces.has('face-1');
    store.dispatch(msg('DismissError'));
    const bytes = await (await fetch('/photo.jpg')).blob();
    const file = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
    for (const id of ['face-1', 'face-2']) {
      store.dispatch(msg('PickPhoto', id, [file]));
      await until(
        store,
        () =>
          store.getState().Crop?.faceId === id ||
          store.getState().CropQueue.some((choice) => choice.faceId === id) ||
          Boolean(store.getState().Error),
      );
      if (store.getState().Error) throw new Error(store.getState().Error!);
    }
    const unconfirmed = store.getState();
    const beforeConfirmation = {
      gate: unconfirmed.Gate !== null,
      jobId: unconfirmed.JobId,
      sourceModes: unconfirmed.Inputs.map((input) => input.mode),
      preparing: unconfirmed.PreparingFaces.size,
    };
    const firstUrl = store.getState().Crop!.url;
    const queued = store.getState().CropQueue.map((choice) => choice.faceId);
    store.dispatch(msg('CropCancel'));
    let cancelledUrlReleased = false;
    try {
      await fetch(firstUrl);
    } catch {
      cancelledUrlReleased = true;
    }
    const cancelledSourceMode = store
      .getState()
      .Inputs.find((input) => input.id === 'face-1')?.mode;
    const nextShown = store.getState().Crop?.faceId;
    const proposal = JSON.stringify(store.getState().Crop!.view);
    store.dispatch(msg('CropAdjust'));
    store.dispatch(msg('CropResize', 'se', -40, -40));
    store.dispatch(msg('CropAccept'));
    const editorBlocksConfirmation =
      store.getState().Crop?.previousView !== undefined &&
      store.getState().JobId === 0 &&
      store.getState().PreparingFaces.size === 0;
    store.dispatch(msg('CropCancel'));
    const adjustmentCancelled = JSON.stringify(store.getState().Crop!.view) === proposal;
    store.dispatch(msg('CropAdjust'));
    store.dispatch(msg('CropResize', 'se', -40, -40));
    store.dispatch(msg('CropPan', 4, 2));
    store.dispatch(msg('CropPan', -4, -2));
    store.dispatch(msg('CropResize', 'se', 40, 40));
    for (let turns = 0; turns < 4; turns++) store.dispatch(msg('CropRotate'));
    store.dispatch(msg('CropUse'));
    store.dispatch(msg('DownloadNow', true));
    store.dispatch(msg('CropAccept'));
    await until(
      store,
      () =>
        store.getState().Faces.some((face) => face.id === 'face-2') ||
        Boolean(store.getState().Error),
      600_000,
    );
    const state = store.getState();
    if (state.Error) throw new Error(state.Error);
    const face = state.Faces.find((face) => face.id === 'face-2');
    return {
      rejectionMessage,
      rejectionClearedPreparing,
      beforeConfirmation,
      cancelledSourceMode,
      editorBlocksConfirmation,
      adjustmentCancelled,
      queued,
      cancelledUrlReleased,
      nextShown,
      encoded: face?.raw === true,
      sourceMode: face?.sourceMode,
      route: state.Route,
      hasCrop: state.Crop !== null,
      preparing: state.PreparingFaces.size,
    };
  } finally {
    await controller.dispose();
  }
}
export async function controllerRecoveryJourney(bytes: readonly number[]) {
  const controller = createController(
    {
      today: '2026-10-25',
      url: 'https://next.facemorph.me/',
      consentAnswered: true,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;
  try {
    store.dispatch(
      msg('PickPhoto', 'face-1', [
        new File([Uint8Array.from(bytes)], 'saved.webp', { type: 'image/webp' }),
      ]),
    );
    await until(
      store,
      () => store.getState().Inputs[0]?.mode === 'project' || Boolean(store.getState().Error),
    );
    const state = store.getState();
    if (state.Error) throw new Error(state.Error);
    return {
      id: state.Inputs[0]?.id,
      mode: state.Inputs[0]?.mode,
      jobId: state.JobId,
      busy: state.Busy,
      hasFace: state.Faces.some((face) => face.id === 'face-1'),
      preparing: state.PreparingFaces.size,
    };
  } finally {
    await controller.dispose();
  }
}

function settled(store: Store): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timeout = setTimeout(() => {
      off();
      reject(new Error('Controller job did not settle'));
    }, 180_000);
    const check = () => {
      const state = store.getState();
      // Morph acceptance (fm-fy2.9) answers before the job starts; it is not yet settled.
      if (state.Busy || state.Accepting) return;
      clearTimeout(timeout);
      off();
      if (state.Error) reject(new Error(state.Error));
      else resolve();
    };
    off = store.subscribe(check);
    check();
  });
}
export async function controllerJourney() {
  const controller = createController(
    {
      today: '2026-10-25',
      url: 'https://next.facemorph.me/?testing',
      consentAnswered: true,
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;
  try {
    store.dispatch(msg('Provider', 'cpu'));
    store.dispatch(msg('Edit', 'face-1', 'charlotte'));
    store.dispatch(msg('Edit', 'face-2', 'chris'));
    store.dispatch(msg('DownloadNow', false));
    store.dispatch(msg('Save', 'absent'));
    await until(
      store,
      () => store.getState().Status === "Couldn't save or share this file. Try Save instead.",
    );
    const saveRejected = true;
    store.dispatch(msg('Notice', ''));
    store.dispatch(msg('Share', 'absent'));
    await until(
      store,
      () => store.getState().Status === "Couldn't save or share this file. Try Save instead.",
    );
    const shareRejected = true;
    store.dispatch(msg('Export'));
    await until(store, () => store.getState().Status === 'Generate or open a project first.');
    const exportRejected = true;
    store.dispatch(msg('RunFace', 'face-1'));
    await settled(store);
    const first = store.getState().Faces.some((face) => face.id === 'face-1');
    store.dispatch(msg('Run', 'faces'));
    await settled(store);
    const second = store.getState().Faces.some((face) => face.id === 'face-2');
    const bulkCompleted = store.getState().Status === 'Done — ready to save or share.';
    store.dispatch(msg('Import', new Blob(['invalid project'], { type: 'application/json' })));
    await settled(store).catch(() => {});
    const importRejected = Boolean(store.getState().Error) && store.getState().Faces.length === 2;
    store.dispatch(msg('Frames', 8));
    store.dispatch(msg('Kind', 'linear'));
    store.dispatch(msg('PinchToggle', false));
    store.dispatch(msg('Run', 'morph'));
    await settled(store);
    const state = store.getState();
    const video = state.VideoUrl.startsWith('blob:');
    const faces = state.Faces.length;
    const route = state.Route;
    let reports = 0;
    let downloads = 0;
    const offReports = subscribeProgress({
      dispatch: () => {
        reports++;
      },
    });
    const offDownloads = subscribeDownloads({
      dispatch: () => {
        downloads++;
      },
    });
    facade.setDebug(false, 'checkbox');
    const reportObserved = reports > 0;
    const downloadObserved = downloads > 0;
    offReports();
    offDownloads();
    const reportsBefore = reports;
    const downloadsBefore = downloads;
    facade.setDebug(false, 'checkbox');
    facade.consentToDownload('route');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const subscriptionsDetached = reports === reportsBefore && downloads === downloadsBefore;
    await controller.dispose();
    const disposedState = store.getState();
    // A real global reporting event must no longer update this controller after teardown.
    facade.setDebug(false, 'checkbox');
    const unchangedAfterDispose = store.getState() === disposedState;
    return {
      first,
      second,
      video,
      faces,
      route,
      unchangedAfterDispose,
      bulkCompleted,
      saveRejected,
      shareRejected,
      exportRejected,
      importRejected,
      reportObserved,
      downloadObserved,
      subscriptionsDetached,
    };
  } finally {
    await controller.dispose();
  }
}
