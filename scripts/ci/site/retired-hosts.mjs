#!/usr/bin/env node
// Retired-host scan of a deploy-next/ artifact (fm-aa8, the artifact job of next-site.yml): every file is searched
// for the retired API hosts (api.facemorph.me, checkface.facemorph.me, and their subdomains) and the candidate
// branch name (candidate/next-delivery-20260916). Shared hosts that stay (facemorph.me, next.facemorph.me,
// models.facemorph.me, names.facemorph.me) are allowed. One JSON line per hit, then a summary.
//   node scripts/ci/site/retired-hosts.mjs <deploy-next> [--mode report|block] [--summary <file>]
// Mode: report-only while deploy-next/ is the pinned control (classic's own artifact, which names those hosts);
// blocking from the first monorepo build (next-site-identity.json kind 'build'), when any hit fails the job.
// --mode overrides the choice made from the identity.
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const RETIRED = [
  { name: 'api.facemorph.me', pattern: /\b(?:[a-z0-9-]+\.)*api\.facemorph\.me\b/gi },
  { name: 'checkface.facemorph.me', pattern: /\b(?:[a-z0-9-]+\.)*checkface\.facemorph\.me\b/gi },
  { name: 'candidate/next-delivery-20260916', pattern: /candidate\/next-delivery-20260916/g },
];

/** Hits of the retired names in one text: [{name, match, line}]. Allowed shared hosts never match. Pure. */
export function hits(text) {
  const out = [];
  for (const { name, pattern } of RETIRED)
    for (const m of text.matchAll(pattern))
      out.push({ name, match: m[0], line: text.slice(0, m.index).split('\n').length });
  return out;
}

/** Report-only for the pinned control, blocking for a build of this repository. Pure. */
export const modeFor = (identityKind) => (identityKind === 'control' ? 'report' : 'block');

function files(dir, root = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, root, out);
    else out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

export function scan(dir) {
  const found = [];
  for (const f of files(dir)) {
    const text = readFileSync(join(dir, f)).toString('latin1'); // byte-faithful for binaries too
    for (const h of hits(text)) found.push({ file: f, ...h });
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: 'string' },
      summary: { type: 'string' },
      identity: { type: 'string' },
    },
  });
  const dir = positionals[0] ?? 'deploy-next';
  let kind = 'build';
  try {
    kind = JSON.parse(
      readFileSync(o.identity ?? join(dir, '..', 'next-site-identity.json'), 'utf8'),
    ).kind;
  } catch {
    /* no identity: treat as this repository's build */
  }
  const mode = o.mode ?? modeFor(kind);
  const found = scan(dir);
  for (const h of found) console.log(JSON.stringify({ event: 'retired-host', ...h }));
  const total = {
    event: 'retired-host-summary',
    mode,
    identity: kind,
    hits: found.length,
    files: new Set(found.map((h) => h.file)).size,
  };
  console.log(JSON.stringify(total));
  if (o.summary)
    appendFileSync(
      o.summary,
      `### Retired-host scan (${mode === 'report' ? "report-only: the pinned control is classic's artifact" : 'blocking'})\n\n` +
        `${found.length} hit(s) in ${total.files} file(s)\n\n` +
        found.map((h) => `- \`${h.file}\`:${h.line} ${h.match}`).join('\n') +
        '\n',
    );
  process.exitCode = mode === 'block' && found.length ? 1 : 0;
}
