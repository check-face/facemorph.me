// The controller's operation boundary. Snapshots cross queues; callbacks and AbortSignals stay with the caller.
import type { ComputeRoute } from 'stylegan-js';
import type { Replacement } from './intents.ts';
import type { InputRevision } from '../contracts/inputs.ts';
import type { CapabilityStatus, RouteSnapshot } from '../contracts/scheduler.ts';
import type { Input, MorphKind, Output, Progress, Refusal } from '../../shell/facade/records.ts';
import type { ActionProgress } from './progress.ts';

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
  /** Morph video size (fm-36ag); Standard when absent. */
  readonly quality?: 'standard' | 'full';
}
interface Common {
  readonly route: RouteSnapshot;
  readonly settings: MorphSettings;
}
export type OperationRequest =
  | (Common & { readonly kind: 'face'; readonly source: SourceSnapshot })
  | (Common & { readonly kind: 'morph'; readonly sources: readonly SourceSnapshot[] })
  | (Common & { readonly kind: 'faces'; readonly sources: readonly SourceSnapshot[] })
  | (Common & {
      readonly kind: 'blend';
      /** Ordered slot inputs and one weight per slot; the result is installed under `target`. */
      readonly sources: readonly SourceSnapshot[];
      readonly weights: readonly number[];
      readonly target: string;
    })
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
  | {
      readonly kind: 'morph-frames';
      readonly reason: 'over-budget' | 'invalid-settings';
      readonly message: string;
      readonly recovery: 'shorten-morph' | 'adjust-frames' | 'select-faces';
    }
  | {
      /** Two cyclically adjacent faces are the same face (defect 6); `faces` are 1-based tile numbers. */
      readonly kind: 'morph-neighbours';
      readonly slots: readonly [string, string];
      readonly faces: readonly [number, number];
      readonly message: string;
      readonly recovery: 'change-face';
    }
  | {
      /** No MP4 route on this browser: nothing is synthesised and ready faces stay saveable. */
      readonly kind: 'mp4-route';
      readonly message: string;
      readonly recovery: 'save-faces';
    }
  | {
      /** The device is offline and this job needs files that are not on it yet (defect 15). */
      readonly kind: 'offline';
      readonly message: string;
      readonly recovery: 'retry';
    }
  | {
      readonly kind: 'blend-weights';
      readonly message: string;
      readonly recovery: 'adjust-weights';
    }
  | {
      readonly kind: 'dependency';
      readonly slot: string;
      readonly message: string;
      readonly recovery: 'retry-face' | 'confirm-photo' | 'choose-supported-route' | 'edit-input';
    }
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
    | {
        readonly type: 'progress';
        readonly progress: Progress;
        /** The whole requested action's one bar, for this attempt (fm-vbj7). */
        readonly action: ActionProgress;
        /** The action's status line; a morph speaks only its frame counter and MP4 preparation. */
        readonly line: string | null;
      }
    | {
        /** Said in Morph status before frames start, e.g. the MP4 will be 512 × 512 (fm-fy2.9). */
        readonly type: 'disclosure';
        readonly text: string;
        readonly width: number;
      }
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
export type ScheduledJob = (
  | { readonly kind: 'face'; readonly id: string }
  | { readonly kind: 'morph' | 'faces' | 'import' | 'blend' }
) & { readonly phase?: 'queued' | 'compute' | 'file' };
export interface SchedulingState {
  readonly busy?: boolean;
  readonly blockedFaces?: readonly string[];
  readonly blockMorph?: boolean;
}
export interface OperationService {
  requestFace(request: Extract<OperationRequest, { kind: 'face' }>): OperationHandle;
  requestFaces(request: Extract<OperationRequest, { kind: 'faces' }>): OperationHandle;
  requestMorph(request: Extract<OperationRequest, { kind: 'morph' }>): OperationHandle;
  /** A parent intent: waits for each weighted slot's latent, then one blend synthesis; newest wins. */
  requestBlend(request: Extract<OperationRequest, { kind: 'blend' }>): OperationHandle;
  requestImport(request: Extract<OperationRequest, { kind: 'import' }>): OperationHandle;
  requestNext(jobs: readonly ScheduledJob[], state?: SchedulingState): number;
  /** Whether the provider context this route would use is available, busy or unavailable. */
  capability(route: RouteSnapshot): CapabilityStatus;
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
  if (request.kind === 'blend')
    return Object.freeze({
      ...common,
      kind: 'blend',
      sources: copied,
      weights: Object.freeze([...request.weights]),
      target: request.target,
    });
  return request.kind !== 'import'
    ? Object.freeze({ ...common, kind: request.kind, sources: copied })
    : Object.freeze({ ...common, kind: 'import', sources: copied, file: request.file });
}
