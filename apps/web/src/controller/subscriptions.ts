import * as facade from '../../shell/facade/bridge.ts';
import { msg } from './msg.ts';
import type { Store } from './store.ts';

/** Job progress belongs to its operation handle; global consent/download events have no job owner. */
export function subscribeProgress(store: Pick<Store, 'dispatch'>): () => void {
  return facade.subscribe((progress) => {
    if (
      progress.stage.startsWith('diagnostics-') ||
      progress.stage.startsWith('route-') ||
      progress.stage === 'photo-acquisition' ||
      progress.stage === 'photo-tools-ready'
    )
      store.dispatch(msg('Progressed', progress));
  });
}
export function subscribeDownloads(store: Pick<Store, 'dispatch'>): () => void {
  return facade.subscribeDownloads((downloads) =>
    store.dispatch(msg('DownloadsChanged', downloads)),
  );
}
