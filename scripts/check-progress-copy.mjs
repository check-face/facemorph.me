// While a morph renders, the status line is an incrementing integer and nothing else.
//
// Operator direction, 21 September, as a release gate: it must read "Generating X / Y images",
// it must not flicker, and the words "Generating images" and "Encoding" are banned from that
// moment. What shipped instead cycled between "Generating…", "Encoding your photo…" — during a
// morph, where no photo exists — and "Face generated.", three values per frame where there should
// be one. This fails the build rather than waiting for someone to watch it happen.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const bridge = readFileSync(resolve(root, 'src/Next/product-bridge.mjs'), 'utf8');
const labels = readFileSync(resolve(root, 'src/Next/stage-labels.mjs'), 'utf8');
const problems = [];

// 1. Only the frame counter and the export may speak during a morph.
const allowed = bridge.match(/const MORPH_SPOKEN_STAGES\s*=\s*new Set\(\[([^\]]*)\]\)/);
if (!allowed) problems.push('MORPH_SPOKEN_STAGES is gone: every stage can reach the line again.');
else {
  const names = [...allowed[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  if (String(names) !== String(['export', 'morph']))
    problems.push(`MORPH_SPOKEN_STAGES must be exactly morph and export, found: ${names.join(', ')}`);
}
if (!/if\(jobCounts\.framesTotal>1&&!MORPH_SPOKEN_STAGES\.has\(stage\)\)return;/.test(bridge))
  problems.push('The morph-only gate is missing from progress(); other stages can speak again.');

// 2. The frame line is one integer over a fixed total, in the agreed words.
const frame = bridge.match(/stage:'morph',text:`([^`]*\$\{frame[^`]*)`/);
if (!frame) problems.push('The per-frame morph line is gone.');
else if (!/^Generating \$\{frame\.index\+1\} \/ \$\{path\.totalFrames\} images$/.test(frame[1]))
  problems.push(`The per-frame line must read "Generating X / Y images", found: ${frame[1]}`);

// 3. Banned wording anywhere a morph can reach.
for (const [, text] of bridge.matchAll(/stage:'morph',text:`([^`]*)`/g)) {
  if (/\bEncoding\b/i.test(text)) problems.push(`A morph line says "Encoding": ${text}`);
  if (/Generating images/i.test(text)) problems.push(`A morph line says "Generating images": ${text}`);
}
// `export` speaks after the frames; it may name the export but never re-enter the counter's words.
const exportLabel = labels.match(/'export'/);
if (!exportLabel && !/stage:'export'/.test(bridge))
  problems.push('The export stage is neither labelled nor emitted, so the morph ends in silence.');

if (problems.length) {
  console.error('The morph progress line does not meet its release gate:\n');
  for (const problem of problems) console.error('  - ' + problem);
  console.error('\nWhile a morph renders the line increments an integer and says nothing else.');
  process.exit(1);
}
console.log(JSON.stringify({ morphProgressLine: 'Generating X / Y images', otherStagesSilent: true }));
