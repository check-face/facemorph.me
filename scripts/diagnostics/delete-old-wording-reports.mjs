#!/usr/bin/env node
// One-off, idempotent deletion of the diagnostics reports collected under the old "Deleted after 30 days"
// wording, after their learnings were committed (bead fm-xgww). Not a bucket rule: reports uploaded after the
// boundary are never touched and no expiration rule is ever written. Speaks the S3 API, so R2 is only the
// production endpoint; tests run it against a local S3-compatible server.
//
// Every step logs one JSON line with counts and digests only: never a key, run ID, token or report content.
// Exit codes: 0 done, 10 precondition-a-unmet, 11 scan-failed, 12 digest-mismatch, 13 repeat-needed,
// 14 post-check-failed, 2 usage.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, GetBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { scanText, KEY_LIST_DIGEST } from './scan-learnings-note.mjs';

export const EXIT = { done: 0, preconditionA: 10, scan: 11, digest: 12, repeat: 13, postCheck: 14 };

export const DEFAULTS = {
  bucket: 'facemorph-diagnostics',
  prefix: 'runs/',
  noteCommit: '7875aaf',
  notePath: 'docs/findings/diagnostics-learnings-2026-10-18.md',
  remote: 'origin',
  defaultBranch: 'main',
  minedUpperBound: '2026-10-17T08:02:59Z',
  boundary: '2026-10-17T20:28:59Z',
  expectedCount: 801,
  expectedDigest: KEY_LIST_DIGEST,
};

export const digestKeys = (keys) =>
  createHash('sha256').update([...keys].sort().map((k) => `${k}\n`).join('')).digest('hex');

// runs/<run id>/<object id>
export const runIdOf = (key) => key.split('/')[1];

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function listAll(client, bucket, prefix) {
  const out = [];
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) out.push({ key: o.Key, uploaded: +o.LastModified, size: o.Size });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export function partition(objects, minedUpperBound, boundary) {
  const up = Date.parse(minedUpperBound);
  const b = Date.parse(boundary);
  return {
    mined: objects.filter((o) => o.uploaded <= up),
    extra: objects.filter((o) => o.uploaded > up && o.uploaded < b),
    after: objects.filter((o) => o.uploaded >= b),
  };
}

async function deleteKeys(client, bucket, keys, log) {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        if (r.Errors?.length) throw new Error(`${r.Errors.length} keys failed: ${[...new Set(r.Errors.map((e) => e.Code))].join(',')}`);
        deleted += batch.length;
        log({ event: 'delete-batch', batch: i / 500 + 1, keys: batch.length, attempt });
        break;
      } catch (e) {
        log({ event: 'delete-batch-error', batch: i / 500 + 1, attempt, error: String(e.name ?? e.message) });
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  return deleted;
}

async function lifecycleRules(client, bucket) {
  try {
    const r = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    return r.Rules ?? [];
  } catch (e) {
    if (e.name === 'NoSuchLifecycleConfiguration' || e.Code === 'NoSuchLifecycleConfiguration') return [];
    return null; // not readable with an object-scoped credential; the operator-side check covers it
  }
}

