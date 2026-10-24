/**
 * Model bytes as one file per pinned unit (a manifest chunk, or a small unchunked asset) in the
 * Origin Private File System. Each file is the payload followed by a 48-byte trailer: magic,
 * payload length and the unit's raw SHA-256. The trailer is written last, so a write that is cut
 * short leaves no valid trailer and reads as missing, never as bytes.
 *
 * The trailer is a commit record, not a verdict. Nothing here vouches for the payload: the cache
 * digests every unit with the platform SHA-256 on every read (model-cache.ts). That is the rule
 * the durable "verified" marker broke on 19 September, when a record stored apart from the bytes
 * kept vouching for bytes that had changed underneath it (iOS 27 Safari, Android Chrome 124).
 *
 * Returns null wherever the platform cannot give us a working directory (Firefox private
 * windows, old engines, Tauri origins, denied storage); the cache then keeps Cache Storage.
 *
 * Moved from the candidate's src/Next/Assets/shard-store.mjs (classic a42829b) without behaviour change (fm-eulc).
 */
export const SHARD_DIRECTORY = 'checkface-model-shards-v1'; // Never app-versioned or age-purged.
const MAGIC = [0x43, 0x46, 0x53, 0x48, 0x41, 0x52, 0x44, 0x31]; // "CFSHARD1"
export const TRAILER_BYTES = 48;
const fromHex = (sha256: string) =>
  Uint8Array.from(sha256.match(/../g) ?? [], (byte) => parseInt(byte, 16));

export function trailer(sha256: string, size: number): Uint8Array {
  const out = new Uint8Array(TRAILER_BYTES);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setBigUint64(8, BigInt(size), true);
  out.set(fromHex(sha256), 16);
  return out;
}

export function trailerMatches(tail: Uint8Array, sha256: string, size: number): boolean {
  if (tail.byteLength !== TRAILER_BYTES) return false;
  for (let i = 0; i < 8; i++) if (tail[i] !== MAGIC[i]) return false;
  if (
    new DataView(tail.buffer, tail.byteOffset, TRAILER_BYTES).getBigUint64(8, true) !== BigInt(size)
  )
    return false;
  const expected = fromHex(sha256);
  for (let i = 0; i < 32; i++) if (tail[16 + i] !== expected[i]) return false;
  return true;
}

/** One pinned unit per file: read the payload or undefined, answer presence from size, commit, remove. */
export interface ShardStore {
  read(sha256: string, size: number): Promise<Uint8Array<ArrayBuffer> | undefined>;
  has(sha256: string, size: number): Promise<boolean>;
  write(sha256: string, bytes: Uint8Array): Promise<void>;
  remove(sha256: string): Promise<void>;
}

/** The parts of a FileSystemFileHandle the store uses (Safari's sync handles exist only in workers). */
interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable?(options: { keepExistingData: boolean }): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
  createSyncAccessHandle?(): Promise<{
    truncate(size: number): void;
    write(data: Uint8Array, options: { at: number }): number;
    flush(): void;
    close(): void;
  }>;
}
export interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

const named = (error: unknown) => (error as { name?: string } | null)?.name;

/**
 * Store over any directory handle with the OPFS shape. `read` returns the payload or undefined
 * (absent, short, uncommitted, or a trailer for different bytes); `has` answers from the file
 * size alone, without reading; `write` commits payload then trailer; `remove` drops one unit.
 */
