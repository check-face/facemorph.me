import type { Msg } from './msg.ts';
import type { State } from './state.ts';
import type { Effect, Transition } from './effects.ts';
import { reduce, type ControllerFacts } from './reducers/index.ts';

export interface Store {
  getState(): State;
  dispatch(message: Msg): void;
  /** Message notifications carry their type; internal runner updates have no message type. */
  subscribe(listener: (messageType?: Msg['type']) => void): () => void;
  /** Internal runner transitions use the same FIFO as messages; they can never re-enter dispatch. */
  update(transition: (state: State) => Transition): void;
  dispose(): void;
}
export interface StoreOptions {
  readonly facts?: (message: Msg, state: State) => ControllerFacts;
  readonly runEffects?: (effects: readonly Effect[], state: State, previous: State) => void;
}
/** One synchronous message/render/effect boundary at a time, including messages dispatched by listeners. */
export function createStore(initial: State, options: StoreOptions = {}): Store {
  let state = initial;
  let draining = false;
  let disposed = false;
  const queue: {
    transition: (state: State) => Transition;
    messageType: Msg['type'] | undefined;
  }[] = [];
  const listeners = new Set<(messageType?: Msg['type']) => void>();
  function update(transition: (state: State) => Transition, messageType?: Msg['type']): void {
    if (disposed) return;
    queue.push({ transition, messageType });
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !disposed) {
        const work = queue.shift()!;
        const previous = state;
        const next = work.transition(state);
        state = next.state;
        if (next.effects.length && !options.runEffects)
          throw new Error('Controller effects require an executor');
        options.runEffects?.(next.effects, state, previous);
        const currentListeners = [...listeners];
        if (state !== previous)
          for (const listener of currentListeners) {
            if (disposed) break;
            listener(work.messageType);
          }
      }
    } catch (error) {
      queue.length = 0;
      throw error;
    } finally {
      draining = false;
    }
  }
  return {
    getState: () => state,
    update,
    dispatch(message) {
      update((current) => {
        const next = reduce(message, current, options.facts?.(message, current));
        if (next === null)
          throw new Error(`Controller reducer is not implemented: ${message.type}`);
        return next;
      }, message.type);
    },
    subscribe(listener) {
      if (disposed) throw new Error('Controller store disposed');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      listeners.clear();
    },
  };
}
