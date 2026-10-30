// A recording, manually settled OperationBridge for operation-service tests: every provider call is
// pending until the test resolves it, so each cancellation boundary can be held open and observed.
import type { InputRevision } from '../contracts/inputs.ts';
import { createOperationService, type OperationBridge } from './bridge-service.ts';
import type { OperationEvent, OperationRequest, SourceSnapshot } from './service.ts';
import {
  readProgress,
  type Output,
  type Progress,
  type Request,
} from '../../shell/facade/records.ts';

export interface PendingCall<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}
export interface Execution extends PendingCall<Output> {
  readonly request: Request;
}
export interface FilePreparation extends PendingCall<Output> {
  readonly id: string;
}

export function output(ids: readonly string[] = [], message = ''): Output {
  return {
    faces: ids.map((id) => ({
      id,
      raw: true,
      url: `blob:${id}`,
      label: id,
      sourceMode: 'text',
      sourceFile: null,
    })),
    videoUrl: '',
    projectJson: '',
    message,
    errorMessage: '',
    restored: false,
    inputs: [],
    kind: '',
    width: 0,
    pinch: false,
    frames: 0,
    fps: 0,
    cropFace: null,
    refusal: null,
  };
}
/** What the real bridge resolves with after `cancel()` aborts a job. */
export const cancelledOutput = (): Output =>
  output([], 'Cancelled. Your completed faces are still available.');

export function fakeBridge() {
  const listeners = new Set<(progress: Progress) => void>();
  const calls: string[] = [];
  const executions: Execution[] = [];
  const files: FilePreparation[] = [];
  let framesDone = 0,
    framesTotal = 0;
  const bridge: OperationBridge = {
    jobProgress: () => ({
      facesDone: 0,
      facesTotal: 0,
      framesDone,
      framesTotal,
      videoFramesDone: 0,
      videoFramesTotal: 0,
    }),
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    queueFace: (id) => void calls.push(`queueFace:${id}`),
    cancelQueuedFace: (id) => void calls.push(`cancelQueuedFace:${id}`),
    cancel: () => void calls.push('cancel'),
    cancelPhotoRun: () => void calls.push('cancelPhotoRun'),
    importProject: () => Promise.reject(Error('importProject is not used by these tests')),
    async execute(request, compute) {
      await compute?.acquire();
      calls.push(`execute:${request.action}:${request.target ?? ''}`);
      try {
        return await new Promise<Output>((resolve, reject) =>
          executions.push({ request, resolve, reject }),
        );
      } finally {
        await compute?.release();
      }
    },
    rememberView: () => {},
    prepareFaceFile(id) {
      calls.push(`prepareFaceFile:${id}`);
      return new Promise((resolve, reject) => files.push({ id, resolve, reject }));
    },
    invalidateFace: (id) => void calls.push(`invalidateFace:${id}`),
    invalidateMorph: () => void calls.push('invalidateMorph'),
  };
  return {
    bridge,
    calls,
    executions,
    files,
    /** Emits a progress event the way the runtime does for the job in flight. */
    progress(jobId: number, stage: string, text = '', extra: Record<string, number> = {}) {
      if (stage === 'morph') {
        framesDone = extra['loaded'] ?? framesDone;
        framesTotal = extra['total'] ?? framesTotal;
      }
      // Cross the same decoder as the real facade: raw loaded/total are not
      // public Progress fields. Whole-action progress must use jobProgress().
      for (const listener of listeners)
        listener(readProgress({ jobId, stage, text, fraction: 0, ...extra }));
    },
  };
}

/** Lets queued microtasks and settled promises run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const route = {
  requested: 'cpu',
  fallbackScope: 'cpu-once',
  runtimeSha256: 'runtime',
  modelSha256: 'model',
} as const;
export const settings = { kind: 'linear', width: 1, pinch: false, frames: 4, fps: 16 } as const;
export function source(slot: string, value = slot, revision = 1): SourceSnapshot {
  return {
    slot,
    revision: revision as InputRevision,
    input: { id: slot, mode: 'text', value, file: null },
  };
}
export function face(slot: string, value = slot, revision = 1) {
  return {
    kind: 'face',
    source: source(slot, value, revision),
    route,
    settings,
  } satisfies Extract<OperationRequest, { kind: 'face' }>;
}
export function morph(...slots: readonly string[]) {
  return {
    kind: 'morph',
    sources: slots.map((slot) => source(slot)),
    route,
    settings,
  } satisfies Extract<OperationRequest, { kind: 'morph' }>;
}
/** The event types one request received, in order. */
export function eventsFor(events: readonly OperationEvent[], requestId: string): string[] {
  return events.filter((e) => e.intent.requestId === requestId).map((e) => e.type);
}
/** A service over a held fake bridge, recording every event; `targets` lists executions as `action:target`. */
export function held() {
  const fake = fakeBridge();
  const service = createOperationService({ bridge: fake.bridge });
  const events: OperationEvent[] = [];
  service.subscribe((event) => events.push(event));
  const targets = () => fake.executions.map((e) => `${e.request.action}:${e.request.target}`);
  return { fake, service, events, targets };
}
/** Resolves every provider call from `from` on, including ones they start: faces as results, a morph as a video. */
export async function computeAll(fake: ReturnType<typeof fakeBridge>, from: number) {
  for (let index = from; index < fake.executions.length; index += 1) {
    const execution = fake.executions[index]!;
    execution.resolve(
      output(execution.request.action === 'face' ? [execution.request.target] : []),
    );
    await flush();
  }
}
