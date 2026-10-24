// Byte-identical import of classic's tracked autoresearch/ tree (bead fm-86u): census from Git objects,
// weight/secret scan, import that never overwrites, and the check that the import matches the digest list.
// Everything reads Git objects (`git cat-file`), never a working tree, except the exclusion digests of
// uncommitted classic edits, which are read from classic's working copy without changing it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (repo, args, opts = {}) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024, ...opts });

// Every tracked file under prefix at commit: { path, mode, oid, size, sha256, bytes }.
export function treeFiles(repo, commit, prefix) {
  const out = git(repo, ['ls-tree', '-r', '-z', '--long', commit, '--', prefix], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, type, oid, size] = meta.trim().split(/\s+/);
    if (type !== 'blob') throw new Error(`not a blob: ${path} (${type})`);
    const bytes = git(repo, ['cat-file', 'blob', oid]);
    if (bytes.length !== Number(size)) throw new Error(`size mismatch reading ${path}`);
    return { path, mode, oid, size: bytes.length, sha256: sha256(bytes), bytes };
  });
}

// --- Weight / secret scan -----------------------------------------------------------------------------

const WEIGHT_EXT = /\.(onnx|ort|safetensors|pt|pth|ckpt|h5|hdf5|gguf|tflite|pb|npy|npz|pkl|pickle|bin)$/i;
const SECRET_PATTERNS = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['llm-api-key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9_\-.=]{24,}/],
  ['assigned-secret', /(?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["'][A-Za-z0-9_\-.+/=]{24,}["']/i],
];

const isText = (bytes) => !bytes.subarray(0, 8192).includes(0);

// Hits for one file: weight-bearing formats by extension or content, large binaries, and secrets in text.
export function scanFile(path, bytes, { largeBinary = 10 * 1024 * 1024 } = {}) {
  const hits = [];
  if (WEIGHT_EXT.test(path)) hits.push({ kind: 'weight-extension', detail: path.split('.').pop() });
  const head = bytes.subarray(0, 4096);
  if (bytes.length >= 16) {
    const n = Number(bytes.readBigUInt64LE(0));
    if (n > 1 && n < bytes.length && bytes[8] === 0x7b && bytes.subarray(8, 8 + Math.min(n, 4096)).includes(Buffer.from('"dtype"'))) hits.push({ kind: 'safetensors' });
  }
  if (head.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1')) && bytes.includes(Buffer.from('data.pkl'))) hits.push({ kind: 'pytorch-zip' });
  if (head[0] === 0x80 && head[1] >= 2 && head[1] <= 5) hits.push({ kind: 'pickle' });
  if (head.subarray(0, 8).equals(Buffer.from('\x89HDF\r\n\x1a\n', 'latin1'))) hits.push({ kind: 'hdf5' });
  if (head.subarray(0, 4).equals(Buffer.from('GGUF'))) hits.push({ kind: 'gguf' });
  if (head.subarray(0, 6).equals(Buffer.from('\x93NUMPY', 'latin1'))) hits.push({ kind: 'numpy' });
  if (head[0] === 0x08 && /onnx|pytorch|tf2onnx|skl2onnx/.test(head.toString('latin1'))) hits.push({ kind: 'onnx' });
  if (isText(bytes)) {
    const text = bytes.toString('utf8');
    for (const [kind, re] of SECRET_PATTERNS) {
      const m = re.exec(text);
      if (m) hits.push({ kind, detail: `offset ${m.index}` });
    }
  } else if (bytes.length > largeBinary) hits.push({ kind: 'large-binary', detail: `${bytes.length} bytes` });
  return hits;
}

// --- Digest list ------------------------------------------------------------------------------------

// results.tsv: header columns, row count and status counts (the status column is named "status").
export function ledgerFacts(bytes) {
  const lines = bytes.toString('utf8').split('\n').filter((l) => l);
  const columns = lines[0].split('\t');
  const s = columns.indexOf('status');
  const statusCounts = {};
  for (const l of lines.slice(1)) {
    const v = l.split('\t')[s];
    statusCounts[v] = (statusCounts[v] ?? 0) + 1;
  }
  return { columns, rows: lines.length - 1, statusCounts, sha256: sha256(bytes) };
}

// Build the digest list. files: treeFiles output; overrides: path -> { disposition, owner, reason } for paths another bead already re-homed;
// uncommitted: [{ path, bytes }] classic working-copy edits not in the snapshot;
// consumers: [{ path, references }]; appendOnly: paths checked as a byte-identical prefix (ledgers that grow).
// A file with any scan hit is excluded, never imported.
export function buildDigestList({ snapshot, files, overrides = {}, uncommitted = [], consumers = [], appendOnly = [] }) {
  const tracked = new Set(files.map((f) => f.path));
  const entries = files.map((f) => {
    const base = { source: f.path, destination: f.path, mode: f.mode, size: f.size, sha256: f.sha256 };
    const hits = scanFile(f.path, f.bytes);
    if (hits.length) return { ...base, disposition: 'excluded', reason: `scan: ${hits.map((h) => h.kind).join(', ')}` };
    if (overrides[f.path]) return { ...base, ...overrides[f.path] };
    return { ...base, disposition: 'import', ...(appendOnly.includes(f.path) && { check: 'prefix' }) };
  });
  const byTop = {};
  for (const f of files) {
    const top = f.path.split('/').length > 2 ? f.path.split('/')[1] : '(root files)';
    byTop[top] ??= { files: 0, bytes: 0 };
    byTop[top].files++;
    byTop[top].bytes += f.size;
  }
  // A directory is frozen when every snapshot file under it is imported: no unlisted file may appear there.
  const frozenDirectories = Object.keys(byTop).filter((t) => t !== '(root files)')
    .filter((t) => entries.filter((e) => e.source.startsWith(`autoresearch/${t}/`)).every((e) => e.disposition === 'import'))
    .map((t) => `autoresearch/${t}/`).sort();
  const ledger = files.find((f) => f.path === 'autoresearch/results.tsv');
  return {
    bead: 'fm-86u',
    snapshot,
    census: { files: files.length, bytes: files.reduce((t, f) => t + f.size, 0), byTopLevel: byTop },
    ledger: ledger ? ledgerFacts(ledger.bytes) : null,
    scan: { scanned: files.length, hits: entries.filter((e) => e.disposition === 'excluded').map((e) => ({ path: e.source, reason: e.reason })) },
    frozenDirectories,
    files: entries,
    exclusions: [
      ...entries.filter((e) => e.disposition === 'excluded').map((e) => ({ path: e.source, kind: 'scan hit', sha256: e.sha256, size: e.size, reason: e.reason })),
      ...uncommitted.map((u) => ({
        path: u.path, kind: tracked.has(u.path) ? 'uncommitted working-copy edit (the committed version is in the snapshot)' : 'untracked working-copy file',
        sha256: sha256(u.bytes), size: u.bytes.length,
        reason: 'not in the frozen snapshot (default decided 16 October); adopted later only by explicit decision',
      })),
    ],
    consumers,
  };
}

// --- Import -----------------------------------------------------------------------------------------

// Write every `import` entry from Git objects into root. An existing identical file is left as is; an
// existing different file is never overwritten, only reported.
export function importFiles(list, { repo, commit, root }) {
  const report = { written: [], present: [], conflicts: [] };
  for (const e of list.files.filter((x) => x.disposition === 'import')) {
    const dest = join(root, e.destination);
    if (existsSync(dest)) {
      (sha256(readFileSync(dest)) === e.sha256 ? report.present : report.conflicts).push(e.destination);
      continue;
    }
    const bytes = git(repo, ['cat-file', 'blob', `${commit}:${e.source}`]);
    if (sha256(bytes) !== e.sha256) throw new Error(`snapshot object differs from the digest list: ${e.source}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    if (e.mode === '100755') chmodSync(dest, 0o755);
    report.written.push(e.destination);
  }
  return report;
}

// --- Check ------------------------------------------------------------------------------------------

// Verify the destination tree against the digest list (append-only entries by prefix). Files Git would track (tracked or untracked and
// not ignored) under a frozen directory must all be listed.
export function checkImport(list, root) {
  const problems = [];
  const imported = list.files.filter((e) => e.disposition === 'import');
  let bytes = 0;
  for (const e of imported) {
    const dest = join(root, e.destination);
    if (!existsSync(dest)) { problems.push({ kind: 'missing', path: e.destination }); continue; }
    const data = readFileSync(dest);
    // An append-only ledger keeps the snapshot bytes as its prefix; anything else must be identical.
    const kept = e.check === 'prefix' ? data.subarray(0, e.size) : data;
    if (kept.length !== e.size || (e.check !== 'prefix' && data.length !== e.size) || sha256(kept) !== e.sha256) problems.push({ kind: 'altered', path: e.destination });
    else bytes += kept.length;
    if (e.mode === '100755' && !(statSync(dest).mode & 0o100)) problems.push({ kind: 'mode', path: e.destination });
  }
  const listed = new Set(list.files.map((e) => e.destination));
  for (const dir of list.frozenDirectories) {
    if (!existsSync(join(root, dir))) continue;
    const present = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const p of present) if (!listed.has(p) && existsSync(join(root, p))) problems.push({ kind: 'unlisted', path: p });
  }
  const census = list.files.reduce((t, e) => ({ files: t.files + 1, bytes: t.bytes + e.size }), { files: 0, bytes: 0 });
  if (census.files !== list.census.files || census.bytes !== list.census.bytes) problems.push({ kind: 'census', path: '(digest list)' });
  return { ok: problems.length === 0, imported: imported.length, importedBytes: bytes, problems };
}

// --- Provenance map -----------------------------------------------------------------------------------

export const DISPOSITIONS = ['retained', 'deliberately replaced', 'historical', 'proposal', 'rejected', 'evidence unavailable'];

// Rows bead fm-86u requires, by the exact first-column text of each table in provenance.md.
export const REQUIRED_ROWS = {
  'Integrated optimisation paths': ['morph-frame pipeline', 'WGSL/direct engine', 'OPFS shard cache', 'direct RGBA media', 'compressed session', 'photo runtime', 'current media/video worker', 'native CUDA'],
  'Source invariants and phone-contract items': [
    'keyed synthesis admission receipts', '`ort-worker.mjs` `warmMapping()` overlap', 'CPU loading sequential', 'CPU synthesis 1–4 threads',
    'streamed e4e bounded, unshared, single-threaded', 'dedicated cache-only worker', 'Firefox storage-permission timing', 'no-third-party gate',
    'adapter probe before GPU acquisition', 'failure-only preference', 'visible-time watchdogs', 'worker-start vs route failure',
    'constrained worker teardown', '268,435,456-byte e4e WASM limit',
  ],
  'Negative lessons': ['no silent fp16 e4e or tolerance widening', 'realtime WebCodecs encoder settings', 'PNG sub-filtering', 'IDB durability tuning', 'abandoned integrity-marker assumptions'],
};

// Tables of a markdown document: { [section heading]: [{ cells }] } (header and divider rows dropped).
export function markdownTables(text) {
  const tables = {};
  let section = null;
  for (const line of text.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (!section || !line.startsWith('|')) continue;
    const cells = line.slice(1, line.trimEnd().endsWith('|') ? line.trimEnd().length - 1 : undefined).split(/(?<!\\)\|/).map((c) => c.trim());
    (tables[section] ??= []).push(cells);
  }
  for (const k of Object.keys(tables)) tables[k] = tables[k].slice(2); // header + divider
  return tables;
}

// Every required row present (first cell starts with its name), every cell non-empty, the last cell a known
// disposition, and the destination cell naming a bead (a check owner or the closest bead to a GAP).
export function checkProvenance(text, required = REQUIRED_ROWS) {
  const tables = markdownTables(text);
  const problems = [];
  for (const [section, names] of Object.entries(required)) {
    const rows = tables[section] ?? [];
    if (!rows.length) problems.push({ kind: 'missing-table', section });
    for (const name of names) {
      const row = rows.find((r) => r[0].startsWith(name));
      if (!row) { problems.push({ kind: 'missing-row', section, name }); continue; }
      if (row.some((c) => !c)) problems.push({ kind: 'empty-cell', section, name });
      if (!DISPOSITIONS.includes(row.at(-1))) problems.push({ kind: 'disposition', section, name, value: row.at(-1) });
      if (!/\bfm-[0-9a-z.]+\b/.test(row.at(-2))) problems.push({ kind: 'no-owner', section, name });
    }
  }
  return problems;
}
