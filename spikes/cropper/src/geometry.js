// Pure geometry for the cropper spike. No DOM, no clock: plain values in, plain values out.
//
// Result contract (both prototypes):  { x, y, size, rotation }
//   Coordinates are SOURCE pixels of the stored image AFTER applying EXIF orientation
//   (the upright image the person sees). (x, y) is the top-left of the axis-aligned square
//   that has the crop's centre and side `size`; the real crop square is that square rotated
//   about its centre so its top edge points along angle -rotation (rotation = degrees the
//   person turned the image clockwise under the fixed stencil, i.e. the readout value).

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function normalizeDegrees(d) {
  // (-180, 180], never -0
  let v = ((((d + 180) % 360) + 360) % 360) - 180;
  if (v === -180) v = 180;
  return v === 0 ? 0 : v;
}

export const FINE_MIN = -45;
export const FINE_MAX = 45;

/** Split a total rotation into 90-degree quarter turns and fine degrees in [-45, 45]. */
export function splitRotation(total) {
  const t = normalizeDegrees(total);
  const quarter = Math.round(t / 90);
  const fine = t - quarter * 90;
  return { quarter: ((quarter % 4) + 4) % 4, fine: Math.abs(fine) < 1e-9 ? 0 : fine };
}
export function totalRotation(quarter, fine) {
  return normalizeDegrees(quarter * 90 + fine);
}
export function formatDegrees(d) {
  const v = Math.round(normalizeDegrees(d) * 10) / 10;
  return `${v === 0 ? 0 : v}°`;
}

/** Size of the upright image for a raw stored size and EXIF orientation 1..8. */
export function uprightSize(orientation, rawW, rawH) {
  return orientation >= 5 && orientation <= 8 ? { w: rawH, h: rawW } : { w: rawW, h: rawH };
}

/** Map an upright point to a raw stored point. (rawW, rawH are the stored dimensions.) */
export function uprightPointToRaw(orientation, rawW, rawH, a, b) {
  switch (orientation) {
    case 2: return [rawW - a, b];
    case 3: return [rawW - a, rawH - b];
    case 4: return [a, rawH - b];
    case 5: return [b, a];
    case 6: return [b, rawH - a];
    case 7: return [rawW - b, rawH - a];
    case 8: return [rawW - b, a];
    default: return [a, b];
  }
}
/** Map a raw point to the upright point (inverse of the above). */
export function rawPointToUpright(orientation, rawW, rawH, x, y) {
  switch (orientation) {
    case 2: return [rawW - x, y];
    case 3: return [rawW - x, rawH - y];
    case 4: return [x, rawH - y];
    case 5: return [y, x];
    case 6: return [rawH - y, x];
    case 7: return [rawH - y, rawW - x];
    case 8: return [y, rawW - x];
    default: return [x, y];
  }
}
// Linear part of upright->raw applied to a direction vector.
function uprightDirToRaw(orientation, dx, dy) {
  switch (orientation) {
    case 2: return [-dx, dy];
    case 3: return [-dx, -dy];
    case 4: return [dx, -dy];
    case 5: return [dy, dx];
    case 6: return [dy, -dx];
    case 7: return [-dy, -dx];
    case 8: return [-dy, dx];
    default: return [dx, dy];
  }
}
function rawDirToUpright(orientation, dx, dy) {
  switch (orientation) {
    case 2: return [-dx, dy];
    case 3: return [-dx, -dy];
    case 4: return [dx, -dy];
    case 5: return [dy, dx];
    case 6: return [-dy, dx];
    case 7: return [-dy, -dx];
    case 8: return [dy, -dx];
    default: return [dx, dy];
  }
}

/** { x, y, size, rotation } in upright pixels -> same shape in raw stored pixels. */
export function uprightCropToRaw(crop, orientation, rawW, rawH) {
  const cx = crop.x + crop.size / 2;
  const cy = crop.y + crop.size / 2;
  const [rcx, rcy] = uprightPointToRaw(orientation, rawW, rawH, cx, cy);
  const edge = rad(-crop.rotation);
  const [dx, dy] = uprightDirToRaw(orientation, Math.cos(edge), Math.sin(edge));
  const rotation = normalizeDegrees(-deg(Math.atan2(dy, dx)));
  return { x: rcx - crop.size / 2, y: rcy - crop.size / 2, size: crop.size, rotation };
}
/** Inverse of uprightCropToRaw. */
export function rawCropToUpright(crop, orientation, rawW, rawH) {
  const cx = crop.x + crop.size / 2;
  const cy = crop.y + crop.size / 2;
  const [ucx, ucy] = rawPointToUpright(orientation, rawW, rawH, cx, cy);
  const edge = rad(-crop.rotation);
  const [dx, dy] = rawDirToUpright(orientation, Math.cos(edge), Math.sin(edge));
  const rotation = normalizeDegrees(-deg(Math.atan2(dy, dx)));
  return { x: ucx - crop.size / 2, y: ucy - crop.size / 2, size: crop.size, rotation };
}

