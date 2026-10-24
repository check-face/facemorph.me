// Names data shapes for the static names picker (fm-zg31, plan:names.spike): build each candidate
// shape from the candidate catalogue and account its first-paint, per-pick and asset-count costs.
// Pure logic: every function takes plain values (rows, byte arrays, sizes) and returns plain values,
// so the tests call it directly. measure.mjs does the I/O and the browser runs.
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const HEX64 = /^[a-f0-9]{64}$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
export const sha256Hex = (bytes) => sha256(bytes).toString('hex');
const utf8 = (text) => Buffer.from(text, 'utf8');

// Workers Free static assets (developers.cloudflare.com/workers/platform/limits, checked 24 October 2026).
export const WORKERS_FREE = { filesPerVersion: 20000, bytesPerFile: 25 * 1024 * 1024 };

/**
 * Validate the candidate catalogue and reduce it to what is not derivable: the ordered display names.
 * Everything else must be constant or follow from the name, or this throws naming the row.
 */
export function parseCatalogue(catalogue) {
  if (!Array.isArray(catalogue?.names) || catalogue.names.length === 0) throw Error('Catalogue has no names.');
  const constants = new Map();
  const seen = new Set();
  const rows = catalogue.names.map((row, index) => {
    const { name, value, id } = row;
    if (typeof name !== 'string' || /[\n\r]/.test(name) || name !== name.trim() || !name) throw Error(`Row ${index}: unusable name.`);
    // `value` is the exact request string typed input uses. toLowerCase is locale-independent.
    if (value !== name.toLowerCase()) throw Error(`Row ${index}: value is not the lowercased name.`);
    if (!HEX64.test(id) || id !== sha256Hex(utf8(value))) throw Error(`Row ${index}: id is not SHA-256(value).`);
    if (seen.has(value)) throw Error(`Row ${index}: duplicate value.`);
    seen.add(value);
    const latent = row.latent;
    if (latent) {
      for (const key of ['size', 'space', 'modelSha256', 'generationSha256']) {
        const v = JSON.stringify(latent[key]);
        if (!constants.has(key)) constants.set(key, v);
        else if (constants.get(key) !== v) throw Error(`Row ${index}: latent ${key} is not constant.`);
      }
      if (JSON.stringify(latent.shape) !== '[18,512]') throw Error(`Row ${index}: latent shape.`);
      if (!latent.url?.endsWith(`/latent/${id}.f32`)) throw Error(`Row ${index}: latent URL does not follow from id.`);
    }
    return { name, value, id, latentSha256: latent?.sha256 ?? null };
  });
  return {
    rows,
    identity: {
      modelSha256: JSON.parse(constants.get('modelSha256') ?? 'null'),
      generationSha256: JSON.parse(constants.get('generationSha256') ?? 'null'),
      latentIdentity: catalogue.latentIdentity ?? null,
    },
  };
}

/** Names text: one display name per line, UTF-8, in grid order. The request value is name.toLowerCase(). */
export const namesText = (rows) => utf8(rows.map((r) => r.name).join('\n') + '\n');
export const namesJson = (rows) => utf8(JSON.stringify(rows.map((r) => r.name)));

/** Contiguous blocks of the names order. Row i is in shard floor(i / size). */
export function blockShards(digests, shardCount) {
  const size = Math.ceil(digests.length / shardCount);
  const shards = [];
  for (let at = 0; at < digests.length; at += size) shards.push(Buffer.concat(digests.slice(at, at + size)));
  return { size, shards };
}
export const shardOf = (index, size) => Math.floor(index / size);

/**
 * The manifest is the one small atomic pointer: published set version, model/generation identity,
 * URL scheme and the hashes that pin the other files. Values are real (from the candidate catalogue);
 * only the per-name result digests are stand-ins until names.generator produces results.
 */
export function manifest({ version, names, identity, integrity }) {
  return {
    schema: 1,
    version,
    names: { path: `names/${version}/names.txt`, sha256: sha256Hex(names), count: names.toString('utf8').split('\n').length - 1, value: 'name.toLowerCase()', id: 'sha256(value)' },
    identity,
    results: { path: `results/${identity.generationSha256.slice(0, 16)}/{id}.webp`, mime: 'image/webp', width: 1024, height: 1024, recovery: 'facemorph-image-v2' },
    previews: { path: 'previews/{id}.jpg', width: 200, height: 200, quality: 'historic-lossy' },
    integrity,
  };
}

/**
 * Integrity-hash placements for the picked name's result (plan: the 162 KB floor need not load at first paint).
 * Each returns the integrity block for the manifest plus the files a pick may fetch.
 *   header: no per-name digest; the result's own v2 envelope self-hashes (imageSha256, latentSha256)
 *           and names generationSha256/modelSha256, checked against the manifest.
 *   list:   one file of all digests in names order, fetched on the first pick; its hash is in the manifest.
 *   shards: S contiguous blocks; the manifest lists every shard hash; a pick fetches one shard.
 *   inline: the digest rides in the names file (hex after a tab), so it all loads at first paint.
 */
