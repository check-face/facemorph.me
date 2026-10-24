// Compare measured prototype boxes (out/boxes-<proto>-<width>.json) with the locked-reference geometry
// (docs/design/legacy-encode-dialog-geometry.json, "editor" dialog). All values are fractions of modal width
// from the modal's top-left. Usage: node compare-geometry.mjs <geometry.json> [--tol 0.01]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const geoPath = process.argv[2];
if (!geoPath) { console.error('usage: node compare-geometry.mjs <geometry.json> [--tol 0.01]'); process.exit(2); }
const tolIdx = process.argv.indexOf('--tol');
const TOL = tolIdx > 0 ? Number(process.argv[tolIdx + 1]) : 0.01;
const ref = JSON.parse(readFileSync(geoPath, 'utf8')).dialogs.editor;

const HMAP = { nw: 'top_left', n: 'top', ne: 'top_right', e: 'right', se: 'bottom_right', s: 'bottom', sw: 'bottom_left', w: 'left' };
function rows(b) {
  const r = [];
  const add = (name, mine, theirs) => r.push({ name, mine, ref: theirs, dev: mine - theirs });
  const rect = (n, m, t, keys = ['x', 'y', 'w', 'h']) => keys.forEach((k) => add(`${n}.${k}`, m[k], t[k]));
  rect('photo_frame(stage)', b.stage, ref.photo_frame);
  rect('stencil', b.stencil, ref.stencil);
  add('title.x', b.title.x, ref.title.x);
  for (const [d, k] of Object.entries(HMAP)) { add(`handle.${d}.cx`, b.handles[d].cx, ref.handles.centres[k].x); add(`handle.${d}.cy`, b.handles[d].cy, ref.handles.centres[k].y); }
  add('handle.size(visible square)', b.handles.nw.visibleSquareFracModal, ref.handles.size);
  const g = ref.oval_guide.in_stencil; rect('oval_guide(in stencil)', b.guideRelStencil, g);
  const ec = [...b.eyeCentresModal].sort((p, q) => p.x - q.x);
  ref.eye_markers.centres.forEach((c, i) => { add(`eye${i}.cx`, ec[i].x, c.x); add(`eye${i}.cy`, ec[i].y, c.y); });
  add('eye.diameter', b.eyeDiameterFracModal, ref.eye_markers.diameter);
  add('eye.spacing', b.eyeSpacingFracModal, ref.eye_markers.spacing);
  rect('rotate_icon', b.rotateIcon, ref.rotate_icon);
  add('rotate_readout.x', b.readout.x, ref.rotate_readout.x);
  add('rotate_readout.cy', b.readout.cy, ref.rotate_readout.y + ref.rotate_readout.h / 2);
  add('slider_track.x0', b.slider.x, ref.slider_track.x0);
  add('slider_track.x1', b.slider.x + b.slider.w, ref.slider_track.x1);
  add('slider_track.cy', b.slider.cy, ref.slider_track.y);
  add('slider_thumb.diameter', b.sliderThumbDiameterFracModal, ref.slider_thumb.diameter);
  rect('cancel', b.cancel, ref.cancel);
  rect('use_crop', b.useCrop, ref.use_crop);
  add('modal.aspect_h_over_w', b.modalHeightPx / b.modalWidthPx, ref.modal.aspect_h_over_w);
  return r;
}
const f4 = (v) => (Number.isFinite(v) ? +v.toFixed(4) : null);
const summary = {};
for (const proto of ['hand', 'rac']) for (const width of [390, 1280]) {
  const f = join(here, 'out', `boxes-${proto}-${width}.json`);
  if (!existsSync(f)) { console.log(`missing ${f}`); continue; }
  const r = rows(JSON.parse(readFileSync(f, 'utf8')));
  const worst = r.slice().sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
  const over = r.filter((x) => Math.abs(x.dev) > TOL);
  summary[`${proto}-${width}`] = { tolerance: TOL, compared: r.length, withinTol: r.length - over.length, over: over.map((x) => ({ ...x, mine: f4(x.mine), ref: f4(x.ref), dev: f4(x.dev) })), worst3: worst.slice(0, 3).map((x) => `${x.name} ${f4(x.dev)}`) };
  console.log(`${proto}@${width}: ${r.length - over.length}/${r.length} within ${TOL}; over: ${over.map((x) => `${x.name} ${x.dev >= 0 ? '+' : ''}${x.dev.toFixed(3)}`).join(', ') || 'none'}`);
}
writeFileSync(join(here, 'out', 'geometry-comparison.json'), JSON.stringify(summary, null, 2));
