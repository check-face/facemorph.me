#!/usr/bin/env node
// Content scan for publishable package tarballs and the model-conv build context (bead fm-1jr7 names it, fm-3osh
// implements it). Lists the input, hashes every file, and fails on weights/model blobs, repository-only paths,
// absolute or sibling paths, secrets, private provenance, missing required files, and per-profile rules.
// Rules are data: scripts/packages/tarball-profiles/<profile>.json (a `shared` section plus the profile's own
// rules); a profile change is a reviewed diff with its self-test fixture in check-tarball-contents.test.mjs.
//   node scripts/packages/check-tarball-contents.mjs --profile <stylegan-js|browser-model-manager|
//     cloudflare-model-host|model-conv-context> --input <tarball.tgz | build-context dir> --report <out.json>
// Exit 0 clean, 1 findings, 2 usage error or unknown profile (never passes silently).
// Report: {scanVersion, profile, input, inputSha256, files: [{path, bytes, sha256}], findings: [{rule, path,
// detail}], requiredMissing: [], outcome}. For a directory input, inputSha256 is a sha256 over the sorted
// "path NUL sha256 LF" list (a directory has no bytes of its own). npm tarballs keep files under `package/`;
// that prefix is stripped before rule matching and in the report.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCAN_VERSION = 1;
export const PROFILE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'tarball-profiles');
export const PROFILES = [
  'stylegan-js',
  'browser-model-manager',
  'cloudflare-model-host',
  'model-conv-context',
];
const MAX_TEXT_SCAN_BYTES = 16 * 1024 * 1024;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rx = (pattern, flags = '') => new RegExp(pattern, flags);
const anyMatch = (patterns, text, flags = '') => patterns.some((p) => rx(p, flags).test(text));
const redact = (s) => `${s.slice(0, 4)}...(${s.length} chars)`;

export function loadProfile(name) {
  if (!PROFILES.includes(name)) return null;
  return JSON.parse(readFileSync(join(PROFILE_DIR, `${name}.json`), 'utf8'));
}

// Docker .dockerignore semantics: last matching line wins, `!` re-includes, patterns are anchored at the context
// root (`*.pkl` matches only a root file; `**/*.pkl` matches at any depth), a match on a parent directory ignores
// its contents. Conservative: a path counts as ignored when it or any parent directory is ignored.
export function dockerGlob(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function dockerIgnored(lines, path) {
  const rules = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const negate = l.startsWith('!');
      const body = (negate ? l.slice(1) : l).replace(/^\/+/, '').replace(/\/+$/, '');
      return { negate, re: dockerGlob(body) };
    });
  const parts = path.split('/');
  for (let n = 1; n <= parts.length; n++) {
    const prefix = parts.slice(0, n).join('/');
    let ignored = false;
    for (const r of rules) if (r.re.test(prefix)) ignored = !r.negate;
    if (ignored) return true;
  }
  return false;
}

function exportTargets(pkg, ignoreConditions) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (!ignoreConditions.includes(k)) walk(x);
    }
  };
  walk(pkg.exports);
  return out.filter((t) => t.startsWith('./') && !t.includes('*')).map((t) => posix.normalize(t));
}

