/**
 * Model bytes as one file per pinned unit (a manifest chunk, or a small unchunked asset) in the
 * Origin Private File System. Each file is the payload followed by a 48-byte trailer: magic,
 * payload length and the unit's raw SHA-256. The trailer is written last, so a write that is cut
 * short leaves no valid trailer and reads as missing, never as bytes.
 *
 * The trailer is a commit record, not a verdict. Nothing here vouches for the payload: the cache
 * digests every unit with the platform SHA-256 on every read (model-cache.mjs). That is the rule
 * the durable "verified" marker broke on 19 September, when a record stored apart from the bytes
 * kept vouching for bytes that had changed underneath it (iOS 27 Safari, Android Chrome 124).
 *
 * Returns null wherever the platform cannot give us a working directory (Firefox private
 * windows, old engines, Tauri origins, denied storage); the cache then keeps Cache Storage.
 */
export const SHARD_DIRECTORY = 'checkface-model-shards-v1'; // Never app-versioned or age-purged.
const MAGIC = [0x43, 0x46, 0x53, 0x48, 0x41, 0x52, 0x44, 0x31]; // "CFSHARD1"
export const TRAILER_BYTES = 48;
const fromHex = sha256 => Uint8Array.from(sha256.match(/../g), byte => parseInt(byte, 16));

export function trailer(sha256, size) {
  const out = new Uint8Array(TRAILER_BYTES), view = new DataView(out.buffer);
  out.set(MAGIC, 0); view.setBigUint64(8, BigInt(size), true); out.set(fromHex(sha256), 16);
  return out;
}
export function trailerMatches(tail, sha256, size) {
  if (tail.byteLength !== TRAILER_BYTES) return false;
  for (let i = 0; i < 8; i++) if (tail[i] !== MAGIC[i]) return false;
  if (new DataView(tail.buffer, tail.byteOffset, TRAILER_BYTES).getBigUint64(8, true) !== BigInt(size)) return false;
  const expected = fromHex(sha256);
  for (let i = 0; i < 32; i++) if (tail[16 + i] !== expected[i]) return false;
  return true;
}

/**
 * Store over any directory handle with the OPFS shape. `read` returns the payload or undefined
 * (absent, short, uncommitted, or a trailer for different bytes); `has` answers from the file
 * size alone, without reading; `write` commits payload then trailer; `remove` drops one unit.
 */
export function createShardStore(dir) {
  const file = async name => {
    try { return await (await dir.getFileHandle(name)).getFile(); }
    catch (error) { if (error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError') return undefined; throw error; }
  };
  async function read(sha256, size) {
    const stored = await file(sha256);
    if (!stored || stored.size !== size + TRAILER_BYTES) return undefined;
    // Payload and trailer are read separately so the payload is an exact-length buffer: consumers
    // build typed arrays over `.buffer`, and trailing bytes there corrupted the first canary.
    // A File whose backing bytes can no longer be read (NotReadableError, seen on Android Chrome) is
    // an absent unit: the caller removes it and fetches it again, instead of failing every read.
    try {
      if (!trailerMatches(new Uint8Array(await stored.slice(size).arrayBuffer()), sha256, size)) return undefined;
      const payload = new Uint8Array(await stored.slice(0, size).arrayBuffer());
      return payload.byteLength === size ? payload : undefined;
    } catch (error) { if (error?.name === 'NotReadableError' || error?.name === 'NotFoundError') return undefined; throw error; }
  }
  async function has(sha256, size) {
    try { return (await file(sha256))?.size === size + TRAILER_BYTES; } catch { return false; }
  }
  async function write(sha256, bytes) {
    const handle = await dir.getFileHandle(sha256, { create: true });
    if (typeof handle.createWritable === 'function') {
      // Chrome and Firefox write to a swap file and replace the original on close(): the commit
      // is atomic already, and the trailer still marks a complete payload.
      const writable = await handle.createWritable({ keepExistingData: false });
      try { await writable.write(bytes); await writable.write(trailer(sha256, bytes.byteLength)); await writable.close(); }
      catch (error) { await writable.abort?.().catch(() => {}); throw error; }
      return;
    }
    // Safari before createWritable: synchronous handles, workers only. The trailer goes last and
    // the file is flushed before it is closed, so a crash part-way leaves no valid trailer.
    if (typeof handle.createSyncAccessHandle !== 'function') throw new Error('No OPFS write method');
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      if (access.write(bytes, { at: 0 }) !== bytes.byteLength) throw new Error('Short OPFS write');
      access.flush();
      if (access.write(trailer(sha256, bytes.byteLength), { at: bytes.byteLength }) !== TRAILER_BYTES) throw new Error('Short OPFS write');
      access.flush();
    } finally { access.close(); }
  }
  async function remove(sha256) {
    try { await dir.removeEntry(sha256); } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
  }
  return { read, has, write, remove };
}

export async function openShardStore({ storage = globalThis.navigator?.storage } = {}) {
  if (typeof storage?.getDirectory !== 'function' || !globalThis.crypto?.subtle) return null;
  try {
    const dir = await (await storage.getDirectory()).getDirectoryHandle(SHARD_DIRECTORY, { create: true });
    const store = createShardStore(dir);
    // Prove a round trip before relying on it: some engines expose getDirectory and then refuse
    // writes (private modes, a main thread with only synchronous handles).
    const probe = new Uint8Array([1, 2, 3, 4]), name = '0'.repeat(64);
    await store.write(name, probe);
    const back = await store.read(name, probe.byteLength);
    await store.remove(name);
    return back && back.every((value, i) => value === probe[i]) ? store : null;
  } catch { return null; }
}
