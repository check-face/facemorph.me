#!/usr/bin/env node
// Regenerates the generated sections of import/allowlist.json from classic's Git objects at the frozen
// commit: `files` (every imported path with destination, sha256 and bytes), `delta` (every commit after
// the planning reference with each changed path's disposition), `listed_with_digests` and
// `working_tree_overlays`. The reviewed sections (source, rules, checks, unresolved_imports,
// delta_notes, and each file's `ported` record) are read, never written. Every tracked path must match a rule (first match wins).
//   node scripts/inventory/generate-allowlist.mjs [--classic <dir>]          rewrite the generated sections
//   node scripts/inventory/generate-allowlist.mjs --check [--classic <dir>]  exit 1 if they differ
// --check ignores working_tree_overlays: other sessions keep editing classic's working tree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST,
  blob,
  classicDir,
  delta,
  git,
  globRegExp,
  line,
  options,
  readJson,
  sha256,
  trackedFiles,
} from './lib.mjs';

export function classify(path, rules) {
  return rules.find((rule) => rule.patterns.some((p) => globRegExp(p).test(path))) ?? null;
}

// Paths that may hold credentials are listed without reading them.
const UNREAD = /(^|\/)(\.cloudflare|\.env[^/]*|\.dev\.vars|\.npmrc|credentials[^/]*)(\/|$)/;

export function overlays(dir) {
  const out = git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
  const entries = [];
  const records = out.split('\0').filter(Boolean);
  for (let i = 0; i < records.length; i++) {
    const status = records[i].slice(0, 2).trim();
    const path = records[i].slice(3);
    if (/[RC]/.test(status)) i++; // -z puts a rename's original path in the next record
    const entry = {
      path,
      status,
      disposition: 'excluded',
      reason:
        'Uncommitted classic working-tree change owned by another session; never imported or labelled as the pinned snapshot.',
    };
    if (UNREAD.test(path)) entry.digest = 'not read (may hold credentials)';
    else if (path.endsWith('/')) {
      const files = git(dir, ['ls-files', '-z', '--others', '--exclude-standard', '--', path])
        .split('\0')
        .filter(Boolean)
        .sort();
      entry.files = files.length;
      entry.sha256_of_listing = sha256(
        files.map((f) => `${sha256(readFileSync(`${dir}/${f}`))}  ${f}\n`).join(''),
      );
    } else if (status !== 'D') entry.sha256 = sha256(readFileSync(`${dir}/${path}`));
    entries.push(entry);
  }
  return entries;
}

export function generate(allowlist, dir) {
  const { frozen_commit: commit, planning_reference: reference } = allowlist.source;
  const unclassified = [];
  const files = [];
  // A file the port changed on purpose keeps its reviewed `ported` record (scripts/import/verify-closure.mjs)
  // across regeneration: it is an annotation on the generated row, like delta_notes on a delta commit.
  const ported = new Map(
    (allowlist.files ?? []).filter((f) => f.ported).map((f) => [f.destination, f.ported]),
  );
  const listed = [];
  for (const path of trackedFiles(dir, commit)) {
    const rule = classify(path, allowlist.rules);
    if (!rule) {
      unclassified.push(path);
      continue;
    }
    if (rule.disposition === 'imported' || rule.digests) {
      const bytes = blob(dir, commit, path);
      const row = { source: path, sha256: sha256(bytes), bytes: bytes.length, class: rule.class };
      if (rule.disposition === 'imported') {
        const destination = `${allowlist.destination_root}/${path}`;
        files.push({
          source: path,
          destination,
          ...row,
          ...(rule.temporary ? { temporary: true } : {}),
          ...(ported.has(destination) ? { ported: ported.get(destination) } : {}),
        });
      } else listed.push({ ...row, disposition: rule.disposition, owner: rule.owner });
    }
  }
  const commits = delta(dir, reference, commit).map((c) => ({
    commit: c.commit,
    date: c.date,
    subject: c.subject,
    note: allowlist.delta_notes[c.commit.slice(0, 7)] ?? null,
    paths: c.paths.map(({ status, path }) => {
      const rule = classify(path, allowlist.rules);
      return {
        path,
        status,
        disposition: rule?.disposition ?? null,
        ...(rule?.owner ? { owner: rule.owner } : {}),
      };
    }),
  }));
  return { unclassified, files, listed, commits };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const dir = classicDir(opts);
  const allowlist = readJson(ALLOWLIST);
  const { unclassified, files, listed, commits } = generate(allowlist, dir);
  for (const path of unclassified) line({ unclassified: path });
  const missingNotes = commits.filter((c) => !c.note).map((c) => c.commit);
  for (const commit of missingNotes) line({ delta_commit_without_note: commit });
  const unclassifiedDelta = commits.flatMap((c) =>
    c.paths.filter((p) => !p.disposition).map((p) => ({ commit: c.commit, path: p.path })),
  );
  for (const row of unclassifiedDelta) line({ delta_path_without_disposition: row });
  let drift = [];
  if (opts.check) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    drift = [
      ['files', files],
      ['delta', commits],
      ['listed_with_digests', listed],
    ]
      .filter(([k, v]) => !same(allowlist[k], v))
      .map(([k]) => k);
    for (const section of drift) line({ drift: section });
  } else {
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    const next = {
      ...allowlist,
      delta: commits,
      listed_with_digests: listed,
      working_tree_overlays: {
        recorded_on: new Date().toISOString().slice(0, 10),
        classic_head: head,
        entries: overlays(dir),
      },
      files,
    };
    writeFileSync(ALLOWLIST, JSON.stringify(next, null, 2) + '\n');
  }
  const failed =
    unclassified.length + missingNotes.length + unclassifiedDelta.length + drift.length;
  line({
    summary: {
      commit: allowlist.source.frozen_commit,
      files: files.length,
      listed_with_digests: listed.length,
      delta_commits: commits.length,
      unclassified: unclassified.length,
      drift,
      mode: opts.check ? 'check' : 'write',
    },
  });
  process.exit(failed ? 1 : 0);
}
