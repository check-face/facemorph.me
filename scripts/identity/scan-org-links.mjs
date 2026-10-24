#!/usr/bin/env node
// Org-link scan for the organization rename (fm-a4b, plan: identity.map). Read-only.
// Searches the committed tree of each target repository (git grep on a named revision, so other
// sessions' uncommitted edits are never scanned) for `check-face`, GitHub/raw/codeload/API URLs,
// `gh -R`/`gh api repos/...` paths and workflow `uses:`, plus each local checkout's origin remote.
// Every hit gets one class from org-link-rules.json; a hit naming a third-party owner is `external`.
// One JSON line per hit, then per-class counts. Exit 1 if any hit is unclassified, 2 on bad usage.
//   node scan-org-links.mjs [--root <dir>] [--rules <file>] [--target <repo>=<path>@<rev>]...
//   --root: directory holding the sibling checkouts named in the rules' targets (default: the
//   monorepo's parent). --target replaces the rules' target list (repeat it; `@<rev>` repeats too).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const OUR_OWNERS = ['check-face', 'facemorph-me'];
export const CLASSES = ['active-link', 'repo-name-correction', 'immutable-provenance', 'frozen-evidence', 'archived', 'native-updater', 'candidate-source', 'external'];
const NEW_OWNER = 'facemorph-me';
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

// git grep pre-filter (ERE); the JS patterns below decide what each hit is.
const GREP = 'check-face|github\\.com|githubusercontent\\.com|codeload\\.github|(^|[^A-Za-z])gh .*(-R|--repo)|repos/|uses:';

