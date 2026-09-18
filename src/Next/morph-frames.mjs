/**
 * The morph-frame store: retained morph frames, persisted per morph identity so the slider
 * scrubs without regenerating (U-14) and a reload restores the morph instead of re-running
 * synthesis (C-06p). This is deliberately NOT the originals store: originals are keyed by a
 * single face's latent identity; frames are keyed by the whole morph's identity. Nothing here
 * ever reads or writes `browser/originals.mjs`.
 *
 * Two representations are stored per frame:
 *  - `canonical`: the 1024 PNG synthesis already produced, persisted byte-identical — this is
 *    what gets exported or saved, and it is the one place a PNG encode per frame is justified.
 *  - `derivative`: a display-size image (the slider's width) — what a bounded scrub decodes
 *    instead of holding every frame at 1024 (U-14).
 *
 * Failure contract: persistence is best effort and never fatal (C-06p). A device that cannot
 * open IndexedDB, or whose quota is exhausted mid-morph, degrades to memory-only for the
 * session: writes still succeed, scrubbing still works, frames are lost on reload. Only a
 * programming error (non-Blob payload) throws.
 *
 * === Contract for other agents (product-bridge, the U-14 slider) ===
 * - `frameStoreKey(morph) -> Promise<string>` — THE shared morph identity, byte-identical to
 *   product-bridge's `morphFramesKey()`:
 *   `next-frames-v1:<GEOMETRY_VERSION>:<kind>:<width>:<pinchCenter?1:0>:<framesPerSegment>:<framesPerSecond>:<sha256hex>`
 *   where the digest is over the controls' latent values concatenated in visit order as exact
 *   float32 bytes (no separators). GEOMETRY_VERSION comes from `./geometry/latent-path.mjs`,
 *   the same module product-bridge imports.
 * - `frameKey(morphKey, index) -> string` — per-frame key, `<morphKey>/<index>`.
 * - `openFrameStore(options?) -> Promise<store>` — without options the process-wide singleton
 *   backing the free functions; with `{indexedDB, maxBytes}` a private instance (tests).
 * - `frameStorePut(frameKey, canonicalBlob, derivativeBlob, totalFrames?) ->
 *   Promise<{stored, bytes}>` — `stored` is 'idb' or 'memory'. Never rejects for storage
 *   reasons. `totalFrames`, when given, lets `frameStoreGet` refuse a morph that was only
 *   partly written before a job was cancelled.
 * - `frameStoreGet(morphKey) -> Promise<Blob[] | null>` — the canonical per-frame PNGs in
 *   morph order, or null unless every frame of the morph is on this device (no partial
 *   morphs; a null means regenerate). Never rejects. This is the value behind
 *   `window.__nextFrames.get(key)`.
 * - `frameStoreGetDisplay(morphKey) -> Promise<Blob[] | null>` — the display-size derivatives
 *   in the same order, for scrubbing that keeps peak bitmap memory bounded.
 * - `frameStoreEstimateQuota() -> Promise<{usage, quota, persisted} | null>` — device quota.
 * - `frameStoreStatus() -> Promise<{mode, degraded}>` — 'persistent' | 'memory' and why it
 *   degraded, for diagnostics.
 */

import { GEOMETRY_VERSION } from './geometry/latent-path.mjs';

const DB_NAME = 'checkface-morph-frames-v1'; // Own database: never the originals store.
const DB_VERSION = 1;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024; // ~90 MB for 64 frames; two morphs fit comfortably.
const TOUCH_INTERVAL_MS = 60000; // LRU touch is throttled: scrubbing must not write per frame.
const hex = digest => Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * Canonical identity of a whole morph — the same string product-bridge's `morphFramesKey()`
 * computes, so the slider, the export path and this store agree on which retained frames
 * belong to which morph.
 */
export async function frameStoreKey(morph) {
 if (!morph?.controls?.length) throw Error('A morph with controls is required.');
 const flat = new Float32Array(morph.controls.reduce((total, control) => total + control.latent.values.length, 0));
 let at = 0;
 for (const control of morph.controls) { flat.set(control.latent.values, at); at += control.latent.values.length; }
 const digest = await crypto.subtle.digest('SHA-256', flat.buffer);
 return `next-frames-v1:${GEOMETRY_VERSION}:${morph.kind}:${morph.width}:${morph.pinchCenter ? 1 : 0}:${morph.framesPerSegment}:${morph.framesPerSecond}:${hex(digest)}`;
}

/** Per-frame key inside a morph. */
export const frameKey = (morphKey, index) => `${morphKey}/${index}`;

