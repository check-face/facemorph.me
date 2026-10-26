// The page the facade harness drives (fm-pia9): the typed facade over the real candidate bridge, its runtime and
// ort-worker, bundled by Vite. Every step returns the facade's typed records; nothing here replaces bridge behaviour.
import * as f from '../../../shell/facade/bridge.ts';
import { createOperationService } from '../../../src/operations/bridge-service.ts';
import type {
  OperationEvent,
  OperationHandle,
  SourceSnapshot,
} from '../../../src/operations/service.ts';
import type { InputRevision } from '../../../src/contracts/inputs.ts';
import { readSession } from '../../../src/Next/last-result.mjs';
import { generationIdentity } from '../../../src/Next/browser/identity.mjs';
import { digest, openOriginals } from '../../../src/Next/browser/originals.mjs';
import {
  controllerJourney,
  controllerTarget,
  startControllerRouting,
  controllerRoutingStep,
  stopControllerRouting,
  controllerGoldenJourney,
  controllerFoundationJourney,
  controllerPhotoJourney,
  controllerRecoveryJourney,
} from '../../harness/ctl-effects.spec.ts';

const progress: f.Progress[] = [];
const downloads: f.Downloads[] = [];
const invalid: string[] = [];
f.subscribe(
  (p) => progress.push(p),
  (e) => invalid.push(e.message),
);
f.subscribeDownloads(
  (d) => downloads.push(d),
  (e) => invalid.push(e.message),
);
let job = 0;

const input = (
  id: string,
  mode: f.InputMode,
  value: string,
  file: Blob | null = null,
): f.Input => ({ id, mode, value, file });
const request = (action: f.Action, target: string, inputs: f.Input[], frames = 8): f.Request => ({
  jobId: ++job,
  action,
  target,
  inputs,
  kind: 'linear',
  width: 1,
  pinch: false,
  frames,
  fps: 16,
  provider: 'cpu',
});
const settled = () => ({
  job: f.jobProgress(),
  progressEvents: progress.length,
  invalid: [...invalid],
});

async function serviceRoute() {
  const bytes = await (await fetch('/runtime/manifest.json')).arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { modelSourceSha256: string };
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return {
    requested: 'cpu',
    fallbackScope: 'none',
    runtimeSha256: hash,
    modelSha256: manifest.modelSourceSha256,
  } as const;
}

