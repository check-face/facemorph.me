#!/usr/bin/env node
// fm-pud: no disabled tests. Fails on a disabled test or test step that does not carry a reason, an owner and a
// removal condition, so a suite is never silently switched off ("no blanket disabled suite").
//   node scripts/build/check-no-disabled-tests.mjs [--root <dir>] [--files <path>...]
// Without --files it scans the git-tracked files of --root (default: the repo root) that SCOPE selects; --files
// scans exactly the given files (relative to --root), whatever their location. Output: one JSON line per finding
// {rule, file, line, text}, then {files, findings}. Exit 0 clean, 1 findings, 2 usage error.
//
// Rules
//   node/TS   .skip( / .only( / .todo( calls, xit( xdescribe( xtest(, and the node:test options `skip: true`,
//             `skip: '<literal>'`, `todo: true|'<literal>'`.
//   python    @pytest.mark.skip / skipif and unittest.skip(...). A pytest skip WITHOUT reason= is reported as
//             pytest-skip-no-reason. A pytest skip WITH a reason string still fails without the marker: the
//             reason string alone names no owner and no removal condition, which the bead requires.
//   workflow  `if: false` (any quoting, or ${{ false }}) and `continue-on-error: true` on a step whose name or run
//             looks like a test (test, pytest, node --test, vitest, playwright).
//
// Runtime-conditional skips are NOT disabled tests. Real tests here report environment-dependent cells as
// untested (`t.skip('untested here: ...')`, `{ skip: !docker && '...' }`, `test.skip(info.project.name !== 'phone')`).
// A skip is runtime-conditional, and allowed without a marker, when its argument or option is a non-literal
// expression, when its string starts with `untested here`, or (for t.skip on a node:test context) when it sits
// directly under an `if`. Only a literal `skip: true`, a literal-title or bare `.skip(` call, `todo` and the
// x-prefixed forms are disabled tests.
//
// Exemption marker, on the same line or on the comment line(s) immediately above (for a workflow step, above the
// step's first line also counts); all three fields must be non-empty:
//   disabled-test: reason=<text>; owner=<bead id or agent>; until=<removal condition>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Maintained test code and workflows are scanned; imported byte-identical classic code is not. */
export const SCOPE = {
  include: [
    ['**/*.test.mjs', 'node:test files'],
    ['**/*.test.js', 'node:test files'],
    ['**/*.test.ts', 'node:test and vitest-style files'],
    ['**/*.e2e.ts', 'Playwright end-to-end journeys'],
    ['**/*.spec.ts', 'Playwright specs'],
    ['**/test_*.py', 'Python unittest/pytest files'],
    ['**/*_test.py', 'Python unittest/pytest files'],
    ['**/test/**/*.{mjs,js,ts,py}', 'test directories'],
    ['**/tests/**/*.{mjs,js,ts,py}', 'test directories'],
  ],
  workflows: [['.github/workflows/*.yml', 'GitHub Actions workflows (workflow rules only)']],
  exclude: [
    ['apps/web/src/**', 'imported byte-identical classic closure, checked by import provenance'],
    ['apps/web/photo-runtime/**', 'imported byte-identical classic closure'],
    ['apps/web/experiment/**', 'imported byte-identical classic closure'],
    ['apps/web/scripts/**', 'imported byte-identical classic closure'],
    ['autoresearch/**', 'append-only research history'],
    ['hosting/**', 'imported byte-identical classic hosting'],
    ['**/node_modules/**', 'third-party code'],
    [
      'scripts/build/check-no-disabled-tests.test.mjs',
      "this check's own planted fixtures (disabled tests on purpose)",
    ],
    [
      'scripts/build/check-image-hash-asserts.test.mjs',
      "the hash check's own planted fixtures (hash assertions on purpose)",
    ],
  ],
};

const glob = (path, pairs) => pairs.some(([g]) => matchesGlob(path, g));

