// Stored size and Clear (fm-udut, defect 22): what the app keeps on this device for faces and sessions, and one
// Clear that removes exactly that. Counted and cleared: the IndexedDB database checkface-originals-v1 (store
// `originals`, which holds the faces and the session record last-generated-session-v2) and this tab's words.
// Kept: the slider preference (localStorage facemorph-slider-v1) and every model cache (Cache Storage, OPFS),
// which are not "your faces". Transactions use IndexedDB's default durability: the relaxed-durability variant
// (eris-it1-idb-durability-relaxed) was measured and rejected, and must not return.
import { clearWords, wordsBytes } from './session-words.ts';

export const ORIGINALS_DB = 'checkface-originals-v1';
export const ORIGINALS_STORE = 'originals';
export const SESSION_KEY = 'last-generated-session-v2';
export const KEPT_LOCAL_KEYS = ['facemorph-slider-v1'] as const;

/** Bytes of a stored value: Blobs by size, typed arrays by length, strings as UTF-8, objects recursively. */
export function valueBytes(v: unknown, seen = new Set<object>()): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return new TextEncoder().encode(v).length;
  if (typeof v === 'number' || typeof v === 'boolean') return 8;
  if (v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (typeof v !== 'object' || seen.has(v)) return 0;
  seen.add(v);
  let n = 0;
  for (const [k, x] of Object.entries(v))
    n += new TextEncoder().encode(k).length + valueBytes(x, seen);
  return n;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(ORIGINALS_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore(ORIGINALS_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export interface StoredEntry {
  readonly key: string;
  readonly bytes: number;
}

/** Every record in the originals store with its size. */
export async function storedEntries(): Promise<StoredEntry[]> {
  const db = await open();
  if (!db) return [];
  try {
    return await new Promise((resolve, reject) => {
      const out: StoredEntry[] = [];
      const cursor = db.transaction(ORIGINALS_STORE).objectStore(ORIGINALS_STORE).openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          resolve(out);
          return;
        }
        out.push({ key: String(c.key), bytes: valueBytes(c.value) });
        c.continue();
      };
    });
  } finally {
    db.close();
  }
}

export interface StorageSize {
  readonly faces: number;
  readonly session: number;
  readonly words: number;
  readonly total: number;
}

/** What Clear would free: the faces, the session record and this tab's words. */
export async function storedSize(): Promise<StorageSize> {
  const entries = await storedEntries();
  const session = entries.filter((e) => e.key === SESSION_KEY).reduce((n, e) => n + e.bytes, 0);
  const faces = entries.filter((e) => e.key !== SESSION_KEY).reduce((n, e) => n + e.bytes, 0);
  const words = wordsBytes();
  return { faces, session, words, total: faces + session + words };
}

/** Removes the faces, the session record and this tab's words; keeps preferences and model caches. */
export async function clearAppStorage(): Promise<{
  readonly records: number;
  readonly words: number;
}> {
  const db = await open();
  let records = 0;
  if (db)
    try {
      records = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(ORIGINALS_STORE, 'readwrite');
        const store = tx.objectStore(ORIGINALS_STORE);
        const count = store.count();
        let n = 0;
        count.onsuccess = () => {
          n = count.result;
          store.clear();
        };
        tx.oncomplete = () => resolve(n);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  return { records, words: clearWords() };
}

/** Deletes the given records (an eviction plan's keys) in one default-durability transaction. */
export async function deleteRecords(keys: readonly string[]): Promise<void> {
  const db = await open();
  if (!db || keys.length === 0) return db?.close();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ORIGINALS_STORE, 'readwrite');
      for (const k of keys) tx.objectStore(ORIGINALS_STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