const HOST = '(?<![\\w.-])(?:https?:\\/\\/)?(?:www\\.)?(github\\.com|raw\\.githubusercontent\\.com|codeload\\.github\\.com|api\\.github\\.com|objects\\.githubusercontent\\.com)';
const PATTERNS = [
  ['url', new RegExp(`${HOST}((?:[/:][^\\s"'<>()\\[\\]\`,;|]*)?)`, 'g')],
  ['gh-repo-flag', /\bgh\b[^\n]*?\s(?:-R|--repo)[ =]['"]?([^\s'"]+)/g],
  ['api-path', /\bgh\s+api\s+(?:-\S+\s+)*['"]?\/?(repos\/[^\s'"]+)/g],
  ['uses', /^\s*-?\s*uses:\s*['"]?([^\s'"#]+)/g],
  ['org-name', /check-face(?:\/([A-Za-z0-9_.-]+))?/gi],
];

// owner/name a hit refers to; owner null when the reference is templated or has no owner part.
export function parseTarget(kind, m) {
  let owner = null;
  let name = null;
  if (kind === 'url') {
    const host = m[1].toLowerCase();
    let parts = m[2].replace(/^[/:]/, '').split(/[/?#]/);
    if (host === 'api.github.com') parts = parts[0] === 'repos' || parts[0] === 'orgs' || parts[0] === 'users' ? parts.slice(1) : [];
    [owner, name] = parts;
  } else if (kind === 'gh-repo-flag') [owner, name] = m[1].split('/');
  else if (kind === 'api-path') [, owner, name] = m[1].split('/');
  else if (kind === 'uses') {
    if (m[1].startsWith('./') || m[1].startsWith('docker://')) return null;
    [owner, name] = m[1].split('@')[0].split('/');
  } else {
    owner = 'check-face';
    name = m[1] ?? null;
  }
  name = name ? name.replace(/\.+$/, '').replace(/\.git$/, '') : null;
  return { owner: owner && LOGIN.test(owner) ? owner : null, name: name && NAME.test(name) ? name : null };
}

// All hits on one line; an org-name hit inside a URL/flag/path hit is the same reference.
export function lineHits(line, { workflow = false } = {}) {
  const hits = [];
  for (const [kind, re] of PATTERNS) {
    if (kind === 'uses' && !workflow) continue;
    for (const m of line.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (hits.some((h) => start >= h.start && end <= h.end)) continue;
      const target = parseTarget(kind, m);
      if (!target) continue;
      hits.push({ kind, start, end, hit: m[0].trim().slice(0, 200), ...target });
    }
  }
  return hits.sort((a, b) => a.start - b.start).map(({ start, end, ...h }) => h);
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function compileRules(rules) {
  return rules.map((r, index) => {
    if (!CLASSES.includes(r.class)) throw new Error(`rule ${index}: unknown class ${r.class}`);
    if (!r.disposition) throw new Error(`rule ${index}: no disposition`);
    return {
      ...r,
      index,
      pathRes: (r.paths || ['**']).map(globToRegExp),
      targetRe: r.target ? new RegExp(r.target) : null,
      lineRe: r.line ? new RegExp(r.line) : null,
    };
  });
}

// Where an active link or a repository-name correction should point after the rename.
export function rewriteTarget(hit, rule) {
  if (!['active-link', 'repo-name-correction'].includes(rule.class)) return undefined;
  if (rule.to) return rule.to;
  if (!hit.owner || !OUR_OWNERS.includes(hit.owner.toLowerCase())) return undefined;
  const name = rule.class === 'repo-name-correction' ? rule.correctName : hit.name;
  return name ? `${NEW_OWNER}/${name}` : NEW_OWNER;
}

export function classify(hit, compiled) {
  const ours = hit.owner === null || OUR_OWNERS.includes(hit.owner.toLowerCase());
  if (!ours) return { class: 'external', disposition: 'leave: third-party GitHub reference, unaffected by the organization rename', rule: 'external-owner' };
  const target = `${hit.owner ?? ''}/${hit.name ?? ''}`;
  for (const r of compiled) {
    if (r.repo && r.repo !== hit.repo) continue;
    if (!r.pathRes.some((re) => re.test(hit.file))) continue;
    if (r.targetRe && !r.targetRe.test(target)) continue;
    if (r.kind && r.kind !== hit.kind) continue;
    if (r.lineRe && !r.lineRe.test(hit.text)) continue;
    const to = rewriteTarget(hit, r);
    return { class: r.class, disposition: r.disposition, rule: r.id ?? `#${r.index}`, ...(to ? { to } : {}) };
  }
  return { class: 'unclassified', disposition: 'no rule matches: add one to org-link-rules.json before any edit', rule: null };
}

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });

export function resolveRev(path, rev) {
  for (const ref of rev === 'HEAD' ? ['HEAD'] : [`refs/remotes/origin/${rev}`, `refs/heads/${rev}`, rev]) {
    try {
      return git(path, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
    } catch {}
  }
  throw new Error(`${path}: cannot resolve ${rev}`);
}

// Hits in the committed tree at `commit`, plus the checkout's origin remote (`.git/config`).
export function scanRepo({ repo, path, rev, commit }) {
  const hits = [];
  let out = '';
  try {
    out = git(path, ['grep', '-I', '-n', '--no-color', '-E', GREP, commit]);
  } catch (e) {
    if (e.status !== 1) throw e; // 1 means no match
  }
  for (const raw of out.split('\n')) {
    if (!raw) continue;
    const m = raw.match(/^[0-9a-f]+:(.*?):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, line, text] = m;
    const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)action\.ya?ml$/.test(file);
    for (const h of lineHits(text, { workflow })) hits.push({ repo, rev, commit, file, line: Number(line), text, ...h });
  }
  let origin = '';
  try {
    origin = git(path, ['remote', 'get-url', 'origin']).trim();
  } catch {}
  if (origin) for (const h of lineHits(origin)) hits.push({ repo, rev, commit, file: '.git/config', line: 0, text: `remote.origin.url=${origin}`, ...h });
  return hits;
}

export function scan(targets, rules) {
  const compiled = compileRules(rules);
  const results = [];
  const scanned = [];
  for (const t of targets) {
    for (const rev of t.revs) {
      const commit = resolveRev(t.path, rev);
      scanned.push({ repo: t.repo, rev, commit });
      for (const h of scanRepo({ repo: t.repo, path: t.path, rev, commit })) {
        const { text, ...hit } = h;
        results.push({ ...hit, ...classify(h, compiled) });
      }
    }
  }
  const counts = Object.fromEntries([...CLASSES, 'unclassified'].map((c) => [c, 0]));
  for (const r of results) counts[r.class]++;
  return { results, counts, scanned };
}

function parseArgs(argv) {
  const opts = { root: resolve(here, '../../..'), rules: resolve(here, 'org-link-rules.json'), targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = resolve(argv[++i]);
    else if (a === '--rules') opts.rules = resolve(argv[++i]);
    else if (a === '--target') {
      const m = argv[++i]?.match(/^([^=]+)=(.+?)(?:@([^@]+))?$/);
      if (!m) throw new Error('--target wants <repo>=<path>[@<rev>]');
      const prev = opts.targets.find((t) => t.repo === m[1] && t.path === resolve(m[2]));
      if (prev) prev.revs.push(m[3] ?? 'HEAD');
      else opts.targets.push({ repo: m[1], path: resolve(m[2]), revs: [m[3] ?? 'HEAD'] });
    } else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\nusage: scan-org-links.mjs [--root <dir>] [--rules <file>] [--target <repo>=<path>@<rev>]...`);
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(opts.rules, 'utf8'));
  const targets = opts.targets.length ? opts.targets : data.targets.map((t) => ({ ...t, path: resolve(opts.root, t.dir) }));
  for (const t of targets) {
    if (!existsSync(t.path)) {
      console.error(`missing checkout for ${t.repo}: ${t.path}`);
      process.exit(2);
    }
  }
  const { results, counts, scanned } = scan(targets, data.rules);
  for (const r of results) console.log(JSON.stringify(r));
  const byRepo = {};
  for (const r of results) {
    byRepo[r.repo] ??= {};
    byRepo[r.repo][r.class] = (byRepo[r.repo][r.class] ?? 0) + 1;
  }
  console.log(JSON.stringify({ event: 'scan-done', scanned, hits: results.length, counts, byRepo }));
  process.exit(counts.unclassified ? 1 : 0);
}
