import * as facade from '../../shell/facade/bridge.ts';
import { onSessionRefused } from '../../shell/session/retention.ts';
import { msg } from './msg.ts';
import type { Store } from './store.ts';

/** Job progress belongs to its operation handle; global consent/download events have no job owner. */
export function subscribeProgress(store: Pick<Store, 'dispatch'>): () => void {
  // A session too large to keep says so once, in the status line (fm-5hww): its faces are never dropped silently.
  const refusals = onSessionRefused((reason) => store.dispatch(msg('Notice', reason)));
  const progress = facade.subscribe((progress) => {
    if (
      progress.stage.startsWith('diagnostics-') ||
      progress.stage.startsWith('route-') ||
      progress.stage === 'photo-acquisition' ||
      progress.stage === 'photo-tools-ready'
    )
      store.dispatch(msg('Progressed', progress));
  });
  return () => {
    refusals();
    progress();
  };
}
export function subscribeDownloads(store: Pick<Store, 'dispatch'>): () => void {
  return facade.subscribeDownloads((downloads) =>
    store.dispatch(msg('DownloadsChanged', downloads)),
  );
}
