// browser-model-manager's moved cache from the packed declarations (fm-eulc acceptance in fm-7ge): the model
// cache factories, the shard store, the incremental SHA-256 and the verified local reader (cache.local).
import {
  createBrowserModelCache,
  createModelCache,
  createShardStore,
  openShardStore,
  Sha256,
  type BlobStore,
  type LocalReader,
  type ModelCache,
  type ShardStore,
} from '@facemorph/browser-model-manager';

export function memoryCache(store: BlobStore): { cache: ModelCache; local: LocalReader } {
  const cache = createModelCache({ store });
  const local: LocalReader = cache.local;
  const repair: false = local.allowRepair;
  void repair;
  return { cache, local };
}

export const browserCache: () => Promise<ModelCache> = () =>
  createBrowserModelCache({ readOnly: true });
export const shards: typeof createShardStore = createShardStore;
export const openShards: (o: { readOnly: boolean }) => Promise<ShardStore | null> = openShardStore;

export function hex(bytes: Uint8Array): string {
  const h = new Sha256();
  h.update(bytes);
  return h.hex();
}
