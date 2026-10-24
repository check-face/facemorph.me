// Generates synthetic fixtures: an upright 640x480 scene of 40px colour cells with an asymmetric
// "F" marker, stored as raw JPEGs whose pixels are the inverse of the EXIF orientation transform,
// with the EXIF Orientation tag written. Applying the tag yields the identical upright scene.
// No personal photos. Re-run: npm run fixtures
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'fixtures');
mkdirSync(outDir, { recursive: true });

export const UP_W = 640;
export const UP_H = 480;
export const CELL = 40;

function exifApp1(orientation) {
  const b = [
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 + "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  return Buffer.from(b);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(async ({ UP_W, UP_H, CELL }) => {
  const up = document.createElement('canvas');
  up.width = UP_W; up.height = UP_H;
  const g = up.getContext('2d');
  for (let r = 0; r < UP_H / CELL; r++) for (let c = 0; c < UP_W / CELL; c++) {
    const h = (c * 47 + r * 131 + ((c * r) % 7) * 29) % 360;
    g.fillStyle = `hsl(${h} ${55 + ((c + r) % 3) * 12}% ${38 + ((c * 3 + r) % 4) * 9}%)`;
    g.fillRect(c * CELL, r * CELL, CELL, CELL);
  }
  // asymmetric marker: white F on black, top-left; white triangle bottom-right
  g.fillStyle = '#000'; g.fillRect(0, 0, 120, 120);
  g.fillStyle = '#fff';
  g.fillRect(30, 20, 20, 80); g.fillRect(30, 20, 60, 20); g.fillRect(30, 55, 40, 16);
  g.beginPath(); g.moveTo(640, 480); g.lineTo(520, 480); g.lineTo(640, 400); g.closePath(); g.fill();
  const out = {};
  for (const o of [1, 3, 6, 8]) {
    const swap = o >= 5;
    const raw = document.createElement('canvas');
    raw.width = swap ? UP_H : UP_W; raw.height = swap ? UP_W : UP_H;
    const rg = raw.getContext('2d');
    // raw = inverse of the orientation transform applied to the upright scene
    if (o === 1) rg.drawImage(up, 0, 0);
    if (o === 3) { rg.translate(UP_W, UP_H); rg.rotate(Math.PI); rg.drawImage(up, 0, 0); }
    if (o === 6) { rg.translate(0, UP_W); rg.rotate(-Math.PI / 2); rg.drawImage(up, 0, 0); } // upright = raw rotated 90 cw
    if (o === 8) { rg.translate(UP_H, 0); rg.rotate(Math.PI / 2); rg.drawImage(up, 0, 0); }
    const blob = await new Promise((res) => raw.toBlob(res, 'image/jpeg', 0.92));
    out[o] = Array.from(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}, { UP_W, UP_H, CELL });
await browser.close();

for (const [o, arr] of Object.entries(results)) {
  const jpeg = Buffer.from(arr);
  // drop any existing APP1 right after SOI is not needed: Chromium emits JFIF (APP0) only.
  const out = Buffer.concat([jpeg.subarray(0, 2), exifApp1(Number(o)), jpeg.subarray(2)]);
  writeFileSync(join(outDir, `scene-o${o}.jpg`), out);
  console.log(`scene-o${o}.jpg`, out.length, 'bytes');
}
