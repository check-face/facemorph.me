// The controller's operation boundary. Snapshots cross queues; callbacks and AbortSignals stay with the caller.
import type { ComputeRoute } from '@facemorph/stylegan-js';
import type { Replacement } from './intents.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import type { RouteSnapshot } from '../contracts/scheduler.ts';
import type { Input, MorphKind, Output, Progress, Refusal } from '../../shell/facade/records.ts';

declare const requestTag: unique symbol;
declare const attemptTag: unique symbol;
export type RequestId = string & { readonly [requestTag]: true };
export type AttemptId = string & { readonly [attemptTag]: true };

/** Internal constructors are the only place an opaque ID is created. IDs remain structured-cloneable strings. */
export function operationIds(sequence: number): {
  readonly requestId: RequestId;
  readonly attemptId: AttemptId;
} {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new RangeError('Operation sequence must be positive');
  return {
    requestId: `request:${sequence}` as RequestId,
    attemptId: `attempt:${sequence}` as AttemptId,
  };
}

export interface SourceSnapshot {
  readonly slot: string;
  readonly revision: InputRevision;
  readonly input: Input;
}
export interface MorphSettings {
  readonly kind: MorphKind;
  readonly width: number;
  readonly pinch: boolean;
  readonly frames: number;
  readonly fps: number;
}
interface Common {
  readonly route: RouteSnapshot;
  readonly settings: MorphSettings;
}
export type OperationRequest =
  | (Common & { readonly kind: 'face'; readonly source: SourceSnapshot })
  | (Common & { readonly kind: 'morph'; readonly sources: readonly SourceSnapshot[] })
  | (Common & {
      readonly kind: 'import';
      readonly sources: readonly SourceSnapshot[];
      readonly file: Blob;
    });
export interface IntentSnapshot {
  readonly requestId: RequestId;
  readonly attemptId: AttemptId;
  readonly request: OperationRequest;
}
export type OperationFailure =
  | { readonly kind: 'admission'; readonly refusal: Refusal }
  | { readonly kind: 'operation'; readonly message: string };
interface EventIdentity {
  readonly intent: IntentSnapshot;
  /** Null means no provider has been observed (e.g. a model-free cache hit), never an assumed CPU pass. */
  readonly provider: ComputeRoute | null;
}
export type OperationEvent = EventIdentity &
  (
    | { readonly type: 'queued' }
    | { readonly type: 'admitted' }
    | { readonly type: 'progress'; readonly progress: Progress }
    | { readonly type: 'compute-ready'; readonly output: Output }
    | { readonly type: 'file-ready'; readonly output: Output }
    | { readonly type: 'failed'; readonly cause: OperationFailure }
    | { readonly type: 'cancelled' }
    | { readonly type: 'settled'; readonly outcome: OperationSettlement['status'] }
  );
export type OperationSettlement =
  | { readonly status: 'completed'; readonly output: Output }
  | { readonly status: 'cancelled' | 'superseded' }
  | { readonly status: 'failed'; readonly cause: OperationFailure };
export interface OperationHandle extends IntentSnapshot {
  readonly done: Promise<OperationSettlement>;
}
export type CancelTarget = { readonly slot: string } | { readonly requestId: RequestId };
export type ScheduledJob =
  | { readonly kind: 'face'; readonly id: string }
  | { readonly kind: 'morph' | 'import' };
export interface SchedulingState {
  readonly busy?: boolean;
  readonly blockedFaces?: readonly string[];
  readonly blockMorph?: boolean;
}
export interface OperationService {
  requestFace(request: Extract<OperationRequest, { kind: 'face' }>): OperationHandle;
  requestMorph(request: Extract<OperationRequest, { kind: 'morph' }>): OperationHandle;
  requestImport(request: Extract<OperationRequest, { kind: 'import' }>): OperationHandle;
  requestNext(jobs: readonly ScheduledJob[], state?: SchedulingState): number;
  setBlocked(state: Omit<SchedulingState, 'busy'>): void;
  revise(slot: string, revision: InputRevision): void;
  remove(slot: string): void;
  cancel(target: CancelTarget): void;
  retry(slot: string): OperationHandle;
  stageReplacement(kind: Replacement['kind'], slots: readonly string[]): Replacement;
  abandonReplacement(replacement: Replacement): void;
  commitReplacement(
    replacement: Replacement,
    next: readonly {
      readonly slot: string;
      readonly revision: InputRevision;
      readonly verified?: Output;
    }[],
  ): boolean;
  subscribe(callback: (event: OperationEvent) => void): () => void;
  dispose(): Promise<void>;
}

export function sources(request: OperationRequest): readonly SourceSnapshot[] {
  return request.kind === 'face' ? [request.source] : request.sources;
}
/** Copy at approval/start: later selector, input-array or settings mutations cannot revise queued work. */
export function capture(request: OperationRequest): OperationRequest {
  const source = (s: SourceSnapshot): SourceSnapshot =>
    Object.freeze({
      slot: s.slot,
      revision: s.revision,
      input: Object.freeze({
        id: s.input.id,
        mode: s.input.mode,
        value: s.input.value,
        file: s.input.file,
      }),
    });
  const common = {
    route: Object.freeze({
      requested: request.route.requested,
      fallbackScope: request.route.fallbackScope,
      runtimeSha256: request.route.runtimeSha256,
      modelSha256: request.route.modelSha256,
    }),
    settings: Object.freeze({ ...request.settings }),
  };
  if (request.kind === 'face')
    return Object.freeze({ ...common, kind: 'face', source: source(request.source) });
  const copied = Object.freeze(request.sources.map(source));
  return request.kind === 'morph'
    ? Object.freeze({ ...common, kind: 'morph', sources: copied })
    : Object.freeze({ ...common, kind: 'import', sources: copied, file: request.file });
}
