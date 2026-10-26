#!/usr/bin/env node
// Scans hosting/ (fm-8tyu): no `.wrangler/` state, no credential-looking values, no model weights or other large
// binaries, and no file outside hosting/PROVENANCE.json. Exit 1 with one JSON line per finding.
//   node scripts/hosting/scan-hosting.mjs [--dir hosting]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, line, options } from '../inventory/lib.mjs';
import { SIZE_ALLOWLIST, SIZE_LIMIT } from './import-hosting.mjs';

const WEIGHTS = /\.(onnx|pt|pth|pkl|ckpt|safetensors|bin|f32|wasm)$/i;
// Values, not names: a wrangler config may name a secret (`CLOUDFLARE_API_TOKEN`) but never carry one.
const SECRETS = [
  ['cloudflare-token', /\b[A-Za-z0-9_-]{40}\b(?=["'\s]*$)/m],
  ['bearer', /Bearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
];

export function scanFiles(files) {
  const out = [];
  for (const { path, bytes } of files) {
    if (path.split('/').includes('.wrangler')) out.push({ path, problem: 'wrangler state' });
    if (WEIGHTS.test(path)) out.push({ path, problem: 'weight or binary file' });
    if (bytes.length > SIZE_LIMIT && !SIZE_ALLOWLIST.has(path))
      out.push({ path, problem: 'over the size limit' });
    if (
      (path.endsWith('.json') && path !== 'hosting/next-static/catalogue.json') ||
      /\.(mjs|js|ts|tsx|py|toml|jsonc|md|txt|html|yml)$/.test(path)
    ) {
      const text = bytes.toString('utf8');
      for (const [kind, re] of SECRETS)
        if (re.test(text)) out.push({ path, problem: `credential-looking value (${kind})` });
    }
  }
  return out;
}

// Python bytecode caches: written beside any imported module a test or the promote/stage scripts run
// (promote.py imports webgpu_contract), ignored by .gitignore, and never shipped (the site deploys only the
// staged public/ tree). They are build by-products, not hosting/ content, so the walk leaves them out.
export const BYPRODUCT_DIRS = new Set(['__pycache__']);

export function walk(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!BYPRODUCT_DIRS.has(name)) walk(p, root, out);
    } else out.push({ path: relative(root, p).split('\\').join('/'), bytes: readFileSync(p) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const files = walk(join(REPO, opts.dir ?? 'hosting'), REPO);
  const provenance = JSON.parse(readFileSync(join(REPO, 'hosting/PROVENANCE.json'), 'utf8'));
  const recorded = new Set(
    [...provenance.files, ...(provenance.addedFiles ?? [])].map((f) => f.path),
  );
  const findings = [
    ...scanFiles(files),
    ...files
      .filter((f) => f.path !== 'hosting/PROVENANCE.json' && !recorded.has(f.path))
      .map((f) => ({ path: f.path, problem: 'not in hosting/PROVENANCE.json' })),
  ];
  for (const f of findings) line(f);
  line({ summary: { ok: !findings.length, files: files.length, findings: findings.length } });
  process.exit(findings.length ? 1 : 0);
}
