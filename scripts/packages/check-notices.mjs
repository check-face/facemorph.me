#!/usr/bin/env node
// Notice check (fm-oagi): the third-party material actually inside a packed tarball or the model-conv build context
// against scripts/packages/notices.json and the artifact's notice file.
//   node scripts/packages/check-notices.mjs --profile <stylegan-js|browser-model-manager|cloudflare-model-host|
//     model-conv-context> --input <tarball.tgz | build-context dir> --report <out.json> [--image <docker image>]
// A directory input is read as `docker build` sends it (.dockerignore applied).
// Findings:
// - unclaimed-third-party: a file that looks third-party and no component claims. A file looks third-party when it
//   carries a copyright or licence marker, sits under node_modules/, vendor/ or third_party/, is a LICENSE, COPYING
//   or NOTICE file below the root, or says it was ported, adapted, translated, reimplemented or vendored from
//   something other than this project's own earlier code (notices.json `ownOrigins`), or copied, extracted,
//   derived, taken or implemented from (or based on) a linked source.
// - stale-component: a component whose files are not in the artifact (the notice outlives the code).
// - notice-missing-mention: a component's or excluded runtime's `mentions` text is not in the notice file.
// - dependency-not-mentioned: a runtime dependency (installed by npm, not bundled) that is not one of this
//   repository's packages and that the notice file does not name; undeclared-bundled-dependency: a bundled
//   dependency with no component.
// - build-context only: unlisted-source (a FROM image or ADD URL in the Dockerfile with no `sources` row),
//   stale-source, unlisted-python / stale-python (requirements.lock against the `python` rows), and
//   python-licence-missing (a row's name and licence not on one line of NOTICE.md).
// - with --image: image-unlisted-python (installed in the image, no row), image-licence-mismatch (the installed
//   distribution declares a different licence from the row's `metadata`).
// Exit 0 clean, 1 findings, 2 usage error.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, dockerContextEntries } from './check-tarball-contents.mjs';

export const NOTICES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'notices.json'), 'utf8'),
);

const MARKER =
  /\bcopyright\s*(?:\(c\)|©|\d{4})|SPDX-License-Identifier|@license\b|Permission is hereby granted|Licensed under the\b|All rights reserved/i;
const VENDOR_DIR = /(?:^|\/)(?:node_modules|vendor|vendored|third_party|third-party)\//;
const NESTED_LICENCE = /\/(?:LICEN[CS]E|COPYING|NOTICE)(?:\.[\w]+)?$/i;
// Strong verbs always name an origin; weak ones ("copied from the upstream on first request") only count when the
// source they name is a link (a URL or a Markdown link).
const ORIGIN = /\b(?:ported|adapted|translated|reimplemented|vendored)\s+from\b/gi;
const WEAK_ORIGIN =
  /\b(?:copied|extracted|derived|taken|implementation|based)\s+(?:from|on)\s+(?:the\s+)?(?:[<`(]?(?:https?:\/\/|github\.com)|\[[^\]\n]+\]\()/gi;

const norm = (s) => s.toLowerCase().replace(/[_.]/g, '-');

/** Why `file` looks third-party, or null. `file`: {path, text}. */
export function thirdPartyReason(file, { noticeFile, ownOrigins }) {
  const { path, text } = file;
  if (path === noticeFile || /^(?:LICEN[CS]E|COPYING)(?:\.\w+)?$/i.test(path)) return null;
  if (VENDOR_DIR.test(path)) return 'vendored directory';
  if (NESTED_LICENCE.test(path)) return 'licence file below the root';
  if (text == null) return null;
  const marker = MARKER.exec(text);
  if (marker) return `licence marker "${marker[0]}"`;
  const own = new RegExp(ownOrigins, 'i');
  for (const m of [...text.matchAll(ORIGIN), ...text.matchAll(WEAK_ORIGIN)]) {
    // The origin is the rest of the match's line plus one following comment line (a wrapped comment).
    const window = text
      .slice(m.index, m.index + 240)
      .split('\n')
      .slice(0, 2)
      .join(' ');
    if (!own.test(window)) return `origin "${m[0].trim().slice(0, 80)}"`;
  }
  return null;
}

/** The FROM images and ADD URLs of a Dockerfile, with ARG defaults substituted. */
export function dockerfileSources(text) {
  const args = {};
  const out = [];
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const sub = (s) => s.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => args[a ?? b] ?? '');
  for (const line of lines) {
    const t = line.trim();
    let m;
    if ((m = /^ARG\s+(\w+)=(\S+)/i.exec(t))) args[m[1]] ??= m[2];
    else if ((m = /^FROM\s+(?:--\S+\s+)*(\S+)/i.exec(t))) out.push(sub(m[1]));
    else if (/^ADD\s/i.test(t)) {
      for (const w of t.split(/\s+/).slice(1)) if (/^https?:\/\//.test(sub(w))) out.push(sub(w));
    }
  }
  return out;
}

/** Package names in a pip requirements lock. */
export function lockedPython(text) {
  return [...text.matchAll(/^([A-Za-z0-9][A-Za-z0-9._-]*)==/gm)].map((m) => norm(m[1]));
}

/** {name, metadata} for every distribution installed in `image` (its licence string as notices.json records it). */
export function imagePython(image) {
  const code = `import importlib.metadata as m, json
out = []
for d in m.distributions():
    md = d.metadata
    cls = [c.split('::')[-1].strip() for c in (md.get_all('Classifier') or []) if c.startswith('License ::')]
    lic = md.get('License-Expression') or '; '.join(cls) or (md.get('License') or '').strip().splitlines()[0:1]
    out.append({'name': md['Name'], 'version': md['Version'], 'metadata': lic if isinstance(lic, str) else ''.join(lic)})
print(json.dumps(out))`;
  const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'python', image, '-c', code], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`docker run ${image}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout).map((d) => ({ ...d, name: norm(d.name) }));
}

