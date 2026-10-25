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
  const descriptors: Record<string, Effect> = {
    invalidateFace: { type: 'invalidateFace', id: probeInput.id },
    invalidatePhotoSelections: { type: 'invalidatePhotoSelections', id: probeInput.id },
    rememberSourcePhoto: { type: 'rememberSourcePhoto', id: probeInput.id, file: null },
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
    },
    effects: [effect],
  }));
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

/** Actual async execution for the recorded jobs rows; snapshots are never fed back as Completed events. */
export async function controllerGoldenJourney(
  row: 'retry-unchanged' | 'morph.settings-start-cancel' | 'testing-bulk-generate',
) {
  const controller = createController(
    {
      today: '<today>',
      url:
        row === 'testing-bulk-generate'
          ? 'https://next.facemorph.me/?testing'
          : 'https://next.facemorph.me/',
      consentAnswered: row === 'morph.settings-start-cancel',
      sliderPreference: false,
      sliderPosition: 1,
    },
    { identity: await identity() },
  );
  const store = controller.store;
  function snapshot(): Record<string, unknown> {
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
  try {
    if (row === 'retry-unchanged') store.dispatch(msg('Edit', 'face-2', 'parity sample'));
    store.dispatch(msg('DownloadNow', false));
    if (row === 'morph.settings-start-cancel') store.dispatch(msg('Frames', 8));
    const action =
      row === 'retry-unchanged'
        ? msg('RunFace', 'face-2')
        : msg('Run', row === 'testing-bulk-generate' ? 'faces' : 'morph');
    let cancelled: Record<string, unknown> | null = null;
    if (row !== 'testing-bulk-generate') {
      // Subscribe before starting, so cancellation occurs at a real progress event even on cache hits.
      const running = until(store, () => store.getState().Stage === 'face');
      store.dispatch(action);
      await running;
      store.dispatch(msg('Cancel'));
      await until(store, () => !store.getState().Busy);
      cancelled = snapshot();
      store.dispatch(row === 'retry-unchanged' ? msg('Retry') : action);
    } else store.dispatch(action);
    await settled(store);
    const state = store.getState();
    return {
      cancelled,
      completed: snapshot(),
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

function until(store: Store, accept: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error('Controller transition did not arrive'));
    }, 15_000);
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

function settled(store: Store): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timeout = setTimeout(() => {
      off();
      reject(new Error('Controller job did not settle'));
    }, 180_000);
    const check = () => {
      const state = store.getState();
      if (state.Busy) return;
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
