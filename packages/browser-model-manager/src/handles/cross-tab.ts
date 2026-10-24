// Deletion across tabs (fm-ffn7). Eviction respects leases in every tab (leases.ts, Web Locks). Deletion is the
// person's explicit action (clear the model cache): it removes the assets even while another tab holds them, and says
// so on a BroadcastChannel. Every other tab that listens invalidates its leases on those assets with the
// 'cross-tab-deletion' cause: its handles' pending operations settle with the typed error and release, and nothing is
// refetched. An asset that vanishes without a message (site data cleared) is caught by the next verified read.

import type { LeaseRegistry, Removable } from './leases.ts';

export const DELETION_CHANNEL = 'facemorph-model-assets-v1';

/** The BroadcastChannel surface used here, structurally. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

interface Deleted {
  readonly type: 'deleted';
  readonly sha256s: readonly string[];
}
const isDeleted = (d: unknown): d is Deleted =>
  !!d &&
  (d as Deleted).type === 'deleted' &&
  Array.isArray((d as Deleted).sha256s) &&
  (d as Deleted).sha256s.every((s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s));

/** Removes the assets from every store and tells the other tabs. Returns what it removed. */
export async function deleteAssets(
  sha256s: readonly string[],
  stores: readonly Removable[],
  channel: ChannelLike,
): Promise<string[]> {
  for (const sha of sha256s) for (const store of stores) await store.remove(sha);
  channel.postMessage({ type: 'deleted', sha256s: [...sha256s] } satisfies Deleted);
  return [...sha256s];
}

/** Invalidates this tab's leases on assets another tab deleted. Returns the unsubscribe function. */
export function listenForDeletions(channel: ChannelLike, registry: LeaseRegistry): () => void {
  const onMessage = (event: { data: unknown }) => {
    if (!isDeleted(event.data)) return;
    for (const sha of event.data.sha256s) registry.invalidate(sha, 'cross-tab-deletion');
  };
  channel.addEventListener('message', onMessage);
  return () => channel.removeEventListener('message', onMessage);
}
