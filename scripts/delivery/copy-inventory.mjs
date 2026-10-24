#!/usr/bin/env node
// Retirement copy inventory (fm-8lq): every string in scripts/delivery/copy-strings.json located by file and line in
// classic's candidate source (from Git objects, never its working tree) at the frozen import revision and at the
// candidate branch head, and in this repository's shell at HEAD, with its replacement or removal and the bead that
// makes the edit. Writes inventory/retirement-copy.json (read by the candidate edit set fm-ww4 and the monorepo copy
// beads). A string the branch head or a named monorepo file does not contain fails the run: the list and the source
// have drifted. --check fails when the committed inventory differs from what the sources give now.
//   node scripts/delivery/copy-inventory.mjs [--classic <dir>] [--check]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const FROZEN = 'a42829bb0582b5a7a55ba6b1045a05861612b8a5';
export const BRANCH = 'candidate/next-delivery-20260916';

const git = (dir, ...args) => {
  const r = spawnSync('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return { status: r.status, out: r.stdout ?? '' };
};

/** Every line of `text` containing `find`: [{line, text}] (1-based, trimmed). Pure. */
export function locate(text, find) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (l.includes(find)) out.push({ line: i + 1, text: l.trim().slice(0, 400) });
  });
  return out;
}

/** The inventory entries from the string list and each source's text (null where the file is absent). Pure. */
export function inventory(list, sources) {
  const problems = [];
  const entries = list.strings.map((s) => {
    const at = (key, file) =>
      file && sources[key][file] != null ? locate(sources[key][file], s.find) : null;
    const frozen = at('frozen', s.classic);
    const head = at('head', s.classic);
    const monorepo = s.monorepo ? at('monorepo', s.monorepo) : null;
    if (!head?.length)
      problems.push(
        `${s.id}: ${JSON.stringify(s.find)} is not in ${s.classic} at the ${BRANCH} head`,
      );
    if (s.monorepo && !monorepo?.length)
      problems.push(`${s.id}: ${JSON.stringify(s.find)} is not in ${s.monorepo}`);
    const locations = [
      ...(frozen ?? []).map((l) => ({
        source: 'classic',
        revision: 'frozen',
        file: s.classic,
        ...l,
        owner: list.owners.classic,
      })),
      ...(head ?? []).map((l) => ({
        source: 'classic',
        revision: 'head',
        file: s.classic,
        ...l,
        owner: list.owners.classic,
      })),
      ...(monorepo ?? []).map((l) => ({
        source: 'monorepo',
        revision: 'HEAD',
        file: s.monorepo,
        ...l,
        owner: /FAQ/.test(s.kind) ? list.owners['monorepo-faq'] : list.owners['monorepo-help'],
      })),
    ];
    return {
      id: s.id,
      kind: s.kind,
      find: s.find,
      action: s.action,
      replacement: s.replacement,
      note: s.note,
      locations,
    };
  });
  return { entries, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const classic = resolve(
    args.includes('--classic')
      ? args[args.indexOf('--classic') + 1]
      : resolve(REPO, '../facemorph.me-classic'),
  );
  const list = JSON.parse(readFileSync(new URL('copy-strings.json', import.meta.url), 'utf8'));
  git(classic, 'fetch', '-q', 'origin', BRANCH);
  const head = git(classic, 'rev-parse', `origin/${BRANCH}`).out.trim();
  const show = (dir, rev, file) => {
    const r = git(dir, 'show', `${rev}:${file}`);
    return r.status === 0 ? r.out : null;
  };
  const files = (key) => [...new Set(list.strings.map((s) => s[key]).filter(Boolean))];
  const sources = { frozen: {}, head: {}, monorepo: {} };
  for (const f of files('classic')) {
    sources.frozen[f] = show(classic, FROZEN, f);
    sources.head[f] = show(classic, head, f);
  }
  for (const f of files('monorepo')) sources.monorepo[f] = show(REPO, 'HEAD', f);
  const { entries, problems } = inventory(list, sources);
  const out = {
    schema: 'facemorph.retirement-copy/1',
    bead: 'fm-8lq',
    generatedBy: 'scripts/delivery/copy-inventory.mjs from scripts/delivery/copy-strings.json',
    revisions: { classicFrozen: FROZEN, classicHead: head, branch: BRANCH },
    rules: list.note,
    entries,
  };
  for (const p of problems) console.log(JSON.stringify({ problem: p }));
  const target = new URL('../../inventory/retirement-copy.json', import.meta.url);
  const text = `${JSON.stringify(out, null, 2)}\n`;
  const located = entries.reduce((n, e) => n + e.locations.length, 0);
  if (args.includes('--check')) {
    const committed = JSON.parse(readFileSync(target, 'utf8'));
    // A newer branch head moves lines without the list changing: compare everything but the head revision's lines.
    const strip = (o) =>
      JSON.stringify({
        ...o,
        revisions: { ...o.revisions, classicHead: null },
        entries: o.entries.map((e) => ({
          ...e,
          locations: e.locations.filter((l) => l.revision !== 'head'),
        })),
      });
    const drifted = strip(committed) !== strip(out);
    console.log(
      JSON.stringify({
        summary: { strings: entries.length, located, problems: problems.length, drifted },
      }),
    );
    process.exit(problems.length || drifted ? 1 : 0);
  }
  writeFileSync(target, text);
  console.log(
    JSON.stringify({
      summary: { strings: entries.length, located, problems: problems.length, head },
    }),
  );
  process.exit(problems.length ? 1 : 0);
}
