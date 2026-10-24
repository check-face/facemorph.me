// Pure logic of the catalogue result generator (bead fm-a40f): name identity, result-set identity, the
// resumable manifest, which rows to (re)generate, and the per-row checks. Plain values in, plain values out.
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The frozen raw-synthesis tolerance on RGBA8 output (max channel difference, 0-255), and the frozen latent
// tolerance (max absolute W+ difference) used against the independent NumPy/ONNX-CPU reference latent.
export const MAX_RGB_DIFF = 1;
export const LATENT_TOLERANCE = 0.0001;

// The candidate's derivation: value = name.toLowerCase(), id = SHA-256(value).
export function nameIdentity(name) {
  const value = name.toLowerCase();
  return { name, value, id: sha256(Buffer.from(value)) };
}

// Rows from the published catalogue.json: every row must follow the derivation rules (as names.publish
// requires) and carry its published W+ latent digest, the independent NumPy-derived reference.
export function catalogueRows(catalogue) {
  const seen = new Set();
  return catalogue.names.map((n) => {
    const d = nameIdentity(n.name);
    if (n.value !== d.value || n.id !== d.id || seen.has(d.id))
      throw new Error(`catalogue row breaks the derivation rules: ${n.id}`);
    if (!/^[0-9a-f]{64}$/.test(n.latent?.sha256 ?? ''))
      throw new Error(`catalogue row has no latent digest: ${n.id}`);
    seen.add(d.id);
    return {
      ...d,
      latentSha256: n.latent.sha256,
      modelSha256: n.latent.modelSha256,
      generationSha256: n.latent.generationSha256,
    };
  });
}

const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

// The result set: everything that makes a result's bytes valid. <set> is the first 16 hex of its digest.
export function resultSet({ manifestSha256, modelSha256, generationSha256 }) {
  const identity = {
    manifestSha256,
    modelSha256,
    generationSha256,
    image: {
      format: 'webp',
      quality: 0.8,
      envelope: 'facemorph-image-v2',
      width: 1024,
      height: 1024,
    },
  };
  const digest = sha256(Buffer.from(canonical(identity)));
  return { identity, digest, set: digest.slice(0, 16) };
}

export const resultPath = (set, id) => `results/${set}/${id}.webp`;

// manifest.jsonl: one header line, then one line per completed row (a later line for an id replaces an
// earlier one, so a regenerated row simply appends).
// A run killed mid-append can leave a truncated last line: it is dropped (its row is simply redone).
export function parseManifest(text) {
  const raw = text.split('\n').filter(Boolean);
  const lines = raw.flatMap((l, i) => {
    try {
      return [JSON.parse(l)];
    } catch (e) {
      if (i === raw.length - 1) return [];
      throw e;
    }
  });
  const header = lines.find((l) => l.kind === 'header') ?? null;
  const rows = new Map();
  for (const l of lines) if (l.kind === 'row') rows.set(l.id, l);
  return { header, rows };
}

export const headerLine = (set, extra = {}) =>
  `${JSON.stringify({ kind: 'header', bead: 'fm-a40f', resultSet: set.digest, set: set.set, identity: set.identity, ...extra })}\n`;
export const rowLine = (row) => `${JSON.stringify({ kind: 'row', ...row })}\n`;

// A row is reusable when it belongs to this result set, its checks passed (or synthesis was not sampled
// and is not required), and the file on disk still has the recorded digest. fileDigests: path -> sha256
// of the file as it is on disk (absent when missing).
export function rowValid(row, set, fileDigests, { requireSynthesis = false } = {}) {
  if (!row || row.resultSet !== set.digest) return false;
  if (row.latentCheck !== 'exact' || row.referenceLatent?.status !== 'pass') return false;
  if (
    row.synthesisCheck?.status === 'fail' ||
    (requireSynthesis && row.synthesisCheck?.status !== 'pass')
  )
    return false;
  return fileDigests[row.file] === row.fileSha256;
}

export function plan(rows, manifest, set, fileDigests, opts) {
  const reuse = [];
  const generate = [];
  for (const r of rows)
    (rowValid(manifest.rows.get(r.id), set, fileDigests, opts) ? reuse : generate).push(r);
  return { reuse, generate };
}

// Latent check: the W+ in the written file is byte-identical to what the typed-name path produced, under
// the catalogue's generation identity. Picking the name then yields exactly the typed result.
export function latentCheck({ producedSha256, envelopeSha256, generationSha256 }, row) {
  if (generationSha256 !== row.generationSha256) return 'identity-mismatch';
  return producedSha256 && producedSha256 === envelopeSha256 ? 'exact' : 'mismatch';
}

// The produced W+ against the published latent (independent NumPy Z, pinned CPU mapping): within the
// frozen latent tolerance. Runtimes differ in the last float bits (2.8e-6 measured), never more.
export function referenceLatentCheck(produced, published) {
  if (!published || produced.length !== published.length)
    return { status: 'fail', maxAbsDiff: null };
  let max = 0;
  for (let i = 0; i < produced.length; i++) {
    const d = Math.abs(produced[i] - published[i]);
    if (!(d <= max)) max = Number.isNaN(d) ? Infinity : d;
  }
  return { status: max <= LATENT_TOLERANCE ? 'pass' : 'fail', maxAbsDiff: max };
}

// Synthesis check from the reference comparison (max channel difference over every RGBA8 pixel).
export function synthesisCheck(cmp) {
  if (!cmp) return { status: 'not-checked' };
  return {
    status: cmp.maxDiff <= MAX_RGB_DIFF ? 'pass' : 'fail',
    maxRgbDiff: cmp.maxDiff,
    differingChannels: cmp.differing,
    reference: cmp.reference,
  };
}

// Which rows get the independent reference: every row, or every k-th row for a sample of n.
export function referenceRows(rows, mode) {
  if (mode === 'all') return new Set(rows.map((r) => r.id));
  if (mode === 'none') return new Set();
  const n = Number(mode);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`reference must be all, none or a sample size: ${mode}`);
  const step = Math.max(1, Math.floor(rows.length / n));
  return new Set(
    rows
      .filter((_, i) => i % step === 0)
      .slice(0, n)
      .map((r) => r.id),
  );
}

// Hosts the generator must never contact.
export const API_HOSTS = ['api.facemorph.me', 'checkface.facemorph.me'];
export const isApiHost = (host) => API_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