/** Pure evaluation. files: [{path, text}] (text null for binary). */
export function evaluateNotices({ profile, files, image = null, notices = NOTICES }) {
  const spec = notices.artifacts[profile];
  const findings = [];
  const add = (rule, path, detail) => findings.push({ rule, path, detail });
  const noticeText = files.find((f) => f.path === spec.noticeFile)?.text;
  if (noticeText == null) {
    add('notice-file-missing', spec.noticeFile, 'the notice file is not in the artifact');
    return findings;
  }
  const claims = (c, path) => c.files.some((p) => new RegExp(p).test(path));
  const detected = [];
  for (const f of files) {
    const why = thirdPartyReason(f, {
      noticeFile: spec.noticeFile,
      ownOrigins: notices.ownOrigins,
    });
    if (!why) continue;
    detected.push(f.path);
    if (!spec.components.some((c) => claims(c, f.path)))
      add('unclaimed-third-party', f.path, `${why}; no component in notices.json claims it`);
  }
  for (const c of spec.components) {
    if (!files.some((f) => claims(c, f.path)))
      add('stale-component', spec.noticeFile, `${c.name}: none of its files is in the artifact`);
  }
  for (const c of [...spec.components, ...(spec.notBundled ?? [])]) {
    for (const m of c.mentions)
      if (!noticeText.includes(m))
        add(
          'notice-missing-mention',
          spec.noticeFile,
          `${c.name}: "${m}" is not in ${spec.noticeFile}`,
        );
  }
  const pj = files.find((f) => f.path === 'package.json');
  if (pj?.text) {
    const pkg = JSON.parse(pj.text);
    // npm installs dependencies separately, under their own licences; the notice must still say which they are.
    for (const d of Object.keys(pkg.dependencies ?? {}))
      if (!notices.ownPackages.includes(d) && !noticeText.includes(d))
        add(
          'dependency-not-mentioned',
          spec.noticeFile,
          `runtime dependency ${d} is not named in ${spec.noticeFile}`,
        );
    // Bundled dependencies ship inside the tarball and need a component like any other bundled code.
    for (const d of pkg.bundleDependencies ?? pkg.bundledDependencies ?? [])
      if (!spec.components.some((c) => c.npm === d))
        add(
          'undeclared-bundled-dependency',
          'package.json',
          `${d} is bundled with no component in notices.json`,
        );
  }
  if (spec.sources) {
    const dockerfile = files.find((f) => f.path === 'Dockerfile')?.text ?? '';
    const used = dockerfileSources(dockerfile);
    for (const s of used)
      if (!spec.sources.some((row) => new RegExp(row.match).test(s)))
        add('unlisted-source', 'Dockerfile', `${s} has no sources row in notices.json`);
    for (const row of spec.sources) {
      if (!used.some((s) => new RegExp(row.match).test(s)))
        add('stale-source', 'Dockerfile', `${row.name} is not used by the Dockerfile`);
      for (const m of row.mentions)
        if (!noticeText.includes(m))
          add(
            'notice-missing-mention',
            spec.noticeFile,
            `${row.name}: "${m}" is not in ${spec.noticeFile}`,
          );
    }
  }
  if (spec.python) {
    const lock = files.find((f) => f.path === 'requirements.lock')?.text ?? '';
    const locked = lockedPython(lock);
    const rows = new Map(spec.python.map((r) => [norm(r.name), r]));
    for (const n of locked)
      if (!rows.has(n)) add('unlisted-python', 'requirements.lock', `${n} has no python row`);
    for (const r of spec.python) {
      if (!r.base && !locked.includes(norm(r.name)))
        add('stale-python', 'requirements.lock', `${r.name} is not in requirements.lock`);
      const line = new RegExp(`^.*\\b${r.name.replace(/[-.]/g, '[-_.]')}\\b.*$`, 'gim');
      if (![...noticeText.matchAll(line)].some((m) => m[0].includes(r.licence)))
        add(
          'python-licence-missing',
          spec.noticeFile,
          `${r.name} (${r.licence}) is not listed on one line`,
        );
    }
    if (image) {
      for (const d of image) {
        const row = rows.get(d.name);
        if (!row)
          add(
            'image-unlisted-python',
            d.name,
            `installed in the image (${d.metadata}) with no python row`,
          );
        else if (row.metadata !== d.metadata)
          add(
            'image-licence-mismatch',
            d.name,
            `image declares "${d.metadata}", notices.json "${row.metadata}"`,
          );
      }
    }
  }
  return findings;
}

