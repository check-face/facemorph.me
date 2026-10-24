#!/usr/bin/env node
// fm-pud: no byte-hash assertions over encoded image or video outputs. Raw synthesis is compared within small
// numerical tolerances and exported image compression/container bytes may differ, so a test that asserts a
// SHA-256 or other digest of an encoded WebP/PNG/JPEG/MP4 output is brittle and wrong. Such an assertion must name
// its replacement under the synthesis/export rules, or be replaced.
//   node scripts/build/check-image-hash-asserts.mjs [--root <dir>] [--files <path>...]
// Scope, --root and --files work as in check-no-disabled-tests.mjs (maintained test code only). Output: one JSON
// line per finding {rule, file, line, text}, then {files, findings}. Exit 0 clean, 1 findings, 2 usage error.
//
// THIS IS A HEURISTIC, line-based and reviewable, not a proof. A line is flagged when all of these hold:
//   1. it computes or compares a digest (the word sha256 or a .sha256 property, createHash, .digest(, sha256Hex,
//      hashlib.sha256; camelCase/snake_case identifiers such as modelSha256 are identity hashes, not matched),
//   2. it is an assertion (assert, expect(, ===, !==, assertEqual, deepEqual, strictEqual),
//   3. the same line, or up to three lines above within the same statement, mention an encoded image or video output (webp, png, jpg/jpeg, mp4,
//      h264, the words encode/encoded, toBlob, convertToBlob, export/exported; not encoder or identifiers).
// It will miss hashes compared through helpers and may flag a hash of something that merely sits near such a word;
// exempt the latter with the marker.
//
// Exemption marker, same line or on the comment line(s) immediately above; the value must be one of the three
// replacements the synthesis/export rules allow:
//   hash-assert: replacement=<raw-tolerance|prepared-file-reuse|corruption-check>; <text>
//     raw-tolerance       the output is compared as raw pixels/tensors within the plan's numerical tolerance
//     prepared-file-reuse the hash only proves a prepared file is reused byte-for-byte, not that encoding matches
//     corruption-check    the hash only detects a corrupted or truncated file (integrity, not equality of encoders)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contextComments,
  isComment,
  isTestFile,
  parseArgs,
  parseMarker,
  trackedFiles,
} from './check-no-disabled-tests.mjs';

export const REPLACEMENTS = ['raw-tolerance', 'prepared-file-reuse', 'corruption-check'];

const HASH = /\bsha-?256\b|createHash\s*\(|\.digest\s*\(|sha256Hex|hashlib\.sha256/i;
const ASSERTION = /\bassert\b|assert\.\w+|expect\s*\(|===|!==|assertEqual|deepEqual|strictEqual/;
const IMAGE =
  /webp|png|jpe?g|mp4|h264|\bencode(?:d)?\b(?!\s*\()|toBlob|convertToBlob|\bexport(?:ed)?\b/i;

/** Marker text on the line or the comments above; replacement must be one of REPLACEMENTS. */
export function markerState(texts) {
  const fields = parseMarker(texts, 'hash-assert');
  if (!fields) return 'missing';
  return REPLACEMENTS.includes(fields.replacement) ? 'ok' : 'invalid';
}

export function scanText(file, text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    if (isComment(line) || !HASH.test(line) || !ASSERTION.test(line)) return;
    // a JS `export const` keyword is not an exported image
    // Lines above count only while they belong to the same statement (the line before does not end one), so a
    // neighbouring assertion about a .webp never taints an unrelated digest.
    let start = i;
    while (start > 0 && i - start < 3 && !/[;{}]\s*$/.test(lines[start - 1])) start--;
    const near = lines
      .slice(start, i + 1)
      .map((l) => l.replace(/^\s*export\s+/, ''))
      .join('\n');
    if (!IMAGE.test(near)) return;
    const state = markerState(contextComments(lines, i));
    if (state === 'ok') return;
    found.push({
      rule: state === 'invalid' ? 'image-hash-assert-bad-replacement' : 'image-hash-assert',
      file,
      line: i + 1,
      text: line.trim().slice(0, 200),
    });
  });
  return found;
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
      `${e.message}\nusage: check-image-hash-asserts.mjs [--root <dir>] [--files <path>...]`,
    );
    process.exit(2);
  }
  const files = args.files ?? trackedFiles(args.root).filter(isTestFile);
  const findings = scanFiles(args.root, files);
  for (const f of findings) console.log(JSON.stringify(f));
  console.log(JSON.stringify({ files: files.length, findings: findings.length }));
  process.exit(findings.length ? 1 : 0);
}