function openDatabase(idb) {
 return new Promise((resolve, reject) => {
  let request;
  try { request = idb.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
  request.onupgradeneeded = () => { const db = request.result;
   if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames');
   if (!db.objectStoreNames.contains('morphs')) db.createObjectStore('morphs'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || Error('IndexedDB open failed'));
  request.onblocked = () => reject(Error('IndexedDB open blocked'));
 });
}
const completed = tx => new Promise((resolve, reject) => {
 tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || Error('IndexedDB write failed'));
 tx.onabort = () => reject(tx.error || Error('IndexedDB write aborted'));
});
const requested = request => new Promise((resolve, reject) => {
 request.onsuccess = () => resolve(request.result);
 request.onerror = () => reject(request.error || Error('IndexedDB read failed'));
});
const frameIndexOf = key => Number(key.slice(key.lastIndexOf('/') + 1));

/**
 * The store itself. `mode` is 'persistent' or 'memory'; `degraded` carries the reason when
 * memory-only. Writes land in memory after any persistent failure and never fail the caller.
 */
function createStore({ indexedDB: idb = globalThis.indexedDB, maxBytes = DEFAULT_MAX_BYTES } = {}) {
 const memory = new Map(); // frameKey -> {morph, index, canonical, derivative, bytes}
 let memoryBytes = 0; // bytes currently held only in memory (degraded mode / not yet evicted)
 const memoryIndex = new Map(); // morphKey -> {bytes, lastUsed, keys, frames} for memory accounting
 const index = new Map(); // persistent mirror of the 'morphs' store: {bytes, lastUsed, keys, frames}
 let db = null, mode = 'memory', degraded = null, lastTouch = 0;
 const now = () => Date.now();
 const sum = map => { let total = 0; for (const record of map.values()) total += record.bytes; return total; };

 async function ready() {
  if (!idb) { degraded = 'IndexedDB is unavailable'; return; }
  try {
   db = await openDatabase(idb);
   for (const record of await requested(db.transaction('morphs', 'readonly').objectStore('morphs').getAll()))
    index.set(record.key, record);
   mode = 'persistent';
  } catch (error) { db = null; degraded = String(error?.stack || error); }
 }

 function degrade(error) {
  if (mode !== 'persistent') return;
  mode = 'memory'; degraded = String(error?.name || error?.message || error);
 }

 // LRU over whole morphs; the morph being written is never a victim, so a session never
 // evicts its own frames.
 async function evict(currentMorph, live, storeDelete) {
  while (sum(live) > maxBytes) {
   let victim = null;
   for (const [key, record] of live)
    if (key !== currentMorph && (!victim || record.lastUsed < victim.record.lastUsed)) victim = { key, record };
   if (!victim) return;
   live.delete(victim.key);
   if (storeDelete) try { await storeDelete(victim.record); } catch {}
   for (const key of victim.record.keys) { const hit = memory.get(key); if (hit) { memoryBytes -= hit.bytes; memory.delete(key); } }
   memoryIndex.delete(victim.key);
  }
 }

 function recordFor(map, morphKey) {
  return map.get(morphKey) || { key: morphKey, bytes: 0, lastUsed: 0, keys: [], frames: null };
 }

 function rememberMemory(key, morphKey, canonical, derivative, bytes) {
  memory.set(key, { morph: morphKey, index: frameIndexOf(key), canonical, derivative, bytes });
  memoryBytes += bytes;
  const record = memoryIndex.get(morphKey) || { key: morphKey, bytes: 0, lastUsed: 0, keys: [], frames: null };
  if (!record.keys.includes(key)) record.keys.push(key);
  record.bytes += bytes; record.lastUsed = now();
  memoryIndex.set(morphKey, record);
 }

 return {
  get mode() { return mode; },
  get degraded() { return degraded; },
  ready,
  /** Persist one frame. Best effort: resolves {stored:'idb'|'memory'}, never rejects for storage reasons. */
  async put(key, canonical, derivative, totalFrames = null) {
   if (!(canonical instanceof Blob) || !(derivative instanceof Blob)) throw TypeError('Frames persist as blobs (canonical and derivative).');
   const morphKey = morphKeyOf(key), bytes = canonical.size + derivative.size;
   if (mode === 'persistent') {
    try {
     const record = recordFor(index, morphKey);
     if (record.keys.includes(key)) { // Re-put of a frame already stored: replace, never double-count.
      const previous = await requested(db.transaction('frames', 'readonly').objectStore('frames').get(key));
      if (previous) record.bytes -= previous.bytes;
     } else record.keys.push(key);
     record.bytes += bytes;
     if (Number.isInteger(totalFrames) && totalFrames > 0) record.frames = totalFrames;
     record.lastUsed = now();
     const tx = db.transaction(['frames', 'morphs'], 'readwrite');
     tx.objectStore('frames').put({ morph: morphKey, index: frameIndexOf(key), canonical, derivative, bytes }, key);
     tx.objectStore('morphs').put(record, morphKey);
     await completed(tx);
     index.set(morphKey, record);
     await evict(morphKey, index, async victim => {
      const tx = db.transaction(['frames', 'morphs'], 'readwrite');
      for (const key of victim.keys) tx.objectStore('frames').delete(key);
      tx.objectStore('morphs').delete(victim.key);
      await completed(tx);
     });
     return { stored: 'idb', bytes };
    } catch (error) { degrade(error); } // QuotaExceededError and anything else: memory-only for the session.
   }
   rememberMemory(key, morphKey, canonical, derivative, bytes);
   if (Number.isInteger(totalFrames) && totalFrames > 0) memoryIndex.get(morphKey).frames = totalFrames;
   evict(morphKey, memoryIndex, null);
   return { stored: 'memory', bytes };
  },
  /** Read one frame. Memory first, then IndexedDB. Resolves undefined on any miss or read failure. */
  async get(key) {
   const hit = memory.get(key);
   if (hit) return { canonical: hit.canonical, derivative: hit.derivative, stored: 'memory' };
   if (db) {
    try {
     const record = await requested(db.transaction('frames', 'readonly').objectStore('frames').get(key));
     if (record?.morph != null) {
      if (now() - lastTouch > TOUCH_INTERVAL_MS) { lastTouch = now();
       const entry = index.get(record.morph);
       if (entry) { entry.lastUsed = now();
        try { const tx = db.transaction('morphs', 'readwrite'); tx.objectStore('morphs').put(entry, record.morph); } catch {} }
      }
      return { canonical: record.canonical, derivative: record.derivative, stored: 'idb' };
     }
    } catch {}
   }
   return undefined;
  },
  /**
   * Every canonical frame of a morph, in morph order, as {canonical, derivative} records —
   * or null unless the morph is complete (all recorded frames present and contiguous from 0).
   * A partly-written morph (job cancelled mid-run) therefore reads as null: regenerate.
   */
  async getMorph(morphKey, pick = 'canonical') {
   const keys = new Map();
   for (const record of [index.get(morphKey), memoryIndex.get(morphKey)])
    for (const key of record?.keys || []) keys.set(key, frameIndexOf(key));
   if (!keys.size) return null;
   if ([...keys.values()].some(index => !Number.isInteger(index) || index < 0)) return null;
   const ordered = [...keys.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
   if (ordered[0] !== `${morphKey}/0` || ordered.at(-1) !== `${morphKey}/${ordered.length - 1}`) return null;
   const expected = index.get(morphKey)?.frames ?? memoryIndex.get(morphKey)?.frames ?? null;
   if (expected != null && expected !== ordered.length) return null;
   const frames = await Promise.all(ordered.map(key => this.get(key)));
   if (!frames.every(Boolean)) return null;
   return Promise.all(frames.map(frame => frame[pick]));
  },
  /** Drop one whole morph (LRU eviction, or the caller replacing a morph's frames). */
  async forget(morphKey) {
   const persistent = index.get(morphKey);
   if (persistent) { index.delete(morphKey);
    if (db) try { const tx = db.transaction(['frames', 'morphs'], 'readwrite');
     for (const key of persistent.keys) tx.objectStore('frames').delete(key);
     tx.objectStore('morphs').delete(morphKey); await completed(tx); } catch {}
   }
   const inMemory = memoryIndex.get(morphKey);
   if (inMemory) { for (const key of inMemory.keys) { const hit = memory.get(key); if (hit) { memoryBytes -= hit.bytes; memory.delete(key); } } memoryIndex.delete(morphKey); }
  },
  estimateBytes() { return { persistent: sum(index), memory: sum(memoryIndex) }; },
  close() { try { db?.close(); } catch {} db = null; if (mode === 'persistent') mode = 'memory'; }
 };
}

const morphKeyOf = frameId => frameId.slice(0, frameId.lastIndexOf('/'));

let defaultStorePromise = null;
/**
 * Opens the morph-frame store. Without options this is the process-wide singleton used by the
 * free functions below; with options (tests, private instances) a fresh store is returned.
 * Never rejects: an unopenable database yields a memory-only store.
 */
export function openFrameStore(options) {
 if (options) { const store = createStore(options); return store.ready().then(() => store); }
 if (!defaultStorePromise) { const store = createStore(); defaultStorePromise = store.ready().then(() => store); }
 return defaultStorePromise;
}

/** Persist one frame (see module contract). Throws only on non-Blob payloads. */
export async function frameStorePut(frameKey, canonicalBlob, derivativeBlob, totalFrames) {
 return (await openFrameStore()).put(frameKey, canonicalBlob, derivativeBlob, totalFrames);
}
/** Canonical per-frame PNGs of a whole morph, in morph order; null unless complete. Never rejects. */
export async function frameStoreGet(morphKey) {
 try { return await (await openFrameStore()).getMorph(morphKey, 'canonical'); } catch { return null; }
}
/** Display-size derivatives of a whole morph, in morph order; for bounded-memory scrubbing. */
export async function frameStoreGetDisplay(morphKey) {
 try { return await (await openFrameStore()).getMorph(morphKey, 'derivative'); } catch { return null; }
}
/** Device storage quota, or null when the API is unavailable. */
export async function frameStoreEstimateQuota() {
 try {
  const storage = globalThis.navigator?.storage;
  const estimate = await storage?.estimate?.();
  if (!estimate) return null;
  const persisted = await storage?.persisted?.().catch(() => null);
  return { usage: estimate.usage ?? null, quota: estimate.quota ?? null, persisted: persisted ?? null };
 } catch { return null; }
}
/** How the store is currently backed, and why it degraded to memory-only. */
export async function frameStoreStatus() {
 const store = await openFrameStore();
 return { mode: store.mode, degraded: store.degraded };
}