// Pure rule evaluation. `files`: [{path, bytes, sha256, text}] with `text` a string for scanned text files and
// null for binary or unscanned files. Returns {findings, requiredMissing}.
export function evaluate({ profile, files }) {
  const sh = profile.shared;
  const findings = [];
  const add = (rule, path, detail) => findings.push({ rule, path, detail });
  const paths = new Set(files.map((f) => f.path));
  const allowRepo = profile.repositoryPathAllow ?? [];
  const sourceMapRef = /[#@]\s*sourceMappingURL=(\S+)/g;

  for (const f of files) {
    const { path } = f;
    const base = posix.basename(path);
    const lower = path.toLowerCase();
    const ext = posix.extname(lower);
    const isCode = rx(sh.codeFiles).test(path);
    const isDoc = rx(sh.docFiles, 'i').test(path);

    if (sh.weightExtensions.includes(ext))
      add('weights-extension', path, `weights/model blob (${ext})`);
    if (f.bytes > sh.maxFileBytes && !anyMatch(sh.oversizeAllowlist, lower)) {
      add('oversize-file', path, `${f.bytes} bytes exceeds the ${sh.maxFileBytes} byte limit`);
    }
    if (anyMatch(sh.repositoryPaths, path) && !anyMatch(allowRepo, path)) {
      add('repository-path', path, 'repository-only path in the artifact');
    }
    if (/^\.env(\..*)?$/.test(base)) add('secret-env-file', path, '.env file');
    if (base === '.npmrc' && f.text !== null && rx(sh.npmrcAuthPattern).test(f.text)) {
      add('secret-npmrc-auth', path, '.npmrc with auth');
    }
    for (const r of profile.pathRules ?? []) {
      if (rx(r.pattern, r.flags).test(path))
        add(`profile-${profile.profile}-${r.id}`, path, r.detail);
    }

    if (f.text === null) continue;
    const text = f.text;

    for (const s of sh.secretPatterns) {
      const m = rx(s.pattern).exec(text);
      if (m) add(s.rule, path, `matches ${s.rule}: ${redact(m[0])}`);
    }

    if (isCode && !path.endsWith('.map')) {
      for (const a of sh.absolutePathPatterns) {
        const m = rx(a.pattern).exec(text);
        if (m) add('absolute-path', path, `${a.id}: ${JSON.stringify(m[0])}`);
      }
    }
    if (/\.[cm]?js$/.test(path)) {
      for (const m of text.matchAll(sourceMapRef)) {
        if (/^(?:\/|file:|https?:|\.\.\/)/.test(m[1])) {
          add(
            'sourcemap-outside',
            path,
            `sourceMappingURL ${JSON.stringify(m[1])} points outside the package`,
          );
        }
      }
    }
    if (path.endsWith('.map')) {
      let map = null;
      try {
        map = JSON.parse(text);
      } catch {
        add('sourcemap-outside', path, 'unparseable source map');
      }
      for (const src of map?.sources ?? []) {
        const resolved = posix.normalize(posix.join(posix.dirname(path), src));
        if (/^(?:\/|file:|[A-Za-z]:)/.test(src) || resolved.startsWith('../')) {
          add('sourcemap-outside', path, `source ${JSON.stringify(src)} is outside the package`);
        } else if (!map.sourcesContent && !paths.has(resolved)) {
          add(
            'sourcemap-outside',
            path,
            `source ${JSON.stringify(src)} is not shipped in the package`,
          );
        }
      }
    }

    const scope = profile.provenanceScope;
    if (scope === 'all' || (scope === 'non-docs' && !isDoc)) {
      for (const h of sh.productionHostnames) {
        const m = rx(h, 'i').exec(text);
        if (m)
          add('private-provenance', path, `FaceMorph production hostname ${JSON.stringify(m[0])}`);
      }
      for (const b of sh.r2BucketNames) {
        if (text.includes(b))
          add('private-provenance', path, `R2 bucket name ${JSON.stringify(b)}`);
      }
      for (const b of sh.r2BucketPatterns) {
        const m = rx(b, 'i').exec(text);
        if (m) add('private-provenance', path, `R2 bucket reference ${JSON.stringify(m[0])}`);
      }
    }

    for (const r of profile.contentRules ?? []) {
      if (!rx(r.files).test(path)) continue;
      const m = rx(r.pattern, r.flags).exec(text);
      if (m)
        add(
          `profile-${profile.profile}-${r.id}`,
          path,
          `${r.detail}: ${JSON.stringify(m[0].slice(0, 80))}`,
        );
    }
  }

  const requiredMissing = [];
  const miss = (name, detail) => {
    requiredMissing.push(name);
    add('required-file', name, detail);
  };
  for (const req of profile.required ?? []) {
    const found = files.some((f) => anyMatch(req.anyOf, f.path, req.flags ?? ''));
    if (!found) miss(req.name, `required file ${req.name} is missing`);
  }
  if (profile.requireExportTargets) {
    const pj = files.find((f) => f.path === 'package.json');
    if (pj?.text != null) {
      let pkg = null;
      try {
        pkg = JSON.parse(pj.text);
      } catch {
        add('required-file', 'package.json', 'package.json is not valid JSON');
      }
      for (const t of pkg ? exportTargets(pkg, profile.exportsIgnoreConditions ?? []) : []) {
        if (!paths.has(t)) miss(t, `exports target ./${t} is not in the package`);
      }
    }
  }
  if (profile.dockerignore) {
    const di = files.find((f) => f.path === '.dockerignore');
    if (di?.text != null) {
      const lines = di.text.split(/\r?\n/);
      for (const name of profile.dockerignore.mustExclude) {
        for (const sample of [name, `unlisted-dir/${name}`]) {
          if (!dockerIgnored(lines, sample)) {
            add(
              `profile-${profile.profile}-dockerignore-gap`,
              '.dockerignore',
              `does not exclude ${sample}`,
            );
          }
        }
      }
    }
  }

  const seen = new Set();
  const unique = findings.filter((x) => {
    const k = `${x.rule}\0${x.path}\0${x.detail}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return { findings: unique, requiredMissing };
}

function walk(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const p = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, p));
    if (st.isDirectory()) out.push(...walk(dir, p));
    else out.push({ path: p, symlink: st.isSymbolicLink() });
  }
  return out;
}

function readEntries(root, relPaths, stripPackage) {
  const files = [];
  const findings = [];
  for (const { path: raw, symlink } of relPaths) {
    const path = stripPackage ? raw.replace(/^package\//, '') : raw;
    if (symlink) {
      findings.push({ rule: 'symlink-entry', path, detail: 'symbolic link in the artifact' });
      continue;
    }
    const buf = readFileSync(join(root, raw));
    const binary = buf.subarray(0, 8000).includes(0);
    const text = binary || buf.length > MAX_TEXT_SCAN_BYTES ? null : buf.toString('utf8');
    files.push({ path, bytes: buf.length, sha256: sha256(buf), text });
  }
  return { files, findings };
}

export function scanInput({ profile, input }) {
  const st = statSync(input);
  let inputSha;
  let entries;
  let cleanup = null;
  const extra = [];
  if (st.isDirectory()) {
    const r = readEntries(input, walk(input), false);
    entries = r.files;
    extra.push(...r.findings);
    inputSha = sha256(
      entries
        .map((f) => `${f.path}\0${f.sha256}\n`)
        .sort()
        .join(''),
    );
  } else {
    inputSha = sha256(readFileSync(input));
    const list = spawnSync('tar', ['-tzf', input], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (list.status !== 0) throw new Error(`cannot list tarball: ${list.stderr.trim()}`);
    const unsafe = list.stdout
      .split('\n')
      .filter(Boolean)
      .filter((n) => n.startsWith('/') || n.split('/').includes('..'));
    if (unsafe.length) {
      return {
        inputSha256: inputSha,
        files: [],
        findings: unsafe.map((n) => ({
          rule: 'unsafe-entry',
          path: n,
          detail: 'absolute or parent-relative tar entry',
        })),
        requiredMissing: [],
      };
    }
    cleanup = mkdtempSync(join(tmpdir(), 'tarball-scan-'));
    try {
      const x = spawnSync(
        'tar',
        ['-xzf', input, '-C', cleanup, '--no-same-owner', '--no-same-permissions'],
        {
          encoding: 'utf8',
        },
      );
      if (x.status !== 0) throw new Error(`cannot extract tarball: ${x.stderr.trim()}`);
      const r = readEntries(cleanup, walk(cleanup), true);
      entries = r.files;
      extra.push(...r.findings);
    } finally {
      rmSync(cleanup, { recursive: true, force: true });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const ev = evaluate({ profile, files: entries });
  return {
    inputSha256: inputSha,
    files: entries.map(({ path, bytes, sha256: h }) => ({ path, bytes, sha256: h })),
    findings: [...extra, ...ev.findings],
    requiredMissing: ev.requiredMissing,
  };
}

function usage(msg) {
  process.stderr.write(
    `${msg}\nusage: check-tarball-contents.mjs --profile <${PROFILES.join('|')}> --input <tarball.tgz|dir> --report <out.json>\n`,
  );
  return 2;
}

export function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!['--profile', '--input', '--report'].includes(k)) return usage(`unknown argument ${k}`);
    if (argv[i + 1] === undefined) return usage(`${k} needs a value`);
    args[k.slice(2)] = argv[i + 1];
  }
  for (const k of ['profile', 'input', 'report']) if (!args[k]) return usage(`missing --${k}`);
  const profile = loadProfile(args.profile);
  if (!profile) return usage(`unknown profile ${JSON.stringify(args.profile)}`);
  if (!existsSync(args.input)) return usage(`input not found: ${args.input}`);
  let scan;
  try {
    scan = scanInput({ profile, input: args.input });
  } catch (e) {
    return usage(`cannot read input: ${e.message}`);
  }
  const outcome = scan.findings.length ? 'findings' : 'clean';
  const report = {
    scanVersion: SCAN_VERSION,
    profile: args.profile,
    input: args.input,
    inputSha256: scan.inputSha256,
    files: scan.files,
    findings: scan.findings,
    requiredMissing: scan.requiredMissing,
    outcome,
  };
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  for (const f of scan.findings) process.stdout.write(`${JSON.stringify(f)}\n`);
  process.stdout.write(
    `${JSON.stringify({ profile: args.profile, files: scan.files.length, findings: scan.findings.length, outcome })}\n`,
  );
  return scan.findings.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
