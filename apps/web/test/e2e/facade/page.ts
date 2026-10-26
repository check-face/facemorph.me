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
import { confirmedCropOf } from '../../../src/Next/photo/confirmed-crop.mjs';
import {
  cancelCropSlot,
  cropPhotoReported,
  cropQueueProbe,
  encodeCropBatch,
  morphFramesKey,
  removeCropSlot,
  retryCropSlots,
  subscribeCropSlots,
} from '../../../src/Next/product-bridge.mjs';
import { frameStoreGet } from '../../../src/Next/morph-frames.mjs';
import { createBrowserRuntime } from '../../../src/Next/browser/runtime.mjs';
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
// Object URLs and unhandled rejections, for the Save matrix's cleanup checks (fm-ykfa).
const createdUrls: string[] = [];
const revokedUrls = new Set<string>();
let unhandled = 0;
{
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o: Blob | MediaSource) => {
    const url = create(o);
    createdUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revokedUrls.add(url);
    revoke(url);
  };
  window.addEventListener('unhandledrejection', () => unhandled++);
}
async function rgbaOf(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

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
  /**
   * The person's approval of the downloads these journeys need (the dialog's Download and continue): workers acquire
   * only what an approval covers or the device already holds (fm-qrfz).
   */
  approveDownloads: (): string => f.consentToDownload('photo'),
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
  /**
   * crop.fix (fm-6ib8): a photo the detector cannot find a face in. Run as chosen, detection proposes nothing and
   * the typed outcome asks for a crop (before OK); the crop confirmed whole with Use this crop then runs as the face.
   * Counts the worker messages after OK: 'align' is a detection pass, 'encode-aligned' an e4e attempt.
   */
  async confirmedCrop(id: string, url: string) {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'no-face.jpg', { type: 'image/jpeg' });
    const selection = await f.selectPhoto({ id, files: [file] });
    const source =
      selection.kind === 'photo'
        ? selection.file
        : selection.kind === 'crop'
          ? selection.offer.file
          : null;
    if (!source) return { selection: selection.kind };
    const proposal = await f.execute(request('face', id, [input(id, 'photo', 'Photo', source)]));
    const offer = await f.previewPhoto(source);
    const side = Math.min(offer.previewWidth, offer.previewHeight);
    const chosen = await f.cropPhoto(
      source,
      { left: 0, top: 0, width: side, height: side },
      { previewScale: offer.scale, rotation: 0 },
    );
    const posted: string[] = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const type = (message as { type?: unknown } | null)?.type;
      if (typeof type === 'string') posted.push(type);
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
    try {
      const out = await f.execute(request('face', id, [input(id, 'photo', 'Photo', chosen)]));
      return {
        selection: selection.kind,
        proposalCropFace: proposal.cropFace,
        out,
        detections: posted.filter((t) => t === 'align').length,
        encodes: posted.filter((t) => t === 'encode-aligned').length,
        ...settled(),
      };
    } finally {
      Worker.prototype.postMessage = post;
    }
  },
  /**
   * crop.queue (fm-fy2.8) through the real bridge on the CPU: A1 and A2 cropped from one photo and B2 from another,
   * confirmed once each, then encoded by the bridge's queue in click order. B2 is cancelled while queued and later
   * retried (a new attempt on the same frozen crop); a fourth slot is cancelled and removed to show Remove releasing
   * its pixels. Worker messages after OK are counted: 'align' is a detection pass, 'encode-aligned' an e4e attempt.
   */
  async cropQueue(photoUrl: string, otherUrl: string) {
    type Slot = {
      slotId: string;
      attemptId: string;
      state: string;
      code?: string;
      result?: { values: Float32Array };
    };
    const fileOf = async (url: string, name: string) =>
      new File([await (await fetch(url)).blob()], name, { type: 'image/jpeg' });
    const [a, b] = [await fileOf(photoUrl, 'a.jpg'), await fileOf(otherUrl, 'b.jpg')];
    const crop = async (file: File, at: number) => {
      const offer = await f.previewPhoto(file);
      const side = Math.floor(Math.min(offer.previewWidth, offer.previewHeight) * 0.8);
      const left = Math.floor((offer.previewWidth - side) * at);
      const top = Math.floor((offer.previewHeight - side) * at);
      return (await cropPhotoReported(
        file,
        { left, top, width: side, height: side },
        { previewScale: offer.scale, rotation: 0 },
      )) as File;
    };
    const crops = [await crop(a, 0), await crop(b, 0.5), await crop(a, 1)];
    const confirmed = crops.length;
    const causes = (c: unknown, depth = 0): string[] =>
      c instanceof Error && depth < 4
        ? [`${c.name}: ${c.message}`, ...causes((c as { cause?: unknown }).cause, depth + 1)]
        : [];
    type SlotEvent = {
      type: string;
      slotId: string;
      attemptId: string;
      batchRevision: number;
      kind?: string;
      message?: string;
    };
    const events: SlotEvent[] = [];
    const unsubscribe = await subscribeCropSlots((e: SlotEvent) =>
      events.push({
        type: e.type,
        slotId: e.slotId,
        attemptId: e.attemptId,
        batchRevision: e.batchRevision,
        // A failed slot says why (its failure kind and message), so a red run explains itself.
        ...(e.type === 'slot.failed'
          ? {
              kind: e.kind,
              // The queue's sentence, then the error underneath it (a ConfirmedCropError wraps the encoder's).
              message: [e.message, ...causes((e as { cause?: unknown }).cause)].join(' <- '),
            }
          : {}),
      }),
    );
    const posted: { type: string; crop?: string }[] = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const m = message as { type?: unknown; confirmedCropId?: unknown } | null;
      if (typeof m?.type === 'string')
        posted.push({
          type: m.type,
          ...(typeof m.confirmedCropId === 'string' ? { crop: m.confirmedCropId } : {}),
        });
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
    try {
      const first = (await encodeCropBatch(crops, {
        batchRevision: 1,
        onSlots: (ids: string[]) => void cancelCropSlot(ids[1]!),
      })) as Slot[];
      const kept = (await cropQueueProbe(first[1]!.slotId)).pixelRefs as number;
      const [retried] = (await retryCropSlots([first[1]!.slotId])) as Slot[];
      const afterRetry = await cropQueueProbe(first[1]!.slotId);
      const [held] = (await encodeCropBatch([crops[0]!], {
        batchRevision: 2,
        onSlots: (ids: string[]) => void cancelCropSlot(ids[0]!),
      })) as Slot[];
      const heldRefs = (await cropQueueProbe(held!.slotId)).pixelRefs as number;
      const removed = await removeCropSlot(held!.slotId);
      const releasedRefs = (await cropQueueProbe(held!.slotId)).pixelRefs as number;
      const values = (s?: Slot) => (s?.result ? Array.from(s.result.values.subarray(0, 8)) : null);
      return {
        confirmed,
        states: first.map((s) => s.state),
        slotIds: first.map((s) => s.slotId),
        retried: {
          state: retried?.state,
          attemptId: retried?.attemptId,
          before: first[1]!.attemptId,
        },
        kept,
        afterRetry: {
          pixelRefs: afterRetry.pixelRefs,
          derivations: afterRetry.derivations,
          maxLiveEncoders: afterRetry.maxLiveEncoders,
        },
        held: { state: held?.state, heldRefs, removed, releasedRefs },
        encodedCrops: posted.filter((p) => p.type === 'encode-aligned').map((p) => p.crop),
        cropIds: crops.map((c) => confirmedCropOf(c)?.confirmedCropId as string),
        detections: posted.filter((p) => p.type === 'align').length,
        finite: [first[0], retried, first[2]].every(
          (s) => s?.result?.values.length === 9216 && s.result.values.every(Number.isFinite),
        ),
        sample: { a1: values(first[0]), a2: values(first[2]), b2: values(retried) },
        events,
        ...settled(),
      };
    } finally {
      Worker.prototype.postMessage = post;
      unsubscribe();
    }
  },
  /**
   * compute.photo-descriptor (fm-dmlz): the e4e qualification photo seed-0 (512 x 512, unaligned) as a lossless
   * PNG, confirmed whole through the bridge's Use this crop at its own size, then run as face `id`. The runner
   * reads the face's W+ from its saved file's recovery metadata and compares it with the native reference.
   */
  async encodeQualifiedCrop(id: string, url: string) {
    const rgb = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const side = 512;
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(side, side);
    for (let i = 0; i < side * side; i++)
      image.data.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 255], i * 4);
    context.putImageData(image, 0, 0);
    const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'seed-0.png', {
      type: 'image/png',
    });
    const chosen = (await cropPhotoReported(
      file,
      { left: 0, top: 0, width: side, height: side },
      { previewScale: 1, rotation: 0, output: side },
    )) as File;
    const out = await f.execute(request('face', id, [input(id, 'photo', 'Photo', chosen)]));
    return { out, ...settled() };
  },
  /**
   * compute.app-rebind (fm-fy2.6): construct the engine's runtime from the served pointer and read its status, with
   * no work asked of it. The runner asserts that this requests nothing but the pointer and starts no worker.
   */
  async constructRuntime() {
    const response = await fetch('/runtime/manifest.json');
    const bytes = await response.arrayBuffer();
    const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const manifestSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('');
    const runtime = createBrowserRuntime({ manifest, manifestSha256 }) as {
      status(): unknown;
      dispose(): void;
    };
    const statuses = [runtime.status(), runtime.status(), runtime.status()];
    runtime.dispose();
    return { statuses: JSON.parse(JSON.stringify(statuses)) as unknown[] };
  },
  save: (id: string) => f.saveMedia(id),
  /** One Save with its wall time, the prepared-file counters and the job progress count after it (fm-ykfa). */
  async saveTimed(id: string, format?: f.StillFormat) {
    const urlsBefore = createdUrls.length;
    const began = performance.now();
    const message = await f.saveMedia(id, format ? { format } : undefined);
    return {
      ms: performance.now() - began,
      message,
      stats: f.exportStats(),
      progressEvents: progress.length,
      urls: createdUrls.slice(urlsBefore),
    };
  },
  urlFacts: (urls: string[]) => ({
    revoked: urls.filter((u) => revokedUrls.has(u)).length,
    total: urls.length,
    unhandled,
  }),
  /** Whether a saved still's decoded pixels equal the face as the bridge paints it (its prepared pixels). */
  async stillMatchesFace(id: string, bytes: number[], type: string) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    document.body.append(canvas);
    f.drawFace(canvas, id);
    const deadline = performance.now() + 30_000;
    while (canvas.dataset['faceDrawn'] !== 'true' && performance.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    canvas.remove();
    if (canvas.dataset['faceDrawn'] !== 'true') return { length: 0, differing: -1, maxDiff: -1 };
    const painted = canvas.getContext('2d')!.getImageData(0, 0, 1024, 1024).data;
    const saved = await rgbaOf(new Blob([Uint8Array.from(bytes)], { type }));
    let differing = 0,
      maxDiff = 0;
    for (let i = 0; i < painted.length; i++) {
      const d = Math.abs(painted[i]! - saved[i]!);
      if (d) differing++;
      if (d > maxDiff) maxDiff = d;
    }
    return { length: saved.length, differing, maxDiff };
  },
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
  /** fm-2xtz: actual worker commands, canonical retained bytes and retry MP4, never fake frames. */
  async codecExportRetry() {
    const options = request(
      'morph',
      '',
      [input('codec-a', 'seed', '271'), input('codec-b', 'seed', '314')],
      2,
    );
    f.rememberView(options);
    const posted: string[] = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const command = message as { type?: unknown; provider?: unknown } | null;
      if (
        typeof command?.type === 'string' &&
        (['generate', 'synthesize', 'synthesize-frames', 'encode-aligned', 'qualify'].includes(
          command.type,
        ) ||
          (command.type === 'initialize' && typeof command.provider === 'string'))
      )
        posted.push(command.type);
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
    try {
      const out = await f.execute(options);
      const key = await morphFramesKey();
      const frames = key ? await frameStoreGet(key) : null;
      const hashes = await Promise.all(
        (frames ?? []).map(async (blob: Blob) =>
          Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
            (byte) => byte.toString(16).padStart(2, '0'),
          ).join(''),
        ),
      );
      let video: string | null = null;
      if (out.videoUrl) {
        const bytes = new Uint8Array(await (await fetch(out.videoUrl)).arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        video = btoa(text);
      }
      return { out, hashes, key, video, inference: posted, ...settled() };
    } finally {
      Worker.prototype.postMessage = post;
    }
  },
  /**
   * morph.render (fm-ioap): a closed two-face pairwise ellipse, 16 frames per segment (32 frames) at 16 FPS, through
   * the bridge's renderMorph path. Returns the MP4's bytes (base64) so the runner decodes and counts its frames.
   * With `cancelAfter`, the morph is cancelled once that many frames are displayable, and nothing is returned.
   */
  async morphVideo(a: string, b: string, cancelAfter = 0) {
    const inputs = [input(a, 'text', a), input(b, 'text', b)];
    const options = { ...request('morph', '', inputs, 16), kind: 'pairwise-ellipse' as const };
    f.rememberView(options);
    const planned = f.plannedFrames({
      inputs,
      kind: 'pairwise-ellipse',
      width: 1,
      pinch: false,
      frames: 16,
      fps: 16,
    });
    const before = progress.length;
    const running = f.execute(options);
    if (cancelAfter) {
      const deadline = Date.now() + 600_000;
      const shown = () =>
        progress.slice(before).filter((p) => p.stage === 'frames-available').length;
      while (shown() < cancelAfter && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 20));
      f.cancel();
    }
    const out = await running;
    let video: string | null = null;
    if (out.videoUrl) {
      const bytes = new Uint8Array(await (await fetch(out.videoUrl)).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      video = btoa(text);
    }
    return { out, planned, video, ...settled() };
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
