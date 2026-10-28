// A picked name's published result (fm-ejwq, from folded fm-fy2.18): the canonical recovery-bearing WebP the names
// publication (scripts/names-publish, fm-e6yj) made for that exact lowercase text through the typed-name resolver.
// One shard of the result index (/names-results/<first hex of id>.json, written by scripts/names-results.mjs) names
// the file's SHA-256 and size; the file is fetched from its content address and checked against both before the
// bridge reads its recovery envelope. No model, no inference, and never a synthesized substitute: a failure is
// reported, and Generate stays the ordinary typed path.
const NAME_ORIGIN = 'https://facemorph-name-catalogue.cdilga.workers.dev';
const SCHEMA = 'facemorph.name-results/1';
const HEX64 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const shards = new Map();

const hex = (buffer) => Array.from(new Uint8Array(buffer), (x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

function shard(prefix) {
  let pending = shards.get(prefix);
  if (!pending) {
    pending = fetch(`/names-results/${prefix}.json`)
      .then((response) => {
        if (!response.ok) throw Error("This name's picture is unavailable. Check your connection and try again.");
        return response.json();
      })
      .then((data) => {
        if (data?.schema !== SCHEMA || data.origin !== NAME_ORIGIN || typeof data.results !== 'object')
          throw Error('The published names index is invalid.');
        return data;
      });
    shards.set(prefix, pending);
    pending.catch(() => shards.delete(prefix));
  }
  return pending;
}

/** The published result for `value` as a File, or null when the name has no published result. */
export async function nameResultFile(value) {
  const id = await sha256(new TextEncoder().encode(value));
  const index = await shard(id[0]);
  const entry = index.results[id];
  if (!entry) return null;
  const [digest, size] = entry;
  if (!HEX64.test(digest) || !Number.isInteger(size) || size <= 0 || size > MAX_BYTES)
    throw Error('The published names index is invalid.');
  const response = await fetch(`${NAME_ORIGIN}/results/${digest}.webp`);
  if (!response.ok) throw Error("This name's picture is unavailable. Check your connection and try again.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== size || (await sha256(bytes)) !== digest)
    throw Error("This name's picture failed its integrity check. Try again.");
  return new File([bytes], 'name-result.webp', { type: 'image/webp' });
}