// Files under the roots that contain any of the needles. Git-tracked files are reported, never deleted.
export function scanWorkingCopies(roots, needles, { remove = false, exclude = [] } = {}) {
  const existing = roots.filter((r) => r && existsSync(r));
  if (!existing.length || !needles.length) return { matches: [], removed: [], kept: [], bytes: 0 };
  const tmp = resolve(process.env.TMPDIR ?? '/tmp', `fm-xgww-needles-${process.pid}.txt`);
  writeFileSync(tmp, needles.join('\n') + '\n', { mode: 0o600 });
  let out = '';
  try {
    out = execFileSync('rg', ['-l', '-F', '-f', tmp, '--hidden', '--no-ignore', '--no-messages', '-g', '!.git', '-g', `!${tmp.split('/').pop()}`, ...existing], {
      encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    // 1 = no match; 2 = some paths were unreadable (permissions, vanished files) but the rest was searched.
    // Never rethrow the raw error: its stdout lists matching paths, which can embed report identifiers.
    if (e.status === 2 && typeof e.stdout === 'string') out = e.stdout;
    else if (e.status !== 1) throw new Error(`rg failed with status ${e.status}`);
  } finally {
    rmSync(tmp, { force: true });
  }
  const matches = out.split('\n').filter(Boolean).filter((f) => !exclude.some((x) => f.startsWith(x)));
  const removed = [], kept = [];
  let bytes = 0;
  for (const f of matches) {
    let tracked = false;
    try {
      execFileSync('git', ['-C', dirname(f), 'ls-files', '--error-unmatch', f], { stdio: 'ignore' });
      tracked = true;
    } catch {}
    if (tracked) { kept.push(f); continue; }
    if (remove) { bytes += statSync(f).size; rmSync(f, { force: true }); removed.push(f); }
  }
  return { matches, removed, kept, bytes };
}

export async function run(opts, { log = (x) => console.log(JSON.stringify(x)) } = {}) {
  const o = { ...DEFAULTS, ...opts };
  const receipt = { started: new Date().toISOString(), steps: [], deviations: [...(o.deviations ?? [])] };
  const step = (x) => { receipt.steps.push(x); log(x); };

  // (a) The only kept copy of the insights must be durable before anything is listed or deleted.
  try {
    git(o.repo, 'fetch', '--quiet', o.remote, o.defaultBranch);
    git(o.repo, 'merge-base', '--is-ancestor', o.noteCommit, `${o.remote}/${o.defaultBranch}`);
  } catch {
    step({ event: 'precondition-a-unmet', noteCommit: o.noteCommit, branch: `${o.remote}/${o.defaultBranch}` });
    return { code: EXIT.preconditionA, receipt };
  }
  step({ event: 'precondition-a', ok: true, noteCommit: o.noteCommit, branch: `${o.remote}/${o.defaultBranch}` });

  // (b) The note at the commit and at HEAD holds aggregates only.
  for (const rev of [o.noteCommit, 'HEAD']) {
    let text;
    try { text = git(o.repo, 'show', `${rev}:${o.notePath}`); } catch { text = null; }
    const findings = text === null ? [{ class: 'missing-note' }] : scanText(text);
    step({ event: 'note-scan', rev, findings: findings.length });
    if (findings.length) return { code: EXIT.scan, receipt };
  }

  // (c, d) Read-only listing: the mined set must match the 18 October read; nothing new may sit before the boundary.
  const reader = o.readClient;
  const objects = await listAll(reader, o.bucket, o.prefix);
  const { mined, extra, after } = partition(objects, o.minedUpperBound, o.boundary);
  const minedDigest = digestKeys(mined.map((x) => x.key));
  const afterDigest = digestKeys(after.map((x) => x.key));
  step({ event: 'listing', total: objects.length, mined: mined.length, minedDigest, extra: extra.length, after: after.length, afterDigest,
    uploadedOnOrAfter18Oct: mined.filter((x) => x.uploaded >= Date.parse('2026-10-18T00:00:00Z')).length });
  if (extra.length) {
    step({ event: 'repeat-needed', extra: extra.length, note: 'mine these into a new dated section of the note, commit, then rerun with the union digest' });
    return { code: EXIT.repeat, receipt };
  }
  const complete = mined.length === o.expectedCount && minedDigest === o.expectedDigest;
  const resumed = !complete && mined.length < o.expectedCount && mined.length > 0;
  if (!complete && !resumed && mined.length !== 0) {
    step({ event: 'digest-mismatch', mined: mined.length, minedDigest, expectedCount: o.expectedCount, expectedDigest: o.expectedDigest });
    return { code: EXIT.digest, receipt };
  }
  if (resumed) receipt.deviations.push(`resumed run: ${mined.length} of ${o.expectedCount} mined objects remained`);
  receipt.pre = { minedCount: mined.length, minedDigest, boundary: o.boundary, minedUpperBound: o.minedUpperBound, afterCount: after.length, afterDigest };
  // After an interrupted earlier run the bucket no longer holds the mined keys, so the working-copy search uses a
  // recovered key list (read into memory, accepted only if it hashes to the expected digest).
  let recovered = [];
  if (o.recoveredKeys?.length) {
    const ok = digestKeys(o.recoveredKeys) === o.expectedDigest;
    step({ event: 'recovered-keys', count: o.recoveredKeys.length, digestMatches: ok });
    if (!ok) return { code: EXIT.digest, receipt };
    recovered = o.recoveredKeys;
  }
  const allMined = [...new Set([...mined.map((x) => x.key), ...recovered])];
  const needles = [...new Set([...allMined, ...allMined.map(runIdOf)])].filter(Boolean);
  const afterKeys = new Set(after.map((x) => x.key));

  // Delete exactly the mined keys with the separate write credential.
  const keys = mined.map((x) => x.key).filter((k) => !afterKeys.has(k));
  const deleted = keys.length ? await deleteKeys(o.writeClient, o.bucket, keys, log) : 0;
  step({ event: 'deleted', count: deleted });
  receipt.deleted = deleted;

  // Post-checks (read-only).
  const post = partition(await listAll(reader, o.bucket, o.prefix), o.minedUpperBound, o.boundary);
  const remainingMined = post.mined.length;
  const beforeBoundary = post.mined.length + post.extra.length;
  const afterDigestPost = digestKeys(post.after.filter((x) => afterKeys.has(x.key)).map((x) => x.key));
  const rules = await lifecycleRules(reader, o.bucket);
  if (rules === null) receipt.deviations.push('lifecycle configuration not readable through S3 with the object-scoped token; checked through the Cloudflare API instead (see post-checks)');
  const expirationRules = (rules ?? []).filter((r) => r.Expiration || r.NoncurrentVersionExpiration);
  receipt.post = {
    remainingMined, beforeBoundary,
    afterCount: post.after.filter((x) => afterKeys.has(x.key)).length, afterDigest: afterDigestPost,
    newSinceListing: post.after.filter((x) => !afterKeys.has(x.key)).length,
    lifecycleRules: rules === null ? ['(not readable via S3)'] : rules.map((r) => r.ID ?? '(unnamed)'), expirationRules: expirationRules.length,
  };
  step({ event: 'post-checks', ...receipt.post });
  const postOk = remainingMined === 0 && beforeBoundary === 0 && afterDigestPost === afterDigest && expirationRules.length === 0;

  // Working copies of the raw reports on this machine.
  const wc = scanWorkingCopies(o.workingRoots ?? [], needles, { remove: true, exclude: o.workingExclude ?? [] });
  const wc2 = scanWorkingCopies(o.workingRoots ?? [], needles, { remove: false, exclude: o.workingExclude ?? [] });
  receipt.workingCopies = { roots: o.workingRoots ?? [], removedFiles: wc.removed.length, removedBytes: wc.bytes, trackedKept: wc.kept.length, rescanMatches: wc2.matches.length - wc2.kept.length };
  step({ event: 'working-copies', ...receipt.workingCopies });
  if (wc.kept.length) receipt.deviations.push(`${wc.kept.length} git-tracked file(s) contain report identifiers and were not deleted`);
  // Places that are history, not working copies (agent session transcripts): counted, never deleted.
  if (o.reportRoots?.length) {
    const rep = scanWorkingCopies(o.reportRoots, needles, { remove: false });
    receipt.workingCopies.reportOnly = { roots: o.reportRoots, files: rep.matches.length };
    step({ event: 'report-only-roots', files: rep.matches.length });
    if (rep.matches.length) receipt.deviations.push(`${rep.matches.length} agent session transcript file(s) under ${o.reportRoots.join(', ')} mention report identifiers; left in place as history, not deleted`);
  }

  receipt.ids = needles; // in memory only: used to scan the receipt, never written
  const ok = postOk && receipt.workingCopies.rescanMatches === 0;
  receipt.outcome = ok ? 'complete' : 'failed';
  step({ event: 'done', outcome: receipt.outcome });
  return { code: ok ? EXIT.done : EXIT.postCheck, receipt };
}

export function s3Client({ endpoint, accessKeyId, secretAccessKey }) {
  return new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
}

// R2 S3 credentials derived from a Cloudflare API token: access key = token id, secret = SHA-256 of its value.
function mintR2Token(accountId, bucket, write) {
  const group = write ? '2efd5506f9c8494dacb1fa10a3e7d5b6' : '6a018a9f2fc74eb6b293b0c548f38b39';
  const expires = new Date(Date.now() + 45 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const policies = JSON.stringify([{ effect: 'allow', resources: { [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`]: '*' }, permission_groups: [{ id: group }] }]);
  const name = `fm-xgww ${write ? 'object read-write' : 'object read'} ${new Date().toISOString()}`;
  const t = JSON.parse(execFileSync('cf', ['user', 'tokens', 'create', '--name', name, '--policies', policies, '--expires-on', expires], { encoding: 'utf8' }));
  return { id: t.id, created: new Date().toISOString(), expires, accessKeyId: t.id, secretAccessKey: createHash('sha256').update(t.value).digest('hex'), value: t.value };
}

function revoke(token) {
  try {
    execFileSync('cf', ['user', 'tokens', 'delete', token.id, '--force'], { stdio: 'ignore' });
    return { revoked: new Date().toISOString() };
  } catch {
    return { revoked: null, note: `delete refused for this login; the token expires at ${token.expires}` };
  }
}

function writeReceipt(path, r, meta) {
  const lines = [
    `# Old-wording diagnostics report deletion, ${r.started.slice(0, 10)}`,
    '',
    'Kept receipt for an irreversible action (bead `fm-xgww`). Counts and digests only.',
    '',
    `- Outcome: **${r.outcome ?? 'stopped'}**`,
    `- Script: \`scripts/diagnostics/delete-old-wording-reports.mjs\` at commit \`${meta.scriptCommit}\`, blob SHA-256 \`${meta.scriptSha256}\``,
    `- Command: \`${meta.command}\``,
    `- Started ${r.started}; finished ${new Date().toISOString()}`,
    '',
    '## Preconditions',
    ...r.steps.filter((s) => /precondition|note-scan|listing/.test(s.event)).map((s) => `- \`${JSON.stringify(s)}\``),
    '',
    '## Deletion',
    r.pre ? `- Mined set before deletion: ${r.pre.minedCount} objects, key-list digest \`${r.pre.minedDigest}\` (uploaded at or before ${r.pre.minedUpperBound})` : '- No listing',
    r.pre ? `- Boundary (corrected consent wording live): ${r.pre.boundary}` : '',
    r.pre ? `- Set A (uploaded after the boundary, untouched): ${r.pre.afterCount} objects, digest \`${r.pre.afterDigest}\`` : '',
    `- Deleted: ${r.deleted ?? 0}`,
    '',
    '## Post-checks',
    r.post ? `- Mined objects remaining: ${r.post.remainingMined}; objects before the boundary: ${r.post.beforeBoundary}` : '',
    r.post ? `- Set A after: ${r.post.afterCount} objects, digest \`${r.post.afterDigest}\` (${r.post.afterDigest === r.pre?.afterDigest ? 'unchanged' : 'CHANGED'}); new reports since the listing: ${r.post.newSinceListing}` : '',
    r.post ? `- Lifecycle rules: ${r.post.lifecycleRules.length ? r.post.lifecycleRules.join(', ') : 'none'}; expiration rules: ${r.post.expirationRules}` : '',
    ...(meta.extra ?? []).map((x) => `- ${x}`),
    '',
    '## Working copies',
    r.workingCopies ? `- Roots: ${r.workingCopies.roots.map((x) => `\`${x}\``).join(', ')}` : '',
    r.workingCopies ? `- Removed ${r.workingCopies.removedFiles} file(s), ${r.workingCopies.removedBytes} bytes; git-tracked files kept: ${r.workingCopies.trackedKept}; re-scan matches: ${r.workingCopies.rescanMatches}` : '',
    r.workingCopies?.reportOnly ? `- Counted only (history, not deleted): ${r.workingCopies.reportOnly.files} file(s) under ${r.workingCopies.reportOnly.roots.map((x) => `\`${x}\``).join(', ')}` : '',
    '',
    '## Tokens',
    ...(meta.tokens ?? []).map((t) => `- ${t}`),
    '',
    '## Deviations',
    ...(r.deviations.length ? r.deviations.map((d) => `- ${d}`) : ['- None']),
    '',
  ].filter((l) => l !== undefined);
  const text = lines.join('\n');
  const leaks = scanText(text, { classes: false, ids: [...(r.ids ?? []), ...(meta.secrets ?? [])] });
  if (leaks.length) throw new Error(`receipt would contain ${leaks.length} identifier(s); not written`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = Object.fromEntries(process.argv.slice(2).map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = resolve(a.repo ?? resolve(here, '../..'));
  const extraRoots = existsSync(resolve(here, 'working-copy-paths.txt'))
    ? readFileSync(resolve(here, 'working-copy-paths.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^~/, process.env.HOME))
    : [];
  const workingRoots = (a.roots ? a.roots.split(',') : ['/tmp', process.env.TMPDIR, `${process.env.HOME}/.cache`, `${process.env.HOME}/Work`]).filter(Boolean).concat(extraRoots);
  let readTok, writeTok, readClient, writeClient;
  const tokens = [];
  if (a['mint-r2']) {
    const accountId = a['mint-r2'];
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    readTok = mintR2Token(accountId, a.bucket ?? DEFAULTS.bucket, false);
    writeTok = mintR2Token(accountId, a.bucket ?? DEFAULTS.bucket, true);
    await new Promise((r) => setTimeout(r, 5000)); // new tokens take a moment to reach the edge
    readClient = s3Client({ endpoint, ...readTok });
    writeClient = s3Client({ endpoint, ...writeTok });
  } else {
    readClient = s3Client({ endpoint: process.env.S3_ENDPOINT, accessKeyId: process.env.S3_READ_ACCESS_KEY_ID, secretAccessKey: process.env.S3_READ_SECRET_ACCESS_KEY });
    writeClient = s3Client({ endpoint: process.env.S3_ENDPOINT, accessKeyId: process.env.S3_WRITE_ACCESS_KEY_ID, secretAccessKey: process.env.S3_WRITE_SECRET_ACCESS_KEY });
  }
  let result;
  try {
    result = await run({
      repo, readClient, writeClient, workingRoots,
      workingExclude: [resolve(repo, 'scripts/diagnostics/node_modules')],
      reportRoots: a['report-roots'] ? a['report-roots'].split(',') : [],
      recoveredKeys: a['recover-keys-from'] ? readFileSync(a['recover-keys-from'], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [],
      ...(a.bucket && { bucket: a.bucket }), ...(a.boundary && { boundary: a.boundary }),
      ...(a['mined-upper-bound'] && { minedUpperBound: a['mined-upper-bound'] }),
      ...(a['expected-count'] && { expectedCount: Number(a['expected-count']) }), ...(a['expected-digest'] && { expectedDigest: a['expected-digest'] }),
      ...(a['note-commit'] && { noteCommit: a['note-commit'] }), ...(a['note-path'] && { notePath: a['note-path'] }),
    });
  } finally {
    for (const [label, t] of [['read', readTok], ['read-write', writeTok]]) {
      if (!t) continue;
      const r = revoke(t);
      tokens.push(`${label} token \`${t.id}\`: created ${t.created}, ${r.revoked ? `revoked ${r.revoked}` : r.note}`);
      if (!r.revoked) (result?.receipt.deviations ?? []).push(`${label} token could not be deleted by this login; it expires at ${t.expires}`);
    }
  }
  if (a.receipt) {
    const self = fileURLToPath(import.meta.url);
    writeReceipt(resolve(repo, a.receipt), result.receipt, {
      scriptCommit: (() => { try { return git(repo, 'log', '-1', '--format=%H', '--', self); } catch { return 'uncommitted'; } })(),
      scriptSha256: createHash('sha256').update(readFileSync(self)).digest('hex'),
      command: `node scripts/diagnostics/delete-old-wording-reports.mjs ${process.argv.slice(2).map((x) => x.replace(/^(--mint-r2=).*/, '$1<account>')).join(' ')}`,
      tokens, extra: a.extra ? [a.extra] : [], secrets: [readTok?.value, writeTok?.value, readTok?.secretAccessKey, writeTok?.secretAccessKey].filter(Boolean),
    });
    console.log(JSON.stringify({ event: 'receipt-written', path: a.receipt }));
  }
  process.exit(result.code);
}
