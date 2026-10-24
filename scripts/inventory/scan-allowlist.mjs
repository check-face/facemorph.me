#!/usr/bin/env node
// Scans import/allowlist.json for anything the import must never carry, independently of its rules:
// F# sources and project files, generated Fable output (*.fs.js), .NET/Fable pins, Webpack config, legacy
// Server/API files, node_modules, weights (by extension or size), delivery directories, .wrangler/ state
// and credentials (by name, and by secret patterns in the imported bytes). It also checks destinations,
// temporary-path ownership, the not-applicable checks, the hosting/next-mirror digests, and that every
// current classic working-tree change is listed as an excluded overlay.
//   node scripts/inventory/scan-allowlist.mjs [--classic <dir>]
// One JSON line per finding (`info` lines do not fail), then a summary; exit 1 on any finding.
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, blob, classicDir, line, options, readJson, sha256 } from './lib.mjs';
import { overlays } from './generate-allowlist.mjs';

const WEIGHT_BYTES = 8 * 1024 * 1024;
const CLASSES = [
  ['fsharp-source', /\.(fs|fsi|fsx|fsproj)$/],
  ['fable-output', /\.fs\.js(\.map)?$/],
  [
    'dotnet-fable-pins',
    /(^|\/)(global\.json|\.config\/dotnet-tools\.json|nuget\.config|paket\.[a-z.]+)$/i,
  ],
  ['webpack-config', /(^|\/)webpack\.config\.[cm]?js$/],
  ['legacy-server-api', /^(Server\/|deploy\/api\/)|(^|\/)Server\.fsproj$/],
  ['node-modules', /(^|\/)node_modules\//],
  ['weights', /\.(onnx|pt|pth|pkl|ckpt|safetensors|bin|dat|h5|tflite|npz|npy|f32)$/i],
  [
    'delivery-directory',
    /^(deploy|deploy-next|deploy-self-host|dist|public|\.runtime-public|\.runtime-mirror)\//,
  ],
  ['wrangler-state', /(^|\/)\.wrangler\//],
  [
    'credentials',
    /(^|\/)(\.env(\.[^/]*)?|\.dev\.vars|\.npmrc|credentials[^/]*|id_(rsa|ed25519|ecdsa)[^/]*|[^/]+\.(pem|key|p12|pfx))$/i,
  ],
];
const SECRETS = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe-live-key', /\b[rs]k_live_[0-9A-Za-z]{20,}/],
  [
    'assigned-secret',
    /\b(api[_-]?key|api[_-]?token|secret|password|auth[_-]?token)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{24,}["']/i,
  ],
];

// Forbidden-class findings for allowlist rows {source, bytes}; `content` maps source → text to search.
export function classFindings(rows, content = new Map()) {
  const out = [];
  for (const { source, bytes } of rows) {
    for (const [name, re] of CLASSES) if (re.test(source)) out.push({ source, class: name });
    if (bytes > WEIGHT_BYTES)
      out.push({
        source,
        class: 'weights',
        reason: `${bytes} bytes is over the ${WEIGHT_BYTES}-byte weight threshold`,
      });
    const text = content.get(source);
    if (text)
      for (const [name, re] of SECRETS)
        if (re.test(text)) out.push({ source, class: 'credentials', pattern: name });
  }
  return out;
}

export function structureFindings(allowlist) {
  const out = [];
  const root = allowlist.destination_root;
  const protectedPaths = allowlist.protected_destinations;
  for (const f of allowlist.files) {
    if (f.destination !== `${root}/${f.source}`)
      out.push({ source: f.source, problem: 'destination is not destination_root/source' });
    if (
      protectedPaths.some((p) =>
        p.endsWith('/') ? f.destination.startsWith(p) : f.destination === p,
      )
    )
      out.push({ source: f.source, problem: 'destination collides with a protected path' });
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) out.push({ source: f.source, problem: 'no sha256' });
  }
  for (const rule of allowlist.rules) {
    if (rule.disposition !== 'imported' || rule.patterns.every((p) => p.startsWith('src/')))
      continue;
    if (!rule.temporary || !rule.consumer || !rule.owner)
      out.push({
        rule: rule.patterns,
        problem: 'a temporary root path needs temporary, consumer and owner',
      });
  }
  for (const source of ['scripts/check-bridge-imports.mjs', 'src/Next/verify-fable.mjs']) {
    const check = allowlist.checks.find((c) => c.source === source);
    if (
      !check ||
      check.status !== 'not applicable until the port' ||
      !check.reason ||
      !check.successors?.length
    )
      out.push({
        source,
        problem: 'must be marked "not applicable until the port" with reason and successors',
      });
    if (!allowlist.files.some((f) => f.source === source))
      out.push({ source, problem: 'not-applicable check is not imported as a file' });
  }
  const mirror = allowlist.listed_with_digests.filter((r) =>
    r.source.startsWith('hosting/next-mirror/'),
  );
  if (mirror.length < 3 || mirror.some((r) => !r.owner || !/^[0-9a-f]{64}$/.test(r.sha256)))
    out.push({ problem: 'hosting/next-mirror/ rows need digests and owners' });
  return out;
}

// Current working-tree changes in classic that the allowlist does not list as overlays.
export function overlayFindings(current, recorded) {
  const listed = recorded.entries ?? [];
  const out = [];
  for (const entry of current) {
    const match = listed.find(
      (l) => l.path === entry.path || (l.path.endsWith('/') && entry.path.startsWith(l.path)),
    );
    if (!match)
      out.push({
        overlay: entry.path,
        problem: 'uncommitted classic change not listed in working_tree_overlays',
      });
    else if (entry.sha256 && match.sha256 && entry.sha256 !== match.sha256)
      out.push({
        info: true,
        overlay: entry.path,
        note: 'changed since it was recorded (another session is editing it); still excluded',
      });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = options(process.argv.slice(2));
  const dir = classicDir(opts);
  const allowlist = readJson(ALLOWLIST);
  const commit = allowlist.source.frozen_commit;
  const content = new Map();
  for (const f of allowlist.files) {
    const bytes = blob(dir, commit, f.source);
    if (!bytes.includes(0)) content.set(f.source, bytes.toString('utf8'));
  }
  const findings = [
    ...classFindings(allowlist.files, content),
    ...structureFindings(allowlist),
    ...allowlist.listed_with_digests
      .filter((r) => sha256(blob(dir, commit, r.source)) !== r.sha256)
      .map((r) => ({ source: r.source, problem: 'listed digest differs from the frozen commit' })),
    ...overlayFindings(overlays(dir), allowlist.working_tree_overlays),
  ];
  for (const f of findings) line(f);
  const failing = findings.filter((f) => !f.info).length;
  line({
    summary: {
      files: allowlist.files.length,
      text_files_searched: content.size,
      overlays_recorded: allowlist.working_tree_overlays.entries?.length ?? 0,
      findings: failing,
      info: findings.length - failing,
    },
  });
  process.exit(failing ? 1 : 0);
}
