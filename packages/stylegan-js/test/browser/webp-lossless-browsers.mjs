// Real-browser exact-decode check for the VP8L encoder: Chromium, Firefox and WebKit decode files
// made by src/media/webp-lossless.ts and the pixels read back must equal the input.
//
//   node packages/stylegan-js/test/browser/webp-lossless-browsers.mjs
//
// Canvas getImageData may premultiply, which loses colour under non-opaque pixels in some engines.
// Opaque images are therefore compared in every browser; images with alpha are compared exactly
// where the browser reads them back exactly, and the JSON line says which (alphaExact).
import { createRequire } from 'node:module';
import { encodeVp8lWebp } from '../../src/media/webp-lossless.ts';

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright');

let seed = 987654321;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 24;
};

const cases = [];
const add = (name, width, height, fill, opaque) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      fill(rgba, p, x, y);
    }
  }
  cases.push({ name, width, height, rgba, opaque });
};
add(
  'noise-random-alpha',
  97,
  61,
  (d, p) => d.set([random(), random(), random(), random()], p),
  false,
);
add('noise-opaque', 128, 96, (d, p) => d.set([random(), random(), random(), 255], p), true);
add(
  'gradient-1024',
  1024,
  1024,
  (d, p, x, y) => d.set([x >> 2, y >> 2, (x + y) >> 3, 255], p),
  true,
);
add('pixel-1x1', 1, 1, (d, p) => d.set([12, 200, 99, 255], p), true);
add('pixel-1x1-alpha', 1, 1, (d, p) => d.set([12, 200, 99, 128], p), false);
add('size-3x7', 3, 7, (d, p, x, y) => d.set([x * 80, y * 30, x * y, 255], p), true);
add('all-transparent', 40, 30, () => {}, false);
add('one-colour', 200, 150, (d, p) => d.set([30, 60, 90, 255], p), true);
add('one-colour-translucent', 50, 50, (d, p) => d.set([30, 60, 90, 77], p), false);
add(
  'banded-runs',
  300,
  200,
  (d, p, x, y) => d.set([(y >> 4) * 16, 40, (x >> 6) * 50, 255], p),
  true,
);

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

// Runs in the page: decode the WebP, draw unpremultiplied, read back, report bytes (base64).
const decodeInPage = async ({ b64 }) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/webp' });
  let bitmap;
  let via = 'createImageBitmap';
  try {
    bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      via = 'img';
      const img = new Image();
      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('image failed to decode'));
        img.src = url;
      });
      bitmap = img;
    }
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000)
    s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  // Second readback through WebGL, which can upload an unpremultiplied bitmap and read it back
  // without a premultiply step, so colour under translucent pixels survives where 2D canvas loses it.
  let gl = null;
  try {
    const glCanvas = document.createElement('canvas');
    glCanvas.width = w;
    glCanvas.height = h;
    const context = glCanvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: true,
      antialias: false,
    });
    if (context && via === 'createImageBitmap') {
      const texture = context.createTexture();
      context.bindTexture(context.TEXTURE_2D, texture);
      context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      context.pixelStorei(context.UNPACK_COLORSPACE_CONVERSION_WEBGL, context.NONE);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA8,
        context.RGBA,
        context.UNSIGNED_BYTE,
        bitmap,
      );
      const framebuffer = context.createFramebuffer();
      context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
      context.framebufferTexture2D(
        context.FRAMEBUFFER,
        context.COLOR_ATTACHMENT0,
        context.TEXTURE_2D,
        texture,
        0,
      );
      const pixels = new Uint8Array(w * h * 4);
      context.readPixels(0, 0, w, h, context.RGBA, context.UNSIGNED_BYTE, pixels);
      // WebGL rows run bottom-up when the bitmap is uploaded unflipped; here the texture row 0 is the top.
      let t = '';
      for (let i = 0; i < pixels.length; i += 0x8000)
        t += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
      gl = btoa(t);
    }
  } catch {
    gl = null;
  }
  return { via, w, h, b64: btoa(s), gl };
};

let failed = false;
for (const [name, launcher] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  let browser;
  try {
    browser = await launcher.launch();
  } catch (error) {
    failed = true;
    console.log(
      JSON.stringify({ browser: name, error: `launch failed: ${String(error).split('\n')[0]}` }),
    );
    continue;
  }
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>t</title>');
  for (const c of cases) {
    const file = encodeVp8lWebp(c.rgba, c.width, c.height);
    const line = {
      browser: name,
      case: c.name,
      width: c.width,
      height: c.height,
      bytes: file.length,
      opaque: c.opaque,
    };
    try {
      const res = await page.evaluate(decodeInPage, {
        b64: toBase64(file),
        width: c.width,
        height: c.height,
      });
      const got = Buffer.from(res.b64, 'base64');
      let diff = -1;
      let mismatches = 0;
      for (let i = 0; i < c.rgba.length; i++) {
        if (got[i] !== c.rgba[i]) {
          if (diff < 0) diff = i;
          mismatches++;
        }
      }
      const sizeOk = res.w === c.width && res.h === c.height && got.length === c.rgba.length;
      line.via = res.via;
      line.exact = sizeOk && mismatches === 0;
      if (!line.exact) {
        line.mismatches = mismatches;
        line.firstDiff = diff;
        if (diff >= 0) {
          line.expected = Array.from(c.rgba.subarray(diff & ~3, (diff & ~3) + 4));
          line.got = Array.from(got.subarray(diff & ~3, (diff & ~3) + 4));
        }
        // Premultiplied readback of a non-opaque image is a canvas limit, not an encoder fault,
        // when the decoded alpha channel still matches everywhere.
        let alphaMatches = sizeOk;
        for (let i = 3; alphaMatches && i < c.rgba.length; i += 4)
          if (got[i] !== c.rgba[i]) alphaMatches = false;
        line.alphaExact = alphaMatches;
        if (res.gl !== null) {
          const glBytes = Buffer.from(res.gl, 'base64');
          line.glExact = glBytes.length === c.rgba.length && glBytes.equals(Buffer.from(c.rgba));
        }
        if (c.opaque || !alphaMatches) failed = true;
        else if (line.glExact)
          line.note = '2D canvas premultiplies; WebGL unpremultiplied readback is exact';
        else if (name === 'webkit') {
          // The WebKit build here keeps decoded pixels premultiplied, so neither 2D nor WebGL can
          // return the original colour under translucent pixels. Alpha and opaque pixels are still
          // exact; the translucent colour is verified by Chromium and Firefox only.
          line.untestedColourUnderAlpha = true;
          line.note =
            'WebKit stores premultiplied pixels: alpha exact, translucent colour unverifiable here';
        } else {
          failed = true;
          line.note = 'colour differs and no exact unpremultiplied readback was available';
        }
      }
    } catch (error) {
      failed = true;
      line.exact = false;
      line.error = String(error).split('\n')[0];
    }
    console.log(JSON.stringify(line));
  }
  await browser.close();
}
process.exit(failed ? 1 : 0);
