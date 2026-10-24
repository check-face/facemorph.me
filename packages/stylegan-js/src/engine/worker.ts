// The engine across a worker boundary (fm-3h3w): explicit worker exports in place of the candidate's
// ort-worker.mjs self.onmessage. serveEngine() runs in the worker, over an engine it was handed;
// connectEngine() runs in the page. Only worker-messages.ts messages cross, each checked on both sides:
// plain data and typed arrays, never a function, promise or AbortSignal. A caller's signal becomes a 'cancel'
// message (the page settles 'cancelled' at once) and its timing hook becomes 'stage-timing' messages; result
// pixels are transferred, not copied.

import type { CancellationSignal } from '../contracts/capability.ts';
import type {
  MappingRequest,
  MappingResult,
  OperationIds,
  OperationSettlement,
  SynthesisRequest,
  SynthesisResult,
} from '../contracts/operations.ts';
import type { StageTimingHook } from '../contracts/timing.ts';
import {
  validateWorkerRequest,
  validateWorkerResponse,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type EngineWorkerSettlement,
} from '../contracts/worker-messages.ts';
import type { Engine } from './engine.ts';

/** A Worker, a worker's global scope or a MessagePort (the browser's or Node's). */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener?(
    type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
}

const transfers = (s: EngineWorkerSettlement): Transferable[] => {
  if (s.status !== 'completed') return [];
  const r = s.result as Partial<SynthesisResult & MappingResult>;
  const out: Transferable[] = [];
  if (r.rgba) out.push(r.rgba.buffer as ArrayBuffer);
  if (r.rawFloat) out.push(r.rawFloat.buffer as ArrayBuffer);
  return out;
};

/** Worker side: answers map/synthesize/cancel/status/dispose for `engine`. Returns a stop function. */
export function serveEngine(port: MessageEndpoint, engine: Engine): () => void {
  const controllers = new Map<string, AbortController>();
  const post = (m: EngineWorkerResponse, transfer: Transferable[] = []) => {
    validateWorkerResponse(m); // nothing leaves that the page's validator would refuse
    port.postMessage(m, transfer);
  };
  const listener = ({ data }: { readonly data: unknown }) => {
    let m: EngineWorkerRequest;
    try {
      m = validateWorkerRequest(data);
    } catch (error) {
      const id = (data as { id?: unknown } | null)?.id;
      const ids = ((data as { request?: { ids?: OperationIds } } | null)?.request?.ids ?? {
        requestId: typeof id === 'string' && id ? id : 'invalid',
        inputRevision: 0,
        attemptId: 0,
      }) as OperationIds;
      if (typeof id === 'string' && id)
        post({
          type: 'settled',
          id,
          settlement: {
            status: 'failed',
            ids,
            error: { code: 'invalid-request', message: (error as Error).message },
          },
        });
      return;
    }
    switch (m.type) {
      case 'map':
      case 'synthesize': {
        const controller = new AbortController();
        controllers.set(m.id, controller);
        const id = m.id;
        const onTiming: StageTimingHook = (event) => post({ type: 'stage-timing', id, event });
        const running: Promise<EngineWorkerSettlement> =
          m.type === 'map'
            ? engine.map(m.request, { signal: controller.signal, onTiming })
            : engine.synthesize(m.request, { signal: controller.signal, onTiming });
        void running.then((settlement) => {
          controllers.delete(id);
          post({ type: 'settled', id, settlement }, transfers(settlement));
        });
        return;
      }
      case 'cancel':
        controllers.get(m.id)?.abort();
        return;
      case 'status': {
        const g = engine.generator;
        post({
          type: 'status',
          id: m.id,
          provider: g.provider,
          busy: engine.state().running || engine.state().queued > 0,
          unsupported: g.unsupported,
        });
        return;
      }
      case 'dispose':
        void engine.dispose();
        return;
      default:
        // encode, metadata, raw images and morphs are other beads' engines; refuse them by name.
        if ('request' in m)
          post({
            type: 'settled',
            id: m.id,
            settlement: {
              status: 'failed',
              ids: (m.request as { ids: OperationIds }).ids,
              error: { code: 'unsupported', message: `${m.type} is not served by this engine` },
            },
          });
    }
  };
  port.addEventListener('message', listener);
  return () => port.removeEventListener?.('message', listener);
}

export interface EngineClient {
  map(
    request: MappingRequest,
    options?: { signal?: CancellationSignal; onTiming?: StageTimingHook },
  ): Promise<OperationSettlement<MappingResult>>;
  synthesize(
    request: SynthesisRequest,
    options?: { signal?: CancellationSignal; onTiming?: StageTimingHook },
  ): Promise<OperationSettlement<SynthesisResult>>;
  status(): Promise<Extract<EngineWorkerResponse, { type: 'status' }>>;
  dispose(): void;
  close(): void;
}

/** Page side: the engine's operations over `port`; every response is validated before it is believed. */
export function connectEngine(port: MessageEndpoint): EngineClient {
  let next = 0;
  const waiting = new Map<
    string,
    {
      settle?: (s: EngineWorkerSettlement) => void;
      status?: (m: EngineWorkerResponse) => void;
      onTiming?: StageTimingHook;
    }
  >();
  const listener = ({ data }: { readonly data: unknown }) => {
    const m = validateWorkerResponse(data);
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'stage-timing') w.onTiming?.(m.event);
    else if (m.type === 'settled') {
      waiting.delete(m.id);
      w.settle?.(m.settlement);
    } else if (m.type === 'status') {
      waiting.delete(m.id);
      w.status?.(m);
    }
  };
  port.addEventListener('message', listener);
  const send = <R>(
    type: 'map' | 'synthesize',
    request: MappingRequest | SynthesisRequest,
    options: { signal?: CancellationSignal; onTiming?: StageTimingHook } = {},
  ) =>
    new Promise<OperationSettlement<R>>((resolve) => {
      const id = `op-${++next}`;
      const { signal, onTiming } = options;
      const settle = (s: EngineWorkerSettlement) => {
        waiting.delete(id);
        signal?.removeEventListener('abort', abort);
        resolve(s as OperationSettlement<R>);
      };
      // The page settles at once: a worker inside an inference answers only when it ends.
      const abort = () => {
        port.postMessage(validateWorkerRequest({ type: 'cancel', id }));
        settle({ status: 'cancelled', ids: request.ids });
      };
      waiting.set(id, { settle, ...(onTiming ? { onTiming } : {}) });
      port.postMessage(validateWorkerRequest({ type, id, request }));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  return {
    map: (request, options) => send<MappingResult>('map', request, options),
    synthesize: (request, options) => send<SynthesisResult>('synthesize', request, options),
    status: () =>
      new Promise((resolve) => {
        const id = `status-${++next}`;
        waiting.set(id, {
          status: (m) => resolve(m as Extract<EngineWorkerResponse, { type: 'status' }>),
        });
        port.postMessage(validateWorkerRequest({ type: 'status', id }));
      }),
    dispose: () =>
      port.postMessage(validateWorkerRequest({ type: 'dispose', id: `dispose-${++next}` })),
    close: () => port.removeEventListener?.('message', listener),
  };
}
