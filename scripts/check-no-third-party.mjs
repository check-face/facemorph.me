// AGENTS.md, binding: the product loads no libraries or code from third-party CDNs at runtime.
//
// CDNs age out, yank versions and silently serve stale majors, and every byte this product
// executes or fetches is meant to come from its own origin, hash-pinned and named by the
// promotion receipt — exactly like the model assets. Two violations had been shipping: the
// ffmpeg video codec (rewritten to cdn.jsdelivr.net by prepare-runtime.py) and the Nunito/Roboto
// webfonts (a Google Fonts @import in style.scss, which also contradicted the
// offline-capable-after-first-load claim — a device with every model cached still reached out).
//
// This checks what the built product would actually fetch. Anchor hrefs are left alone: a link
// to a licence or a repository is not a runtime dependency.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['deploy-next'];

/** Origins a fetched/executed resource may come from. Runtime assets are same-origin by design. */
const ALLOWED = [/^https:\/\/next\.facemorph\.me\//, /^https:\/\/facemorph-next\.[\w-]+\.workers\.dev\//];
/**
 * Where the names and seed gallery images may come from. The catalogue names its origin once and
 * every image URL is derived from it, so an unlisted origin here is a runtime dependency nobody
 * reviewed. The workers.dev entry is the current published gallery (16 September) and is
 * temporary: U-18 moves it onto a facemorph.me host, hashes preserved, and this line goes then.
 */
const GALLERY_ORIGINS = ['https://facemorph-seed-gallery.cdilga.workers.dev'];

const findings = [];

// Provenance records name where bytes came from; that is their whole job, and nothing fetches
// them at runtime. A receipt that could not say "this woff2 came from fonts.gstatic.com" would be
// useless, so these are read as documentation rather than as dependencies.
const PROVENANCE = /(?:RECEIPT|receipt|provenance|sources\.private|publication-receipt|THIRD_PARTY_NOTICES)/;

function inspect(file) {
  const where = relative(root, file);
  if (PROVENANCE.test(where)) return;
  const text = readFileSync(file, 'utf8');
  // CSS: anything the stylesheet pulls in is fetched.
  for (const [, url] of text.matchAll(/(?:@import\s+)?url\(\s*['"]?(https?:\/\/[^'")\s]+)/g))
    findings.push({ where, url, how: 'CSS url()' });
  // Markup: only resource-loading attributes, never <a href>.
  for (const [, url] of text.matchAll(/<(?:script|link|img|source|iframe|audio|video)\b[^>]*?\b(?:src|href)=["'](https?:\/\/[^"']+)/gi))
    findings.push({ where, url, how: 'markup resource' });
  // Script: a literal pointing at a known package CDN is a runtime dependency however it is used.
  for (const [, url] of text.matchAll(/["'`](https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|esm\.sh|skypack\.dev)\/[^"'`]*)/g))
    findings.push({ where, url, how: 'package CDN literal' });
}

function walk(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) { for (const entry of readdirSync(path)) walk(join(path, entry)); return; }
  if (/\.(css|html|js|mjs|json|scss)$/.test(path) && !/\.map$/.test(path)) inspect(path);
}

for (const target of targets) walk(resolve(root, target));

for (const target of targets) {
  const catalogue = resolve(root, target, 'catalogue.json');
  if (!existsSync(catalogue)) continue;
  const origin = String(JSON.parse(readFileSync(catalogue, 'utf8')).origin || '');
  if (origin && !GALLERY_ORIGINS.includes(origin) && !ALLOWED.some(pattern => pattern.test(origin + '/')))
    findings.push({ where: relative(root, catalogue), url: origin, how: 'gallery origin' });
}

const violations = findings.filter(item => !ALLOWED.some(pattern => pattern.test(item.url)));
if (violations.length) {
  const unique = new Map(violations.map(item => [item.url + item.where, item]));
  console.error('Third-party runtime dependencies found (AGENTS.md forbids these):\n');
  for (const item of unique.values()) console.error(`  ${item.where}\n    ${item.how}: ${item.url}\n`);
  console.error('Self-host it from this product\'s own origin, hash-pinned and named by the receipt.');
  process.exit(1);
}
console.log(JSON.stringify({ thirdPartyRuntimeDependencies: 0, scanned: targets }));
