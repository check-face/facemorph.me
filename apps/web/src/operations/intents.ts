// Identity/revision ownership, independent of I/O and scheduling. Cancellation returns the exact job IDs to stop.
import type { InputRevision } from '../contracts/inputs.ts';
import {
  capture,
  operationIds,
  sources,
  type IntentSnapshot,
  type OperationRequest,
  type RequestId,
} from './service.ts';

interface Slot<T> {
  readonly revision: InputRevision;
  readonly verified?: { readonly revision: InputRevision; readonly value: T };
}
interface Entry {
  readonly intent: IntentSnapshot;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'superseded';
}
export interface Replacement {
  readonly id: RequestId;
  readonly kind: 'photo' | 'import';
}

let sequence = 0;
export class IntentRegistry<T> {
  private readonly slots = new Map<string, Slot<T>>();
  private readonly entries = new Map<RequestId, Entry>();
  private readonly replacements = new Map<Replacement, ReadonlyMap<string, InputRevision | null>>();
  private readonly revisions = new Map<string, InputRevision>();

  slot(slot: string): Readonly<Slot<T>> | undefined {
    return this.slots.get(slot);
  }
  status(id: RequestId): Entry['status'] | undefined {
    return this.entries.get(id)?.status;
  }

  /** Old verified pixels survive an edit/cancel; their revision is never confused with the new input. */
  revise(slot: string, revision: InputRevision): readonly RequestId[] {
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new RangeError('Invalid input revision');
    const previous = this.slots.get(slot);
    if (
      this.revisions.has(slot) &&
      (revision < this.revisions.get(slot)! ||
        (!previous && revision === this.revisions.get(slot)!))
    )
      throw new RangeError('Input revisions cannot go backwards');
    if (previous?.revision === revision) return [];
    this.revisions.set(slot, revision);
    this.slots.set(slot, {
      revision,
      ...(previous?.verified !== undefined ? { verified: previous.verified } : {}),
    });
    return this.cancelWhere((intent) =>
      sources(intent.request).some((s) => s.slot === slot && s.revision !== revision),
    );
  }
  remove(slot: string): readonly RequestId[] {
    this.slots.delete(slot);
    return this.cancelWhere((intent) => sources(intent.request).some((s) => s.slot === slot));
  }
  queue(request: OperationRequest): IntentSnapshot {
    const snapshot = capture(request);
    if (new Set(sources(snapshot).map((s) => s.slot)).size !== sources(snapshot).length)
      throw new Error('Duplicate source slot');
    for (const source of sources(snapshot)) {
      if (!Number.isSafeInteger(source.revision) || source.revision < 0)
        throw new RangeError('Invalid input revision');
      if (source.input.id !== source.slot) throw new Error('Input must belong to its target slot');
      const current = this.slots.get(source.slot);
      if (
        (!current &&
          this.revisions.has(source.slot) &&
          source.revision <= this.revisions.get(source.slot)!) ||
        (current && current.revision !== source.revision)
      )
        throw new Error(`Input changed: ${source.slot}`);
    }
    for (const source of sources(snapshot))
      if (!this.slots.has(source.slot)) this.revise(source.slot, source.revision);
    const intent = Object.freeze({ ...operationIds(++sequence), request: snapshot });
    this.entries.set(intent.requestId, { intent, status: 'queued' });
    return intent;
  }
  begin(id: RequestId): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'queued' || !this.current(entry.intent)) return false;
    entry.status = 'active';
    return true;
  }
  current(intent: IntentSnapshot): boolean {
    return sources(intent.request).every(
      (source) => this.slots.get(source.slot)?.revision === source.revision,
    );
  }
  complete(id: RequestId, verified: T): boolean {
    const entry = this.entries.get(id);
    if (!entry || !['queued', 'active'].includes(entry.status)) return false;
    if (!this.current(entry.intent)) {
      entry.status = 'superseded';
      return false;
    }
    entry.status = 'completed';
    if (entry.intent.request.kind === 'face') {
      const source = entry.intent.request.source;
      this.slots.set(source.slot, {
        revision: source.revision,
        verified: { revision: source.revision, value: verified },
      });
    }
    return true;
  }
  cancel(id: RequestId): readonly RequestId[] {
    return this.cancelWhere((intent) => intent.requestId === id);
  }
  fail(id: RequestId): void {
    const entry = this.entries.get(id);
    if (entry && (entry.status === 'queued' || entry.status === 'active')) entry.status = 'failed';
  }
  forget(id: RequestId): void {
    this.entries.delete(id);
  }
  cancelSlot(slot: string): readonly RequestId[] {
    return this.cancelWhere((intent) =>
      sources(intent.request).some((source) => source.slot === slot),
    );
  }
  /** Validation happens before this commit point. Cancelling a picker never destroys the previous result. */
  stageReplacement(kind: Replacement['kind'], slots: readonly string[]): Replacement {
    const revisions = new Map<string, InputRevision | null>();
    const targets = kind === 'import' ? [...new Set([...this.slots.keys(), ...slots])] : [...slots];
    for (const slot of targets) revisions.set(slot, this.slots.get(slot)?.revision ?? null);
    const replacement = Object.freeze({ id: operationIds(++sequence).requestId, kind });
    this.replacements.set(replacement, revisions);
    return replacement;
  }
  abandonReplacement(replacement: Replacement): void {
    this.replacements.delete(replacement);
  }
  commitReplacement(
    replacement: Replacement,
    next: readonly {
      readonly slot: string;
      readonly revision: InputRevision;
      readonly verified?: T;
    }[],
  ): readonly RequestId[] | null {
    const revisions = this.replacements.get(replacement);
    if (!revisions) return null;
    for (const [slot, revision] of revisions)
      if ((this.slots.get(slot)?.revision ?? null) !== revision) return null;
    // An import also rejects slots inserted since staging, before destroying anything.
    if (replacement.kind === 'import' && [...this.slots.keys()].some((s) => !revisions.has(s)))
      return null;
    if (new Set(next.map((s) => s.slot)).size !== next.length)
      throw new Error('Duplicate replacement slot');
    if (
      replacement.kind === 'photo' &&
      (next.length !== revisions.size || next.some((s) => !revisions.has(s.slot)))
    )
      throw new Error('Photo replacement must keep its target slots');
    for (const item of next) {
      if (
        !Number.isSafeInteger(item.revision) ||
        item.revision < 0 ||
        (this.revisions.has(item.slot) && item.revision <= this.revisions.get(item.slot)!)
      )
        throw new Error('Replacement must advance input revision');
    }
    this.replacements.delete(replacement);
    const ids = this.cancelWhere(
      (intent) =>
        replacement.kind === 'import' ||
        intent.request.kind === 'morph' ||
        sources(intent.request).some((s) => revisions.has(s.slot)),
    );
    if (replacement.kind === 'import') this.slots.clear();
    for (const item of next) {
      this.revisions.set(item.slot, item.revision);
      this.slots.set(item.slot, {
        revision: item.revision,
        ...(item.verified !== undefined
          ? { verified: { revision: item.revision, value: item.verified } }
          : {}),
      });
    }
    return ids;
  }
  clear(): void {
    this.entries.clear();
    this.slots.clear();
    this.replacements.clear();
    this.revisions.clear();
  }
  private cancelWhere(predicate: (intent: IntentSnapshot) => boolean): readonly RequestId[] {
    const ids: RequestId[] = [];
    for (const [id, entry] of this.entries) {
      if ((entry.status === 'queued' || entry.status === 'active') && predicate(entry.intent)) {
        entry.status = 'cancelled';
        ids.push(id);
      }
    }
    return ids;
  }
}
