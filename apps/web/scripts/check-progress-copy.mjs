// fm-j4i8: one whole-action bar spans prerequisite faces, frames and the usable MP4.
// The frame counter is secondary and monotonic; MP4 preparation remains visible.
// The built-app DOM/attempt/cancellation checks run in test/e2e/morph-output.e2e.ts.
// The bridge-source cases (MORPH_SPOKEN_STAGES, the morph-only gate, counter-only morph text, the
// export stage) moved to behavioural tests through the operation service in
// src/operations/progress-copy.test.ts (fm-vbj7). Counter and whole-action phase cases remain here.
import { createFrameCounter, morphCounter } from '../src/Next/stage-labels.mjs';
import { createActionProgress } from '../src/operations/progress.ts';

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

const bar = createActionProgress('progress-copy-gate', [
  { kind: 'prepare', unit: 'steps', weight: 2, total: 2 },
  { kind: 'frames', unit: 'frames', weight: 6, total: 26 },
  { kind: 'file', unit: 'steps', weight: 2, total: 1 },
]);
const fractions = [bar.snapshot().fraction];
for (const phase of ['prepare', 'frames', 'file']) {
  fractions.push(bar.finish(phase).fraction);
  if (bar.snapshot().complete || bar.snapshot().fraction === 1)
    problems.push(`${phase}: the bar claimed completion before the usable MP4`);
}
fractions.push(bar.fileReady().fraction);
for (let i = 1; i < fractions.length; i++)
  if (fractions[i] < fractions[i - 1]) problems.push('The whole-action bar reset between phases.');
if (fractions.at(-1) !== 1) problems.push('The usable MP4 did not complete the bar.');

if (problems.length) {
  console.error('The morph progress line does not meet its release gate:\n');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
// destination-checks runs this behavioural unit gate without browser/model provisioning.
// web-shell/runtime-e2e runs the built-app gate with Playwright and the pinned runtime.
console.log(JSON.stringify({ primary: 'one whole-action monotonic bar', secondary: 'Generating X / Y images', completion: 'usable MP4', fractions, monotonic: true, gate: 'src/operations/progress-copy.test.ts', builtAppGate: 'test/e2e/morph-output.e2e.ts' }));
