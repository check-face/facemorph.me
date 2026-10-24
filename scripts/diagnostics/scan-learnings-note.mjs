#!/usr/bin/env node
// Identifier scan for the diagnostics learnings note (and anything else that must hold aggregates only).
// Fails (exit 1) on any identifier class below, printing line numbers with the matched text redacted.
//   node scan-learnings-note.mjs <file> [--allow <token>]... [--ids-file <path>]
// Also exported as scanText() so the deletion script can check its receipt and log with the
// bucket's run IDs held in memory.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEY_LIST_DIGEST = 'c3833f1f056ae0700e82d997a592e9009114d014a7b1ce8ae21c45cd8c07e0fb';

const CLASSES = [
  ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['r2-key', /\bruns\/[A-Za-z0-9_-]{6,}/g],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['ipv4', /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g],
  [
    'ipv6',
    /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b/gi,
  ],
  [
    'user-agent',
    /\b(?:Mozilla\/5\.0|(?:Chrome|CriOS|Firefox|FxiOS|Version|Safari|Edg|OPR|AppleWebKit)\/\d+\.\d+\.\d+(?:\.\d+)?)/g,
  ],
  ['hex', /\b[0-9a-f]{16,}\b/gi],
  ['base64', /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{20,}={0,2}(?![A-Za-z0-9+/_-])/g],
];

const redact = (s) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}…[${s.length} chars]`);

export function scanText(text, { allow = [KEY_LIST_DIGEST], ids = [], classes = true } = {}) {
  const allowed = new Set(allow);
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [cls, re] of classes ? CLASSES : []) {
      for (const m of line.matchAll(re)) {
        const hit = m[0];
        if (allowed.has(hit)) continue;
        // A slug (segments separated by - _ / +, each all lowercase letters or all digits, such as a
        // file name or heading anchor) is not an identifier; mixed segments like `k3x9q` are.
        if (cls === 'base64' && hit.split(/[-_/+]/).every((seg) => /^([a-z]*|\d*)$/.test(seg)))
          continue;
        if (cls === 'hex' && [...allowed].some((a) => a.includes(hit))) continue;
        findings.push({ line: i + 1, class: cls, match: redact(hit) });
      }
    }
    for (const id of ids) {
      if (id && line.includes(id))
        findings.push({ line: i + 1, class: 'bucket-id', match: redact(id) });
    }
  });
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allow = [KEY_LIST_DIGEST];
  let ids = [];
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow') allow.push(args[++i]);
    else if (args[i] === '--ids-file')
      ids = readFileSync(args[++i], 'utf8').split('\n').filter(Boolean);
    else files.push(args[i]);
  }
  if (!files.length) {
    console.error('usage: scan-learnings-note.mjs <file> [--allow <token>] [--ids-file <path>]');
    process.exit(2);
  }
  let total = 0;
  for (const f of files) {
    const findings = scanText(readFileSync(f, 'utf8'), { allow, ids });
    for (const x of findings) console.log(JSON.stringify({ file: f, ...x }));
    total += findings.length;
  }
  console.log(JSON.stringify({ event: 'scan-done', files: files.length, findings: total }));
  process.exit(total ? 1 : 0);
}
