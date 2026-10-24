// Pure-logic tests: plain values in, plain values out. No browser, no mocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeDegrees, splitRotation, totalRotation, formatDegrees, uprightCropToRaw, rawCropToUpright, uprightSize,
  readExifOrientation, readJpegSize, stripExif, viewStencilToCrop, cropToViewStencil, resizeSquare, moveSquare,
} from '../src/geometry.js';
import { root } from './lib.mjs';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} !~ ${b}`);
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('normalizeDegrees wraps into (-180,180] without -0', () => {
  assert.equal(normalizeDegrees(0), 0); assert.equal(normalizeDegrees(270), -90); assert.equal(normalizeDegrees(-180), 180);
  assert.equal(normalizeDegrees(450), 90); assert.ok(Object.is(normalizeDegrees(-0), 0));
});
test('split/total rotation round trip and readout format', () => {
  assert.deepEqual(splitRotation(17.5), { quarter: 0, fine: 17.5 });
  assert.deepEqual(splitRotation(100), { quarter: 1, fine: 10 });
  assert.deepEqual(splitRotation(-90), { quarter: 3, fine: 0 });
  assert.equal(totalRotation(1, 17.5), 107.5); assert.equal(totalRotation(3, 0), -90);
  assert.equal(formatDegrees(0), '0°'); assert.equal(formatDegrees(17.5), '17.5°'); assert.equal(formatDegrees(270), '-90°');
});
test('uprightSize swaps for orientations 5..8', () => {
  assert.deepEqual(uprightSize(1, 640, 480), { w: 640, h: 480 }); assert.deepEqual(uprightSize(6, 480, 640), { w: 640, h: 480 });
});
// raw 480x640 with orientation 6 -> upright 640x480 (raw rotated 90 clockwise).
test('orientation 6: upright top-left crop maps to raw top-right-ish corner values', () => {
  // upright point (a,b) -> raw (b, rawH - a) = (b, 640 - a)
  const r = uprightCropToRaw({ x: 100, y: 50, size: 40, rotation: 0 }, 6, 480, 640);
  // centre upright (120,70) -> raw (70, 520); size same
  near(r.x + 20, 70); near(r.y + 20, 520); assert.equal(r.size, 40); near(r.rotation, 90, 1e-9);
});
test('orientation 8 and 3 centres', () => {
  const r8 = uprightCropToRaw({ x: 100, y: 50, size: 40, rotation: 0 }, 8, 480, 640); // (120,70)->(rawW-b, a)=(410,120)
  near(r8.x + 20, 410); near(r8.y + 20, 120); near(r8.rotation, -90);
  const r3 = uprightCropToRaw({ x: 100, y: 50, size: 40, rotation: 17.5 }, 3, 640, 480); // (120,70)->(520,410)
  near(r3.x + 20, 520); near(r3.y + 20, 410); near(r3.rotation, normalizeDegrees(17.5 + 180));
});
test('upright->raw->upright round trips for all 8 orientations', () => {
  for (let o = 1; o <= 8; o++) {
    const raw = o <= 4 ? [640, 480] : [480, 640];
    const c = { x: 123.5, y: 77.25, size: 90, rotation: 17.5 };
    const back = rawCropToUpright(uprightCropToRaw(c, o, raw[0], raw[1]), o, raw[0], raw[1]);
    near(back.x, c.x, 1e-9, `o${o} x`); near(back.y, c.y, 1e-9, `o${o} y`); near(back.rotation, c.rotation, 1e-9, `o${o} rot`);
  }
});
test('EXIF orientation and JPEG size are read from the committed fixtures', () => {
  for (const [o, w, h] of [[1, 640, 480], [3, 640, 480], [6, 480, 640], [8, 480, 640]]) {
    const b = readFileSync(join(root, 'fixtures', `scene-o${o}.jpg`));
    assert.equal(readExifOrientation(b), o); assert.deepEqual(readJpegSize(b), { w, h });
    assert.equal(readExifOrientation(stripExif(b)), 1);
  }
  assert.equal(readExifOrientation(new Uint8Array([1, 2, 3])), 1);
});
test('view <-> crop mapping is an inverse pair and honours rotation', () => {
  const img = { w: 640, h: 480 }, stage = { w: 400, h: 400 };
  const st = { left: 40, top: 40, size: 320 };
  const c0 = viewStencilToCrop(st, 0, img, stage); // scale 0.625
  near(c0.size, 512); near(c0.x, 64); near(c0.y, -16);
  for (const rot of [0, 90, 17.5, -33]) {
    const c = viewStencilToCrop({ left: 77, top: 120, size: 150 }, rot, img, stage);
    const s = cropToViewStencil(c, img, stage);
    near(s.left, 77, 1e-9); near(s.top, 120, 1e-9); near(s.size, 150, 1e-9);
  }
  // 90 degrees: a stencil right of centre sits at the image's top (image turned clockwise under it)
  const c90 = viewStencilToCrop({ left: 300, top: 150, size: 100 }, 90, img, stage); // view centre offset (+150,0)
  near(c90.x + c90.size / 2, 320, 1e-9); // R(-90)(150,0) = (0,-150)/0.625 -> y = 240-240
  near(c90.y + c90.size / 2, 0, 1e-9);
});
test('resizeSquare: corners keep opposite corner, edges keep opposite edge, aspect stays square', () => {
  const stage = { w: 400, h: 400 }, st = { left: 100, top: 100, size: 200 };
  const se = resizeSquare(st, 'se', -30, -10, stage, 40); // dominant |dx|=30 -> size 170
  assert.deepEqual(se, { left: 100, top: 100, size: 170 });
  const nw = resizeSquare(st, 'nw', 30, 10, stage, 40); // size 170, anchor SE corner (300,300)
  assert.deepEqual(nw, { left: 130, top: 130, size: 170 });
  const e = resizeSquare(st, 'e', -50, 999, stage, 40); // size 150, left edge fixed, vertically centred
  assert.deepEqual(e, { left: 100, top: 125, size: 150 });
  const n = resizeSquare(st, 'n', 0, 40, stage, 40); // size 160, bottom edge fixed (300), centred horizontally
  assert.deepEqual(n, { left: 120, top: 140, size: 160 });
  assert.equal(resizeSquare(st, 'se', -999, -999, stage, 40).size, 40); // min
  assert.equal(resizeSquare(st, 'se', 999, 999, stage, 40).size, 300); // stage bound
});
test('moveSquare clamps to the stage', () => {
  assert.deepEqual(moveSquare({ left: 10, top: 10, size: 100 }, -50, 500, { w: 300, h: 300 }), { left: 0, top: 200, size: 100 });
});

let failed = 0;
for (const c of cases) {
  try { c.fn(); console.log(`ok   geometry: ${c.name}`); } catch (e) { failed++; console.log(`FAIL geometry: ${c.name}\n  ${e.message}`); }
}
export const geometryResult = { total: cases.length, failed };
if (process.argv[1].endsWith('geometry.test.mjs')) process.exit(failed ? 1 : 0);
