#!/usr/bin/env node
// Package docs link test (fm-19eb): final names and cross-links resolve. Offline; reads only the working tree.
//   node scripts/packages/docs-links.mjs [--json]
// Checks, for the package READMEs, docs guides and example READMEs:
//   - every relative link resolves to a file or directory, and every #anchor to a heading in its target;
//   - each package README links to the engine, manager, host and converter READMEs and the compatibility table;
//   - no superseded package name (`@facemorph/<package>`), and any of these packages in `npm install` by its current name;
//   - each npm package.json names this repository and its directory, so npmjs.com resolves the relative links.
// Exit 0 clean, 1 findings.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NPM_PACKAGES = ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host'];
export const PACKAGES = [...NPM_PACKAGES, 'model-conv'];
export const OURS = /facemorph|stylegan|model-manager|model-host|model-conv/i;
export const REPOSITORY = /^(git\+)?https:\/\/github\.com\/facemorph-me\/facemorph\.me(\.git)?$/;
// Every package README points at the other packages and the one compatibility table.
export const CROSS_LINKS = [
  'packages/stylegan-js/README.md',
  'packages/browser-model-manager/README.md',
  'packages/cloudflare-model-host/README.md',
  'packages/model-conv/README.md',
  'packages/model-conv/docs/compatibility.md',
];

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens, duplicates numbered. */
export function anchors(markdown) {
  const seen = new Map();
  const out = new Set();
  for (const line of stripFences(markdown).split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const stripFences = (markdown) => markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '');

/** Inline Markdown links outside fenced code: [{text, target, line}]. */
export function links(markdown) {
  const out = [];
  stripFences(markdown)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line
        .replace(/`[^`]*`/g, '')
        .matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
        out.push({ target: m[1], line: i + 1 });
    });
  return out;
}

export function docFiles(root = REPO) {
  const files = [];
  for (const p of PACKAGES) {
    const dir = join(root, 'packages', p);
    if (existsSync(join(dir, 'README.md'))) files.push(join(dir, 'README.md'));
    for (const sub of ['docs']) {
      const d = join(dir, sub);
      if (existsSync(d))
        for (const f of readdirSync(d).sort()) if (f.endsWith('.md')) files.push(join(d, f));
    }
    const ex = join(dir, 'examples');
    if (existsSync(ex))
      for (const e of readdirSync(ex).sort())
        if (existsSync(join(ex, e, 'README.md'))) files.push(join(ex, e, 'README.md'));
  }
  return files;
}

export function check(root = REPO) {
  const findings = [];
  const add = (file, rule, detail) => findings.push({ file: relative(root, file), rule, detail });
  const names = Object.fromEntries(
    NPM_PACKAGES.map((p) => [
      p,
      JSON.parse(readFileSync(join(root, 'packages', p, 'package.json'), 'utf8')),
    ]),
  );
  const current = new Set(Object.values(names).map((m) => m.name));
  const files = docFiles(root);
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const { target, line } of links(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http(s), mailto: not fetched here
      checked++;
      const [path, anchor] = target.split('#');
      const dest = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      if (!dest.startsWith(root)) {
        add(file, 'outside-repository', `line ${line}: ${target}`);
        continue;
      }
      if (!existsSync(dest)) {
        add(file, 'missing-target', `line ${line}: ${target}`);
        continue;
      }
      if (anchor !== undefined) {
        if (!statSync(dest).isFile() || !dest.endsWith('.md'))
          add(file, 'anchor-on-non-markdown', `line ${line}: ${target}`);
        else if (!anchors(readFileSync(dest, 'utf8')).has(anchor))
          add(file, 'missing-anchor', `line ${line}: ${target}`);
      }
    }
    for (const p of NPM_PACKAGES)
      if (text.includes(`@facemorph/${p}`))
        add(file, 'superseded-name', `@facemorph/${p} (now ${names[p].name})`);
    for (const m of text.matchAll(/npm (?:install|i) ((?:[^\s`|;&]+ ?)+)/g))
      for (const token of m[1].trim().split(/\s+/)) {
        // Local tarballs and paths (`/tmp/pack/stylegan-js-0.0.0.tgz`) are not registry names.
        if (/\.tgz$|^[-.~/]/.test(token) || (token.includes('/') && !token.startsWith('@')))
          continue;
        // Third-party installs (typescript, a bundler) are the reader's business; a name that looks like one of
        // these packages must be the current one.
        if (OURS.test(token) && !current.has(token.replace(/(.)@[^/@]*$/, '$1')))
          add(file, 'install-name', `npm install names ${token}, not a current package name`);
      }
  }
  for (const p of PACKAGES) {
    const readme = join(root, 'packages', p, 'README.md');
    const reached = new Set(
      links(readFileSync(readme, 'utf8'))
        .filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target) && l.target.split('#')[0])
        .map((l) => {
          const dest = resolve(dirname(readme), l.target.split('#')[0]);
          return relative(
            root,
            existsSync(dest) && statSync(dest).isDirectory() ? join(dest, 'README.md') : dest,
          );
        }),
    );
    for (const want of CROSS_LINKS)
      if (want !== relative(root, readme) && !reached.has(want))
        add(readme, 'cross-link', `no link to ${want}`);
  }
  for (const p of NPM_PACKAGES) {
    const repo = names[p].repository;
    const file = join(root, 'packages', p, 'package.json');
    if (
      !repo ||
      typeof repo !== 'object' ||
      !REPOSITORY.test(repo.url ?? '') ||
      repo.directory !== `packages/${p}`
    )
      add(file, 'repository', 'repository must name this repository with directory packages/' + p);
  }
  return { files: files.map((f) => relative(root, f)), links: checked, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = check();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `docs links: ${result.files.length} files, ${result.links} relative links, ${result.findings.length} finding(s)`,
    );
    for (const f of result.findings) console.log(`  ${f.file}: ${f.rule}: ${f.detail}`);
  }
  process.exitCode = result.findings.length ? 1 : 0;
}