/** Read the EXIF orientation (1..8) from JPEG bytes; 1 when absent. */
export function readExifOrientation(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u[0] !== 0xff || u[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 < u.length) {
    if (u[p] !== 0xff) return 1;
    const marker = u[p + 1];
    const len = (u[p + 2] << 8) | u[p + 3];
    if (marker === 0xe1 && u[p + 4] === 0x45 && u[p + 5] === 0x78 && u[p + 6] === 0x69 && u[p + 7] === 0x66) {
      const t = p + 10; // TIFF header
      const le = u[t] === 0x49;
      const r16 = (o) => (le ? u[o] | (u[o + 1] << 8) : (u[o] << 8) | u[o + 1]);
      const r32 = (o) => (le ? (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0 : ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0);
      const ifd = t + r32(t + 4);
      const n = r16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (r16(e) === 0x0112) {
          const v = r16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    p += 2 + len;
  }
  return 1;
}

// ---- hand-written prototype maths (view <-> source), also pure ----

/** Contain-fit scale (view px per source px) of an upright image in a stage. */
export function containScale(imgW, imgH, stageW, stageH) {
  return Math.min(stageW / imgW, stageH / imgH);
}

/**
 * Stencil in view px {left, top, size} on a stage {w,h}, image rotated by `rotation`
 * degrees clockwise about its centre (which sits at the stage centre) -> crop result.
 */
export function viewStencilToCrop(st, rotation, img, stage) {
  const s = containScale(img.w, img.h, stage.w, stage.h);
  const vx = st.left + st.size / 2 - stage.w / 2;
  const vy = st.top + st.size / 2 - stage.h / 2;
  const t = rad(-rotation);
  const sx = (vx * Math.cos(t) - vy * Math.sin(t)) / s;
  const sy = (vx * Math.sin(t) + vy * Math.cos(t)) / s;
  const size = st.size / s;
  return { x: img.w / 2 + sx - size / 2, y: img.h / 2 + sy - size / 2, size, rotation: normalizeDegrees(rotation) };
}
export function cropToViewStencil(crop, img, stage) {
  const s = containScale(img.w, img.h, stage.w, stage.h);
  const sx = crop.x + crop.size / 2 - img.w / 2;
  const sy = crop.y + crop.size / 2 - img.h / 2;
  const t = rad(crop.rotation);
  const vx = (sx * Math.cos(t) - sy * Math.sin(t)) * s;
  const vy = (sx * Math.sin(t) + sy * Math.cos(t)) * s;
  const size = crop.size * s;
  return { left: stage.w / 2 + vx - size / 2, top: stage.h / 2 + vy - size / 2, size };
}

/**
 * Resize a square stencil {left, top, size} from handle `dir` (n,ne,e,se,s,sw,w,nw) by a pointer
 * delta (dx, dy), aspect locked. Corners keep the opposite corner fixed; edges keep the opposite
 * edge fixed and grow about the perpendicular centre. Clamped to the stage and `min`.
 */
export function resizeSquare(st, dir, dx, dy, stage, min) {
  const sx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
  const sy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
  const cxm = st.left + st.size / 2;
  const cym = st.top + st.size / 2;
  const px = sx * dx;
  const py = sy * dy;
  const d = sx && sy ? (Math.abs(px) >= Math.abs(py) ? px : py) : sx ? px : py;
  // anchor: fixed edge/corner coordinate
  const ax = sx > 0 ? st.left : sx < 0 ? st.left + st.size : cxm;
  const ay = sy > 0 ? st.top : sy < 0 ? st.top + st.size : cym;
  let maxX = sx > 0 ? stage.w - ax : sx < 0 ? ax : 2 * Math.min(cxm, stage.w - cxm);
  let maxY = sy > 0 ? stage.h - ay : sy < 0 ? ay : 2 * Math.min(cym, stage.h - cym);
  const size = Math.max(min, Math.min(st.size + d, maxX, maxY));
  const left = sx > 0 ? ax : sx < 0 ? ax - size : ax - size / 2;
  const top = sy > 0 ? ay : sy < 0 ? ay - size : ay - size / 2;
  return { left, top, size };
}
export function moveSquare(st, dx, dy, stage) {
  return {
    left: Math.max(0, Math.min(st.left + dx, stage.w - st.size)),
    top: Math.max(0, Math.min(st.top + dy, stage.h - st.size)),
    size: st.size,
  };
}

/** Stored (raw) pixel size from a JPEG's SOF segment; null when not found. */
export function readJpegSize(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 2;
  while (p + 9 < u.length) {
    if (u[p] !== 0xff) return null;
    const m = u[p + 1];
    const len = (u[p + 2] << 8) | u[p + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (u[p + 5] << 8) | u[p + 6], w: (u[p + 7] << 8) | u[p + 8] };
    }
    p += 2 + len;
  }
  return null;
}

/** JPEG bytes with every APP1 (EXIF) segment removed, so a browser decodes the raw stored pixels. */
export function stripExif(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = [u.subarray(0, 2)];
  let p = 2;
  while (p + 4 < u.length && u[p] === 0xff && u[p + 1] !== 0xda) {
    const len = (u[p + 2] << 8) | u[p + 3];
    if (u[p + 1] !== 0xe1) out.push(u.subarray(p, p + 2 + len));
    p += 2 + len;
  }
  out.push(u.subarray(p));
  const total = out.reduce((n, a) => n + a.length, 0);
  const r = new Uint8Array(total); let o = 0;
  for (const a of out) { r.set(a, o); o += a.length; }
  return r;
}