export function createShardStore(dir: DirectoryLike): ShardStore {
  const file = async (name: string): Promise<File | undefined> => {
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (named(error) === 'NotFoundError' || named(error) === 'TypeMismatchError')
        return undefined;
      throw error;
    }
  };
  async function read(sha256: string, size: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const stored = await file(sha256);
    if (!stored || stored.size !== size + TRAILER_BYTES) return undefined;
    // Payload and trailer are read separately so the payload is an exact-length buffer: consumers
    // build typed arrays over `.buffer`, and trailing bytes there corrupted the first canary.
    // A File whose backing bytes can no longer be read (NotReadableError, seen on Android Chrome) is
    // an absent unit: the caller removes it and fetches it again, instead of failing every read.
    try {
      if (!trailerMatches(new Uint8Array(await stored.slice(size).arrayBuffer()), sha256, size))
        return undefined;
      const payload = new Uint8Array(await stored.slice(0, size).arrayBuffer());
      return payload.byteLength === size ? payload : undefined;
    } catch (error) {
      if (named(error) === 'NotReadableError' || named(error) === 'NotFoundError') return undefined;
      throw error;
    }
  }
  async function has(sha256: string, size: number): Promise<boolean> {
    try {
      return (await file(sha256))?.size === size + TRAILER_BYTES;
    } catch {
      return false;
    }
  }
  async function write(sha256: string, bytes: Uint8Array): Promise<void> {
    const handle = await dir.getFileHandle(sha256, { create: true });
    if (typeof handle.createWritable === 'function') {
      // Chrome and Firefox write to a swap file and replace the original on close(): the commit
      // is atomic already, and the trailer still marks a complete payload.
      const writable = await handle.createWritable({ keepExistingData: false });
      try {
        await writable.write(bytes);
        await writable.write(trailer(sha256, bytes.byteLength));
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
      }
      return;
    }
    // Safari before createWritable: synchronous handles, workers only. The trailer goes last and
    // the file is flushed before it is closed, so a crash part-way leaves no valid trailer.
    if (typeof handle.createSyncAccessHandle !== 'function')
      throw new Error('No OPFS write method');
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      if (access.write(bytes, { at: 0 }) !== bytes.byteLength) throw new Error('Short OPFS write');
      access.flush();
      if (
        access.write(trailer(sha256, bytes.byteLength), { at: bytes.byteLength }) !== TRAILER_BYTES
      )
        throw new Error('Short OPFS write');
      access.flush();
    } finally {
      access.close();
    }
  }
  async function remove(sha256: string): Promise<void> {
    try {
      await dir.removeEntry(sha256);
    } catch (error) {
      if (named(error) !== 'NotFoundError') throw error;
    }
  }
  return { read, has, write, remove };
}

/** The browser globals the cache reads, typed here so the package also compiles without DOM types. */
export interface BrowserGlobals {
  readonly caches?: {
    open(name: string): Promise<{
      match(key: string): Promise<Response | undefined>;
      put(key: string, response: Response): Promise<void>;
      delete(key: string): Promise<boolean>;
    }>;
  };
  readonly location?: { readonly origin: string; readonly hostname: string };
  readonly navigator?: { readonly storage?: StorageLike; readonly locks?: unknown };
}
export const browserGlobals = globalThis as unknown as BrowserGlobals;

export interface StorageLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
  getDirectory?(): Promise<{
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  }>;
}

export async function openShardStore({
  storage = browserGlobals.navigator?.storage,
  readOnly = false,
}: { storage?: StorageLike | undefined; readOnly?: boolean } = {}): Promise<ShardStore | null> {
  if (typeof storage?.getDirectory !== 'function' || !globalThis.crypto?.subtle) return null;
  try {
    const dir = await (
      await storage.getDirectory()
    ).getDirectoryHandle(SHARD_DIRECTORY, { create: true });
    const store = createShardStore(dir);
    // Inventory on the main thread must see worker-written shards even on Safari, where
    // only workers can obtain synchronous write handles. It never acquires or repairs bytes.
    if (readOnly) return store;
    // Prove a round trip before relying on it: some engines expose getDirectory and then refuse
    // writes (private modes, a main thread with only synchronous handles).
    const probe = new Uint8Array([1, 2, 3, 4]);
    const name = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('');
    await store.write(name, probe);
    const back = await store.read(name, probe.byteLength);
    await store.remove(name);
    return back && back.every((value, i) => value === probe[i]) ? store : null;
  } catch {
    return null;
  }
}