const harness = {
  controllerJourney,
  controllerTarget,
  startControllerRouting,
  controllerRoutingStep,
  stopControllerRouting,
  controllerGoldenJourney,
  controllerFoundationJourney,
  controllerPhotoJourney,
  controllerRecoveryJourney,
  async serviceParentJourney(cancelParent: boolean) {
    const service = createOperationService();
    const route = await serviceRoute();
    const settings = { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 } as const;
    const source = (slot: string, value: string): SourceSnapshot => ({
      slot,
      revision: 1 as InputRevision,
      input: input(slot, 'seed', value),
    });
    const prefix = cancelParent ? 'cancel-parent' : 'parent';
    const a = source(`${prefix}-a`, cancelParent ? '843301' : '833301'),
      b = source(`${prefix}-b`, cancelParent ? '843302' : '833302');
    const trace: { type: string; id: string; stage?: string; job?: number }[] = [];
    let parent: OperationHandle | undefined;
    let shared: OperationHandle | undefined;
    let other: OperationHandle | undefined;
    service.subscribe((event) => {
      trace.push({
        type: event.type,
        id: event.intent.requestId,
        ...(event.type === 'progress'
          ? { stage: event.progress.stage, job: event.progress.jobId }
          : {}),
      });
      if (event.intent.requestId !== parent?.requestId || event.type !== 'progress') return;
      if (event.progress.stage === 'face' && !shared) {
        shared = service.requestFace({ kind: 'face', source: a, settings, route });
        other = service.requestFace({
          kind: 'face',
          source: source(`${prefix}-c`, cancelParent ? '843303' : '833303'),
          settings,
          route,
        });
      }
      if (cancelParent && shared && event.progress.stage === 'synthesis')
        service.cancel({ requestId: parent.requestId });
    });
    try {
      parent = service.requestMorph({ kind: 'morph', sources: [a, b], settings, route });
      const p = await parent.done;
      const s = shared && (await shared.done);
      const o = other && (await other.done);
      return {
        statuses: [p.status, s?.status, o?.status],
        video: p.status === 'completed' && Boolean(p.output.videoUrl),
        ids: { parent: parent.requestId, shared: shared?.requestId, other: other?.requestId },
        trace,
        ...settled(),
      };
    } finally {
      await service.dispose();
    }
  },
  async serviceFileCancelJourney() {
    const service = createOperationService();
    const route = await serviceRoute();
    const settings = { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 } as const;
    const request = (slot: string, value: string) => ({
      kind: 'face' as const,
      source: { slot, revision: 1 as InputRevision, input: input(slot, 'seed', value) },
      settings,
      route,
    });
    const trace: { type: string; id: string }[] = [];
    let first: OperationHandle | undefined;
    let second: OperationHandle | undefined;
    let third: OperationHandle | undefined;
    service.subscribe((event) => {
      trace.push({ type: event.type, id: event.intent.requestId });
      if (event.type === 'compute-ready' && event.intent.requestId === first?.requestId) {
        second = service.requestFace(request('file-b', '733302'));
        third = service.requestFace(request('file-c', '733303'));
        queueMicrotask(() => service.cancel({ requestId: first!.requestId }));
      }
    });
    try {
      first = service.requestFace(request('file-a', '733301'));
      const a = await first.done;
      const b = second && (await second.done);
      const c = third && (await third.done);
      return {
        statuses: [a.status, b?.status, c?.status],
        trace,
        first: first.requestId,
        ...settled(),
      };
    } finally {
      await service.dispose();
    }
  },
  async serviceJourney() {
    const service = createOperationService();
    const events: { type: OperationEvent['type']; provider: string | null; attempt: string }[] = [];
    service.subscribe((e) =>
      events.push({ type: e.type, provider: e.provider, attempt: e.intent.attemptId }),
    );
    try {
      const route = await serviceRoute();
      const settings = { kind: 'linear', width: 1, pinch: false, frames: 8, fps: 16 } as const;
      const source = (slot: string, value: string): SourceSnapshot => ({
        slot,
        revision: 1 as InputRevision,
        input: input(slot, 'text', value),
      });
      const a = source('service-a', 'charlotte'),
        b = source('service-b', 'chris');
      const first = service.requestFace({ kind: 'face', source: a, settings, route });
      const second = service.requestFace({ kind: 'face', source: b, settings, route });
      const morph = service.requestMorph({ kind: 'morph', sources: [a, b], settings, route });
      const results = await Promise.all([first.done, second.done, morph.done]);
      const completedEvents = [...events];
      const wrongIdentity = await service.requestFace({
        kind: 'face',
        source: a,
        settings,
        route: { ...route, runtimeSha256: '0'.repeat(64) },
      }).done;
      const removeEvents: string[] = [];
      const off = service.subscribe((event) => {
        if (
          event.intent.request.kind !== 'face' ||
          event.intent.request.source.slot !== 'service-remove'
        )
          return;
        removeEvents.push(event.type);
        if (event.type === 'progress' && event.progress.stage === 'route-admitted')
          service.remove('service-remove');
      });
      const removed = service.requestFace({
        kind: 'face',
        source: source('service-remove', 'remove this active face'),
        settings,
        route,
      });
      const afterRemove = service.requestFace({
        kind: 'face',
        source: source('service-after', 'charlotte'),
        settings,
        route,
      });
      const removal = await Promise.all([removed.done, afterRemove.done]);
      off();
      return {
        results,
        events: completedEvents,
        wrongIdentity,
        removal,
        removeEvents,
        ...settled(),
      };
    } finally {
      await service.dispose();
    }
  },
  async face(id: string, mode: 'text' | 'seed', value: string) {
    const out = await f.execute(request('face', id, [input(id, mode, value)]));
    return { out, ...settled() };
  },
  /** Starts a face, cancels at its first progress event, then makes another face on the same lane. */
  async cancelMidRun() {
    const before = progress.length;
    const running = f.execute(request('face', 'c', [input('c', 'text', 'cancel me')]));
    const deadline = Date.now() + 120_000;
    while (progress.length === before && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    f.cancel();
    const cancelled = await running;
    const late: string[] = [];
    const after = await f.execute(request('face', 'd', [input('d', 'text', 'after cancel')]));
    if (cancelled.faces.some((x) => x.id === 'c')) late.push('the cancelled face has a result');
    return { cancelled, after, late, ...settled() };
  },
  async photo(id: string, url: string) {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    const selection = await f.selectPhoto({ id, files: [file] });
    let chosen: Blob;
    if (selection.kind === 'photo') chosen = selection.file;
    else if (selection.kind === 'crop') {
      const offer = selection.offer;
      const side = Math.min(offer.previewWidth, offer.previewHeight);
      chosen = await f.cropPhoto(
        offer.file,
        {
          left: (offer.previewWidth - side) / 2,
          top: (offer.previewHeight - side) / 2,
          width: side,
          height: side,
        },
        { previewScale: offer.scale, rotation: 0 },
      );
    } else return { selection: selection.kind };
    const out = await f.execute(request('face', id, [input(id, 'photo', 'Photo', chosen)]));
    return { selection: selection.kind, out, ...settled() };
  },
  save: (id: string) => f.saveMedia(id),
  /** A saved file through the bridge's file entry (fm-fy2.7): what it installs and whether any job ran. */
  async reopenSaved(id: string, bytes: number[], name: string, type: string) {
    const before = progress.length;
    const file = new File([Uint8Array.from(bytes)], name, { type });
    try {
      const selection = await f.selectPhoto({ id, files: [file] });
      return {
        kind: selection.kind,
        faces:
          selection.kind === 'recovered'
            ? selection.output.faces.map((x) => ({ id: x.id, label: x.label, url: x.url !== '' }))
            : [],
        message: selection.kind === 'recovered' ? selection.output.message : '',
        jobEvents: progress.length - before,
        ...settled(),
      };
    } catch (error) {
      return { error: (error as Error).message, jobEvents: progress.length - before };
    }
  },
  async morph(a: string, b: string) {
    const options = request('morph', '', [input(a, 'text', a), input(b, 'text', b)], 8);
    f.rememberView(options);
    const out = await f.execute(options);
    const planned = f.plannedFrames({
      inputs: [input(a, 'text', a), input(b, 'text', b)],
      kind: 'linear',
      width: 1,
      pinch: false,
      frames: 8,
      fps: 16,
    });
    return { out, planned, ...settled() };
  },
  restore: () => f.restoreLastResult(),
  async retained() {
    const session: unknown = await readSession();
    return Boolean(
      session &&
      typeof session === 'object' &&
      'faces' in session &&
      Array.isArray(session.faces) &&
      session.faces.length > 0,
    );
  },
  async retentionFacts() {
    const field = (value: unknown, key: string): unknown =>
      value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
    const session: unknown = await readSession();
    const manifest: unknown = await (await fetch('/runtime/manifest.json')).json();
    const faces: unknown = field(session, 'faces');
    const store = await openOriginals();
    const raw: unknown = await store.get('last-generated-session-v2');
    store.close();
    const rawFaces = field(raw, 'faces');
    const storage = {
      rawFaces: Array.isArray(rawFaces) ? rawFaces.length : null,
      settings: field(raw, 'settings'),
    };
    if (!Array.isArray(faces)) return { faces: null, storage };
    const checks = await Promise.all(
      faces.map(async (face: unknown) => {
        const result = field(face, 'result');
        const provenance = field(result, 'provenance');
        const kind = field(face, 'generationKind');
        return {
          id: field(face, 'id'),
          kind,
          modelMatches: field(provenance, 'modelSha256') === field(manifest, 'modelSourceSha256'),
          noiseMatches: field(provenance, 'noiseSha256') === field(manifest, 'noiseSha256'),
          generation: field(result, 'generationSha256'),
          expected: await digest(JSON.stringify(generationIdentity(manifest, kind))),
        };
      }),
    );
    return { checks, storage };
  },
  downloads: () => downloads.slice(-1)[0] ?? null,
  reportStatus: () => ({
    staged: f.stagedReportCount(),
    reference: f.reportReference(),
    answered: f.consentAnswered(),
  }),
  async reports() {
    f.setDebug(true, 'checkbox');
    await f.execute(request('face', 'r', [input('r', 'seed', '7')]));
    return {
      staged: f.stagedReportCount(),
      reference: f.reportReference(),
      answered: f.consentAnswered(),
    };
  },
  draw(id: string) {
    const canvas = document.getElementById('face') as HTMLCanvasElement;
    f.drawFace(canvas, id);
    return canvas.toDataURL().length;
  },
};
Object.assign(window, { harness, harnessReady: true });
