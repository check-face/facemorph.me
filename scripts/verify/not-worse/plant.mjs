// Planted defects for proving the not-worse lanes see what they must (fm-0q4h): a copy of an artifact with one
// planted script at the top of its index.html, served as the "build" side of a paired run.
//   node scripts/verify/not-worse/plant.mjs --kind slow --delay-ms 5000 --from <deploy-next dir> --out <dir>
//   node scripts/verify/not-worse/plant.mjs --kind crash --from <deploy-next dir> --out <dir>
// slow:  every Generate press reaches the app only after --delay-ms (the click is held in the capture phase and
//        re-dispatched), so the cold, next and warm face measures each grow by the delay; nothing else changes.
// crash: pressing Create morph exhausts the renderer's JavaScript heap, a real out-of-memory renderer crash.
// Prints {kind, dir, treeSha256}: pass --build <dir> --build-digest <treeSha256> to run.ts (or mobile.py).
// A planted artifact is a test input, never a release candidate.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { artifactDigest } from '../../../autoresearch/drivers/lib/artifact.mjs';

export const PLANTS = {
  slow: (delayMs) => `<script data-planted="slow">(() => {
  const DELAY = ${Number(delayMs)}; const held = new WeakSet();
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element && e.target.closest('.next-face-generate');
    if (!b || held.has(e)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    setTimeout(() => { const r = new MouseEvent('click', { bubbles: true, cancelable: true }); held.add(r); b.dispatchEvent(r); }, DELAY);
  }, true);
})();</script>`,
  crash: () => `<script data-planted="crash">(() => {
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element && e.target.closest('.next-primary-action'))) return;
    const keep = []; for (;;) keep.push(new Array(1 << 20).fill(Math.random()));
  }, true);
})();</script>`,
};

/** Pure: index.html with the planted script as the first thing in <head>. */
export function plantHtml(html, script) {
  if (!/<head[^>]*>/i.test(html)) throw new Error('index.html has no <head>');
  return html.replace(/<head[^>]*>/i, (m) => m + script);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      kind: { type: 'string' },
      'delay-ms': { type: 'string', default: '5000' },
      from: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!PLANTS[values.kind]) throw new Error('--kind is slow or crash');
  if (!values.from || !values.out)
    throw new Error('--from <deploy-next dir> --out <dir> are required');
  const out = resolve(values.out);
  cpSync(resolve(values.from), out, { recursive: true, errorOnExist: true, force: false });
  const index = join(out, 'index.html');
  writeFileSync(
    index,
    plantHtml(readFileSync(index, 'utf8'), PLANTS[values.kind](values['delay-ms'])),
  );
  console.log(
    JSON.stringify({
      kind: values.kind,
      delayMs: values.kind === 'slow' ? Number(values['delay-ms']) : null,
      dir: out,
      treeSha256: artifactDigest(out).treeSha256,
    }),
  );
}
