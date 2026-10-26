#!/usr/bin/env node
// Public package docs carry no FaceMorph deployment values (fm-19eb): a developer following the READMEs and guides of
// the published packages and the converter must never need FaceMorph's hostnames, its names catalogue, its Cloudflare
// aliases (R2 bucket, Worker routes) or any secret. FaceMorph's own values may appear only inside a labelled example
// region:
//
//   <!-- facemorph-example:start -->
//   **Example: FaceMorph's own deployment.** …
//   <!-- facemorph-example:end -->
//
// whose first non-empty line names it as FaceMorph's example. Links to the project's own source repository
// (github.com/facemorph-me/…) are not deployment values. Generated API references (docs/api.md) mirror code
// identifiers and are not scanned.
//   node scripts/packages/docs-scan.mjs [--json]      exit 0 clean, 1 findings, 2 usage or unreadable input
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const PACKAGES = [
  'packages/stylegan-js',
  'packages/browser-model-manager',
  'packages/cloudflare-model-host',
  'packages/model-conv',
];

/** What counts as a FaceMorph deployment value, with the reason a finding gives. */
export const RULES = [
  {
    rule: 'facemorph-hostname',
    pattern: /\b(?:[a-z0-9-]+\.)*facemorph\.me\b/gi,
    // The repository URL github.com/facemorph-me/facemorph.me names source, not a deployment.
    except: (line, index) => /github\.com\/facemorph-me\/$/i.test(line.slice(0, index)),
  },
  { rule: 'legacy-hostname', pattern: /\b(?:[a-z0-9-]+\.)*checkface\.(?:ml|me|com|ai)\b/gi },
  {
    rule: 'cloudflare-alias',
    pattern: /\bfacemorph-runtime-mirror\b|\b[a-z0-9-]+\.facemorph\.workers\.dev\b/gi,
  },
  { rule: 'names-catalogue', pattern: /\bcatalogue\.json\b|\bnames catalogue\b/gi },
  {
    rule: 'secret',
    pattern:
      /\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|NPM_TOKEN)=(?!["'<$])\S{8,}/g,
  },
];

const LABEL = /FaceMorph/;
const START = '<!-- facemorph-example:start -->';
const END = '<!-- facemorph-example:end -->';

/** The public docs of a package: its README, its docs/ guides (not the generated api.md) and its examples' READMEs. */
export function docFiles(root = REPO, packages = PACKAGES) {
  const out = [];
  const walk = (dir, pick) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, pick);
      else if (pick(p)) out.push(p);
    }
  };
  for (const pkg of packages) {
    const dir = join(root, pkg);
    if (existsSync(join(dir, 'README.md'))) out.push(join(dir, 'README.md'));
    walk(join(dir, 'docs'), (p) => p.endsWith('.md') && !p.endsWith('/api.md'));
    walk(join(dir, 'examples'), (p) => p.endsWith('/README.md'));
  }
  return out;
}

/** Findings in one Markdown text: every rule match outside a labelled FaceMorph example region. */
export function scanText(text, file = '<text>') {
  const findings = [];
  const lines = text.split('\n');
  let region = null;
  lines.forEach((line, i) => {
    if (line.trim() === START) {
      if (region)
        findings.push({ file, line: i + 1, rule: 'example-region', detail: 'nested start marker' });
      region = { start: i + 1, labelled: null };
      return;
    }
    if (line.trim() === END) {
      if (!region)
        findings.push({
          file,
          line: i + 1,
          rule: 'example-region',
          detail: 'end marker without a start',
        });
      else if (region.labelled !== true)
        findings.push({
          file,
          line: region.start,
          rule: 'example-region',
          detail: 'region is not labelled as FaceMorph’s example',
        });
      region = null;
      return;
    }
    if (region && region.labelled === null && line.trim() !== '')
      region.labelled = LABEL.test(line) && /example/i.test(line);
    if (region) return;
    for (const { rule, pattern, except } of RULES)
      for (const m of line.matchAll(pattern)) {
        if (except?.(line, m.index)) continue;
        findings.push({ file, line: i + 1, rule, detail: m[0] });
      }
  });
  if (region)
    findings.push({
      file,
      line: region.start,
      rule: 'example-region',
      detail: 'start marker without an end',
    });
  return findings;
}

export function scan(root = REPO, packages = PACKAGES) {
  const files = docFiles(root, packages);
  const findings = files.flatMap((f) => scanText(readFileSync(f, 'utf8'), relative(root, f)));
  return { files: files.map((f) => relative(root, f)), findings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--json')) {
    console.error('usage: docs-scan.mjs [--json]');
    process.exit(2);
  }
  let result;
  try {
    result = scan();
  } catch (error) {
    console.error(`docs-scan: ${error.message}`);
    process.exit(2);
  }
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const f of result.findings) console.log(`${f.file}:${f.line}: ${f.rule}: ${f.detail}`);
    console.log(`docs-scan: ${result.files.length} file(s), ${result.findings.length} finding(s)`);
  }
  process.exit(result.findings.length ? 1 : 0);
}
