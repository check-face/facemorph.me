// Reported storage facts guide the download question; device names do not.
export interface DownloadStorage {
  readonly quota: number;
  readonly usage: number;
}

const nonnegative = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function knownStorage(storage: StorageEstimate | null | undefined): storage is DownloadStorage {
  return !!storage && nonnegative(storage.quota) && nonnegative(storage.usage);
}

/** Missing, incomplete or failed estimates are unknown, never evidence of insufficient storage. */
export async function readDownloadStorage(
  storage?: Partial<Pick<StorageManager, 'estimate'>> | null,
): Promise<DownloadStorage | null> {
  try {
    const estimate = await storage?.estimate?.();
    return knownStorage(estimate) ? { quota: estimate.quota, usage: estimate.usage } : null;
  } catch {
    return null;
  }
}

export function cannotKeepDownload(
  storage: StorageEstimate | null | undefined,
  bytes: number,
): boolean {
  return knownStorage(storage) && nonnegative(bytes) && storage.quota - storage.usage < bytes;
}

/** Reuse the purpose row's formatted amount verbatim. */
export function downloadStorageWarning(amount: string): string {
  return `This device may not keep the ${amount} download. The models may need to be downloaded again on each visit.`;
}
