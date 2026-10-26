// Manager-loaded non-face variant: browser-model-manager acquires the AFHQ cat model and the CPU runtime
// under one grant (download, verify, store in this origin's Cache Storage), and the engine reads only through the
// manager's verified local reader, which never fetches.
import {
  createBrowserModelCache,
  type AcquisitionGrant,
  type GrantOwnerId,
} from 'browser-model-manager';
import { assetsOf, createNonFaceExample, type ExampleOptions } from './nonface.js';

const OWNER: GrantOwnerId = 'face:non-face-example';

export function createManagerLoadedExample(options: ExampleOptions) {
  return createNonFaceExample('manager-loaded', options, async (manifests, signal) => {
    const cache = await createBrowserModelCache();
    const list = assetsOf(manifests);
    const total = list.reduce((n, a) => n + a.size, 0);
    // The grant a person would have been shown: exactly these digests and bytes, for generation on the CPU.
    const grant: AcquisitionGrant = {
      manifestSha256: manifests.modelSha256,
      route: 'cpu',
      purpose: 'generate',
      owners: [OWNER],
      assets: list.map((a) => ({
        sha256: a.sha256,
        bytes: a.size,
        priority: 'foreground-required',
      })),
      remainingBytes: total,
    };
    for (const asset of list) await cache.acquire(asset, { grant, owner: OWNER, signal });
    return cache.local;
  });
}