function readArtifact(input) {
  const read = (root, paths, strip) =>
    paths.map((p) => {
      const buf = readFileSync(join(root, p));
      const binary = buf.subarray(0, 8000).includes(0);
      return {
        path: strip ? p.replace(/^package\//, '') : p,
        text: binary ? null : buf.toString('utf8'),
      };
    });
  if (statSync(input).isDirectory())
    return read(
      input,
      dockerContextEntries(input)
        .filter((e) => !e.symlink)
        .map((e) => e.path),
      false,
    );
  const dir = mkdtempSync(join(tmpdir(), 'notice-check-'));
  try {
    const x = spawnSync('tar', ['-xzf', input, '-C', dir, '--no-same-owner'], { encoding: 'utf8' });
    if (x.status !== 0) throw new Error(`cannot extract ${input}: ${x.stderr.trim()}`);
    const list = spawnSync('tar', ['-tzf', input], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const paths = list.stdout.split('\n').filter((p) => p && !p.endsWith('/'));
    return read(dir, paths, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !['--profile', '--input', '--report', '--image'].includes(argv[i]) ||
      argv[i + 1] === undefined
    ) {
      process.stderr.write(
        `usage: check-notices.mjs --profile <${PROFILES.join('|')}> --input <tarball|dir> --report <out.json> [--image <ref>]\n`,
      );
      return 2;
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.profile || !args.input || !args.report || !NOTICES.artifacts[args.profile]) {
    process.stderr.write(
      'check-notices: --profile (a known one), --input and --report are required\n',
    );
    return 2;
  }
  const files = readArtifact(args.input);
  const image = args.image ? imagePython(args.image) : null;
  const findings = evaluateNotices({ profile: args.profile, files, image });
  const spec = NOTICES.artifacts[args.profile];
  const report = {
    profile: args.profile,
    input: args.input,
    image: args.image ?? null,
    noticeFile: spec.noticeFile,
    components: spec.components.map((c) => c.name),
    pythonRows: spec.python?.length ?? 0,
    imageDistributions: image?.length ?? null,
    findings,
    outcome: findings.length ? 'findings' : 'clean',
  };
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  for (const f of findings) process.stdout.write(`${JSON.stringify(f)}\n`);
  process.stdout.write(
    `${JSON.stringify({ profile: args.profile, files: files.length, findings: findings.length, outcome: report.outcome })}\n`,
  );
  return findings.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
