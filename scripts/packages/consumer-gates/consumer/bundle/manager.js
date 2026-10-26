// The manager's browser entry through the bundler: the model cache, shard store and SHA-256.
import { createBrowserModelCache, openShardStore, Sha256 } from 'browser-model-manager';

export async function openCache() {
  const shards = await openShardStore({ readOnly: true });
  return { cache: await createBrowserModelCache({ readOnly: true, shards }), digest: new Sha256() };
}
