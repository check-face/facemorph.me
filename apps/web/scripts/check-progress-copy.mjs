// Release gate (operator, 21 September; resolution adopted 23 September, round-3 R3-03):
// while a morph renders, the status line reads "Generating X / Y images" and nothing else.
// X counts finished frames, so it never decreases whatever order frames are made in.
// Estimates belong on the separate line beneath it. "Encoding" is banned from the line.
// The bridge-source cases (MORPH_SPOKEN_STAGES, the morph-only gate, counter-only morph text, the
// export stage) moved to behavioural tests through the operation service in
// src/operations/progress-copy.test.ts (fm-vbj7). Only the counter cases remain here.
import { createFrameCounter, morphCounter } from '../src/Next/stage-labels.mjs';

const problems = [];

function drive(total, order) {
  const counter = createFrameCounter(total);
  const lines = [counter.start()];
  for (const index of order) lines.push(counter.complete(index));
  return lines;
}
function infill(total) {
  const order = [0, total - 1], seen = new Set(order);
  for (let step = total; step > 1; step = Math.ceil(step / 2))
    for (let i = 0; i < total; i += Math.max(1, Math.floor(step / 2)))
      if (!seen.has(i)) { seen.add(i); order.push(i); }
  for (let i = 0; i < total; i++) if (!seen.has(i)) order.push(i);
  return order;
}
for (const [name, total, order] of [
  ['path order', 26, [...Array(26).keys()]],
  ['infill order', 26, infill(26)],
  ['infill order, 64 frames', 64, infill(64)],
  ['a repeated frame', 4, [0, 3, 3, 1, 2]],
]) {
  const lines = drive(total, order);
  for (let i = 1; i < lines.length; i++)
    if (lines[i].done < lines[i - 1].done) problems.push(`${name}: the count went backwards at step ${i}`);
  if (lines.at(-1).done !== total) problems.push(`${name}: the count ends at ${lines.at(-1).done}, not ${total}`);
  for (const { text } of lines) {
    if (!/^Generating \d+ \/ \d+ images$/.test(text)) problems.push(`${name}: the line reads "${text}"`);
    if (/\bEncoding\b|Generating images/i.test(text)) problems.push(`${name}: banned wording in "${text}"`);
  }
}
if (morphCounter(3, 26) !== 'Generating 3 / 26 images') problems.push('morphCounter wording changed.');

if (problems.length) {
  console.error('The morph progress line does not meet its release gate:\n');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log(JSON.stringify({ morphProgressLine: 'Generating X / Y images', monotonic: true, gate: 'src/operations/progress-copy.test.ts' }));