export function isExcluded(path) {
  return glob(path, SCOPE.exclude);
}
export function isTestFile(path) {
  return !isExcluded(path) && glob(path, SCOPE.include);
}
export function isWorkflow(path) {
  return !isExcluded(path) && glob(path, SCOPE.workflows);
}

/** Shared CLI: --root <dir>, --files <path>... Returns {root, files} or throws a usage Error. */
export function parseArgs(argv) {
  let root = ROOT;
  let files = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (!argv[i + 1]) throw new Error('--root needs a directory');
      root = argv[++i];
    } else if (argv[i] === '--files') {
      files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) files.push(argv[++i]);
      if (!files.length) throw new Error('--files needs at least one path');
    } else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { root, files };
}

/** git-tracked files of root. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter(Boolean);
}

export const isComment = (line) => /^\s*(\/\/|\/\*|\*|#|<!--)/.test(line);

/** The line itself plus the comment lines directly above it. */
export function contextComments(lines, i) {
  const out = [lines[i]];
  for (let j = i - 1; j >= 0 && isComment(lines[j]); j--) out.push(lines[j]);
  return out;
}

/** Parse `<tag>: k=v; k=v` fields from the first line that carries the tag. */
export function parseMarker(texts, tag) {
  for (const text of texts) {
    const m = new RegExp(`${tag}:\\s*(.*)`).exec(text);
    if (!m) continue;
    const fields = {};
    for (const part of m[1].replace(/(\*\/|-->)\s*$/, '').split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return fields;
  }
  return null;
}

const DISABLED_FIELDS = ['reason', 'owner', 'until'];
export function disabledMarkerOk(texts) {
  const fields = parseMarker(texts, 'disabled-test');
  return !!fields && DISABLED_FIELDS.every((k) => fields[k]);
}

/** Split call arguments at top-level commas; stops at the first unmatched closer. Quotes are skipped. */
export function splitTop(text) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

const UNTESTED = /^['"`]untested here/;
const LITERAL_STRING = /^['"`]/;
const RUNTIME_CTX = /^(t|ctx|context|subtest)$/;

function skipCall(recv, args, line, prev) {
  const a = args.map((s) => s.trim());
  if (RUNTIME_CTX.test(recv)) {
    if (!a.length || !LITERAL_STRING.test(a[0]) || UNTESTED.test(a[0])) return null;
    const guarded =
      /\bif\s*\(/.test(line) || /^\s*(\}\s*)?(else\s+)?if\s*\(.*\)\s*\{?\s*$/.test(prev);
    return guarded ? null : 'unconditional t.skip with a literal message';
  }
  if (!a.length) return 'bare .skip()';
  if (a.slice(1).some((s) => /=>|\bfunction\b/.test(s))) return 'skipped test definition';
  if (a[0] === 'true') return 'literal skip(true)';
  if (LITERAL_STRING.test(a[0]))
    return UNTESTED.test(a[0]) ? null : 'skipped test with a literal title';
  return null; // non-literal condition: runtime-conditional
}

function nodeFindings(lines) {
  const found = [];
  const add = (rule, i) => found.push({ rule, i });
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const rest = (from) => lines.slice(i).join('\n').slice(from);
    for (const m of line.matchAll(/([\w$.]+)\.skip\s*\(/g)) {
      const text = rest(m.index + m[0].length);
      if (skipCall(m[1], splitTop(text), line, lines[i - 1] ?? '')) add('skip', i);
    }
    if (/\.only\s*\(/.test(line)) add('only', i);
    if (/\.todo\s*\(/.test(line)) add('todo', i);
    if (/(^|[^\w$.])(xit|xdescribe|xtest)\s*\(/.test(line)) add('x-prefixed', i);
    if (/[{,]\s*todo\s*:\s*(true\b|['"`])/.test(line)) add('todo', i);
    for (const m of line.matchAll(/(?:^|[{,\s])skip\s*:\s*/g)) {
      const v = splitTop(rest(m.index + m[0].length))[0]?.trim() ?? '';
      if (v === 'true' || (LITERAL_STRING.test(v) && !UNTESTED.test(v))) add('skip', i);
    }
  });
  return found;
}

function pythonFindings(lines) {
  const found = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    if (/@pytest\.mark\.skip(if)?\b/.test(line)) {
      // the decorator can span lines; look at the call up to its closing paren
      const call = lines.slice(i, i + 6).join('\n');
      found.push({ rule: /reason\s*=/.test(call) ? 'pytest-skip' : 'pytest-skip-no-reason', i });
    }
    if (/\bunittest\.skip\s*\(/.test(line)) found.push({ rule: 'unittest-skip', i });
  });
  return found;
}

const indentOf = (s) => s.length - s.trimStart().length;
const TESTY = /\b(test|tests|pytest|vitest|playwright)\b|node --test/i;

function workflowFindings(lines) {
  const found = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    if (/^\s*(-\s+)?if:\s*(['"]?false['"]?|['"]?\$\{\{\s*false\s*\}\}['"]?)\s*(#.*)?$/.test(line)) {
      found.push({ rule: 'if-false', i, extra: stepRange(lines, i)?.start });
    }
    if (/^\s*(-\s+)?continue-on-error:\s*['"]?true['"]?\s*(#.*)?$/.test(line)) {
      const step = stepRange(lines, i);
      if (!step) return;
      const body = lines
        .slice(step.start, step.end)
        .filter(
          (l) =>
            !isComment(l) &&
            /^\s*(-\s+)?(name|run):|^\s{2,}\S/.test(l) &&
            !/^\s*(-\s+)?uses:/.test(l),
        )
        .join('\n');
      if (TESTY.test(body)) found.push({ rule: 'continue-on-error-test', i, extra: step.start });
    }
  });
  return found;
}

/** The step (list item) a key line belongs to, as [start, end) line indexes, or null. */
function stepRange(lines, i) {
  const keyIndent = /^\s*-\s/.test(lines[i]) ? indentOf(lines[i]) + 2 : indentOf(lines[i]);
  let start = -1;
  if (/^\s*-\s/.test(lines[i])) start = i;
  else {
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j].trim() || isComment(lines[j])) continue;
      if (indentOf(lines[j]) < keyIndent) {
        if (indentOf(lines[j]) === keyIndent - 2 && /^\s*-\s/.test(lines[j])) start = j;
        break;
      }
    }
  }
  if (start < 0) return null;
  const dash = indentOf(lines[start]);
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].trim() && !isComment(lines[j]) && indentOf(lines[j]) <= dash) {
      end = j;
      break;
    }
  }
  return { start, end };
}

/** Findings for one file's text; kind is chosen from the file name. */
export function scanText(file, text) {
  const lines = text.split(/\r?\n/);
  let raw;
  if (/\.ya?ml$/.test(file)) raw = workflowFindings(lines);
  else if (file.endsWith('.py')) raw = pythonFindings(lines);
  else raw = nodeFindings(lines);
  return raw
    .filter(({ i, extra }) => {
      const ctx = contextComments(lines, i);
      if (extra !== undefined && extra !== i) ctx.push(...contextComments(lines, extra));
      return !disabledMarkerOk(ctx);
    })
    .map(({ rule, i }) => ({ rule, file, line: i + 1, text: lines[i].trim().slice(0, 200) }));
}

export function scanFiles(root, files) {
  return files.flatMap((f) => scanText(f, readFileSync(join(root, f), 'utf8')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(
      `${e.message}\nusage: check-no-disabled-tests.mjs [--root <dir>] [--files <path>...]`,
    );
    process.exit(2);
  }
  const files = args.files ?? trackedFiles(args.root).filter((f) => isTestFile(f) || isWorkflow(f));
  const findings = scanFiles(args.root, files);
  for (const f of findings) console.log(JSON.stringify(f));
  console.log(JSON.stringify({ files: files.length, findings: findings.length }));
  process.exit(findings.length ? 1 : 0);
}