export function integrityPlacements(digests, shardCounts) {
  const out = [{ key: 'header', manifest: { scheme: 'result-header' }, files: [], namesSuffix: null }];
  const list = Buffer.concat(digests);
  out.push({ key: 'list', manifest: { scheme: 'digest-list', path: 'integrity/digests.bin', sha256: sha256Hex(list) }, files: [list], namesSuffix: null });
  for (const s of shardCounts) {
    const { size, shards } = blockShards(digests, s);
    out.push({ key: `shards-${s}`, manifest: { scheme: 'block-shards', size, path: 'integrity/{shard}.bin', shards: shards.map(sha256Hex) }, files: shards, namesSuffix: null });
  }
  out.push({ key: 'inline', manifest: { scheme: 'inline-hex' }, files: [], namesSuffix: digests.map((d) => d.toString('hex')) });
  return out;
}

export function namesWithSuffix(rows, suffix) {
  return utf8(rows.map((r, i) => `${r.name}\t${suffix[i]}`).join('\n') + '\n');
}

// Cloudflare compresses text on the fly; brotli quality 5 is the calibrated level (the live candidate
// catalogue's brotli body is within a few per cent of local q5; measure.mjs reports the live figure beside it).
export function wire(bytes) {
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 6 }).length,
    br: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length,
  };
}

/**
 * First-paint and pick costs of one names+integrity shape, all in wire bytes (brotli for text, raw for
 * binary digests and images, which are not compressed in transit). `resultBytes` is one result object.
 */
export function shapeCosts({ namesWire, manifestWire, placement, resultBytes, rowCount }) {
  const firstPaint = { requests: 2, bytes: namesWire + manifestWire };
  const lookup = placement.files.length === 0 ? 0 : placement.files.length === 1 ? placement.files[0].length : Math.max(...placement.files.map((f) => f.length));
  const firstPick = { requests: 1 + (lookup ? 1 : 0), bytes: resultBytes + lookup, integrityBytes: lookup };
  // A later pick reuses a cached digest list; a shard is reused only for a name in the same block.
  const laterPick = placement.key === 'list' || placement.key === 'header' || placement.key === 'inline'
    ? { requests: 1, bytes: resultBytes }
    : { requests: 2, bytes: resultBytes + lookup, note: 'same-shard picks reuse the cached shard' };
  const perNameFloor = placement.key === 'header' ? 0 : 32 * rowCount;
  return { firstPaint, firstPick, laterPick, perNameFloor };
}

// ---- Preview packaging ------------------------------------------------------------------------------

const PACK_MAGIC = utf8('FMP1');

/** Byte-exact pack: 'FMP1', u32le count, count x u32le lengths, then the files back to back. */
export function pack(files) {
  const head = Buffer.alloc(8 + 4 * files.length);
  PACK_MAGIC.copy(head, 0);
  head.writeUInt32LE(files.length, 4);
  files.forEach((f, i) => head.writeUInt32LE(f.length, 8 + 4 * i));
  return Buffer.concat([head, ...files]);
}

/** Inverse of pack (the grid page has the same logic in the browser). Returns views into `bytes`. */
export function unpack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 4)).toString('latin1') !== 'FMP1') throw Error('Not a preview pack.');
  const count = view.getUint32(4, true);
  if (8 + 4 * count > bytes.length) throw Error('Truncated pack header.');
  const out = [];
  let at = 8 + 4 * count;
  for (let i = 0; i < count; i++) {
    const n = view.getUint32(8 + 4 * i, true);
    if (at + n > bytes.length) throw Error('Truncated pack body.');
    out.push(bytes.subarray(at, at + n));
    at += n;
  }
  if (at !== bytes.length) throw Error('Trailing bytes after pack.');
  return out;
}

export function packAll(previews, size) {
  const packs = [];
  for (let at = 0; at < previews.length; at += size) packs.push(pack(previews.slice(at, at + size)));
  return packs;
}

/** Atlas grid for K tiles: the squarest exact factorisation with columns >= rows (24 -> 6 x 4), else near-square. */
export function atlasGrid(k) {
  const root = Math.ceil(Math.sqrt(k));
  for (let cols = root; cols <= 2 * root; cols++) if (k % cols === 0) return { cols, rows: k / cols };
  return { cols: root, rows: Math.ceil(k / root) };
}

// ---- Asset count ------------------------------------------------------------------------------------

/**
 * Files in one Worker version for a layout. During a model/generation change the previous result set
 * stays deployed beside the new one until clients holding the old manifest are gone, so results count twice.
 */
export function assetCount({ rowCount, integrityFiles, previewFiles, extra = 0 }) {
  const steady = 2 /* manifest + names */ + rowCount /* results */ + integrityFiles + previewFiles + extra;
  const transition = steady + rowCount + integrityFiles + 1;
  return { steady, transition, limit: WORKERS_FREE.filesPerVersion, fits: transition <= WORKERS_FREE.filesPerVersion };
}

// ---- Scroll metrics ---------------------------------------------------------------------------------

/**
 * Dropped frames from rAF timestamps: a gap of n vsync intervals drops n - 1 frames. `vsync` comes from
 * the idle period before the scroll, so a 120 Hz display is judged against 8.3 ms, not 16.7 ms.
 */
export function droppedFrames(timestamps, vsync) {
  let dropped = 0, worst = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const delta = timestamps[i] - timestamps[i - 1];
    const missed = Math.max(0, Math.round(delta / vsync) - 1);
    dropped += missed;
    worst = Math.max(worst, delta);
  }
  return { frames: Math.max(0, timestamps.length - 1), dropped, worstFrameMs: worst };
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
