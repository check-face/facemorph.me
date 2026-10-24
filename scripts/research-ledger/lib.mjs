// Research ledger, round-log and link rules (bead fm-zxj). Pure functions over bytes and strings; the
// CLI (scripts/check-research-ledger.mjs) reads Git and the file system and hands them in.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const COLUMNS = [
  'experiment_id',
  'lane',
  'device_provider',
  'workload',
  'source_hash',
  'control_ms',
  'candidate_ms',
  'correctness',
  'status',
  'evidence',
  'hypothesis',
];
/** Outcomes a new row may record (records.md); legacy rows inside the snapshot keep their own labels. */
export const OUTCOMES = ['keep', 'discard', 'crash', 'inconclusive', 'blocked'];
/** A correction row's hypothesis cell starts `corrects <experiment_id>:`. */
export const CORRECTION = /^corrects ([^\s:]+):/;
/** A round-log entry heading: `### <ISO 8601 timestamp with timezone> — <unique event ID>`. */
export const ENTRY_HEADING = /^### (\S+) — (\S+)\s*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const startsWith = (bytes, prefix) =>
  bytes.length >= prefix.length && Buffer.compare(bytes.subarray(0, prefix.length), prefix) === 0;

/**
 * results.tsv rules. head/base are Buffers (base null for a new file); snapshot {size, sha256} is the
 * handover prefix from docs/research-import/digest-list.json.
 */
export function checkLedger({ head, base, snapshot }) {
  const problems = [];
  const text = head.toString('utf8');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  else problems.push({ kind: 'no-final-newline' });
  if (lines[0] !== COLUMNS.join('\t'))
    problems.push({ kind: 'header', detail: 'the 11-column header changed' });
  if (head.length < snapshot.size || sha256(head.subarray(0, snapshot.size)) !== snapshot.sha256) {
    problems.push({
      kind: 'snapshot-prefix',
      detail: 'the handover snapshot bytes are no longer the ledger prefix',
    });
  }
  if (base && !startsWith(head, base))
    problems.push({
      kind: 'rewritten',
      detail: 'an existing row changed; append corrections as new rows',
    });
  const snapshotLines = head.subarray(0, snapshot.size).toString('utf8').split('\n').length - 1;
  const ids = new Map();
  lines.slice(1).forEach((line, i) => {
    const n = i + 2;
    const cells = line.split('\t');
    const id = cells[0];
    if (ids.has(id)) problems.push({ kind: 'duplicate-id', line: n, id });
    ids.set(id, n);
    if (n <= snapshotLines) return; // legacy rows keep their original cells and labels
    if (cells.length !== COLUMNS.length)
      problems.push({ kind: 'columns', line: n, id, detail: `${cells.length} cells` });
    if (!OUTCOMES.includes(cells[8]))
      problems.push({
        kind: 'outcome',
        line: n,
        id,
        detail: `status ${JSON.stringify(cells[8])} is not an evaluated outcome`,
      });
    const corrected = CORRECTION.exec(cells[10] ?? '')?.[1];
    if (corrected !== undefined && !(ids.has(corrected) && ids.get(corrected) < n))
      problems.push({ kind: 'correction', line: n, id, detail: `corrects unknown ${corrected}` });
  });
  return problems;
}

/** A dated round log only grows at EOF; every entry heading has a timezone-aware timestamp and a unique ID. */
export function checkLog({ path, head, base, frozen = false }) {
  const problems = [];
  if (base && !startsWith(head, base))
    problems.push({ kind: 'log-rewritten', path, detail: 'log entries only append at EOF' });
  if (frozen) return problems; // historical logs keep their own heading styles
  const seen = new Set();
  head
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.startsWith('### ')) return;
      const m = ENTRY_HEADING.exec(line);
      if (!m)
        return problems.push({
          kind: 'log-heading',
          path,
          line: i + 1,
          detail: 'expected "### <timestamp> — <event ID>"',
        });
      if (!TIMESTAMP.test(m[1]) || Number.isNaN(Date.parse(m[1])))
        problems.push({
          kind: 'log-timestamp',
          path,
          line: i + 1,
          detail: `${m[1]} is not an ISO timestamp with timezone`,
        });
      if (seen.has(m[2])) problems.push({ kind: 'log-duplicate-id', path, line: i + 1, id: m[2] });
      seen.add(m[2]);
    });
  return problems;
}

/**
 * Fork detection: classic's ledger on each branch must hold no row beyond the handover snapshot.
 * classic: [{ref, bytes|null}]; a branch without the file, or with an older prefix of it, passes.
 */
export function checkClassicFork({ classic, snapshotBytes }) {
  const problems = [];
  for (const { ref, bytes } of classic) {
    if (!bytes || startsWith(snapshotBytes, bytes)) continue;
    if (startsWith(bytes, snapshotBytes)) {
      const rows = bytes
        .subarray(snapshotBytes.length)
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t')[0]);
      problems.push({
        kind: 'classic-new-round',
        ref,
        detail: `new round in classic after the handover: ${rows.join(', ')}`,
      });
    } else
      problems.push({
        kind: 'classic-diverged',
        ref,
        detail: "classic's ledger no longer matches the handover snapshot",
      });
  }
  return problems;
}

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
/** Repository-relative path for a link into this repository on GitHub, else null. */
export function repoPathFromUrl(url, repo = 'check-face/facemorph.me') {
  const m = new RegExp(
    `^https://github\\.com/${repo.replace('.', '\\.')}/(?:blob|tree)/main/([^#?]+)`,
  ).exec(url);
  return m ? decodeURIComponent(m[1]).replace(/\/$/, '') : null;
}

/**
 * Every relative Markdown link, and every link into this repository on GitHub, must resolve.
 * files: [{path (repository-relative, or a label for an outside file), text, base? (directory links resolve
 * against; defaults to the file's own)}]; exists(path) tells whether a repository-relative path exists.
 */
export function checkLinks(files, exists) {
  const problems = [];
  for (const { path, text, base } of files) {
    for (const [, target] of text.matchAll(LINK)) {
      let resolved;
      if (/^https?:/.test(target)) resolved = repoPathFromUrl(target);
      else if (target.startsWith('#') || target.startsWith('mailto:')) resolved = null;
      else
        resolved = posix.normalize(
          posix.join(base ?? posix.dirname(path), decodeURIComponent(target.split('#')[0])),
        );
      if (resolved !== null) resolved = resolved.replace(/\/+$/, '');
      if (resolved === null || resolved === '' || resolved === '.') continue;
      if (resolved.startsWith('../') || !exists(resolved))
        problems.push({ kind: 'dead-link', path, target });
    }
  }
  return problems;
}
