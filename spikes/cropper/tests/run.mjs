// Browser tests for both prototypes. Real browsers, real built bundles, real files. No mocks.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, engines, open, root, PROTOS, VIEWPORTS } from './lib.mjs';
import { geometryResult } from './geometry.test.mjs';
import { stripExif } from '../src/geometry.js';

const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const results = []; // {name, ok, detail}
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log(`ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}
const BROWSERS = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',');
const STENCIL = '[data-testid="stencil"], .advanced-cropper-rectangle-stencil';
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (eps ${eps})`);

const server = await serve();
const launched = {};
for (const b of BROWSERS) {
  try { launched[b] = await engines[b].launch(); } catch (e) { results.push({ name: `launch ${b}`, ok: false, detail: String(e.message).split('\n')[0], untested: true }); console.log(`SKIP ${b}: ${String(e.message).split('\n')[0]}`); }
}

// ---------- 1, 2, 3: screenshots, DOM counts, boxes ----------
async function measureBoxes(page) {
  return page.evaluate((STENCIL) => {
    const q = (s) => document.querySelector(s);
    const modal = q('[data-testid="modal"]').getBoundingClientRect();
    const W = modal.width;
    const box = (r) => ({ x: (r.left - modal.left) / W, y: (r.top - modal.top) / W, w: r.width / W, h: r.height / W, cx: (r.left + r.width / 2 - modal.left) / W, cy: (r.top + r.height / 2 - modal.top) / W, px: { w: r.width, h: r.height } });
    const rect = (s) => q(s).getBoundingClientRect();
    const sten = document.querySelector(STENCIL).getBoundingClientRect();
    const rel = (r) => ({ x: (r.left - sten.left) / sten.width, y: (r.top - sten.top) / sten.width, w: r.width / sten.width, h: r.height / sten.width, cx: (r.left + r.width / 2 - sten.left) / sten.width, cy: (r.top + r.height / 2 - sten.top) / sten.width });
    const res = { modalWidthPx: W, modalHeightPx: modal.height };
    res.modal = box(modal);
    const tr = document.createRange(); tr.selectNodeContents(q('.title')); res.title = box(tr.getBoundingClientRect());
    res.stage = box(rect('[data-testid="stage"]'));
    res.stencil = box(sten);
    res.handles = {};
    for (const h of document.querySelectorAll('[data-testid^="handle-"]')) {
      const r = h.getBoundingClientRect(); const cs = getComputedStyle(h.querySelector('.hit') || h, '::after');
      res.handles[h.dataset.testid.slice(7)] = { ...box(r), visibleSquarePx: parseFloat(cs.width), centreRelStencil: { x: (r.left + r.width / 2 - sten.left) / sten.width, y: (r.top + r.height / 2 - sten.top) / sten.width }, visibleSquareFracModal: parseFloat(cs.width) / W };
    }
    res.guideRelStencil = rel(rect('[data-testid="guide"]'));
    const eyes = [...document.querySelectorAll('[data-testid^="eye-"]')].map((e) => rel(e.getBoundingClientRect()));
    res.eyesRelStencil = eyes; res.eyeDiameterFracStencil = eyes[0].w; res.eyeSpacingFracStencil = Math.abs(eyes[1].cx - eyes[0].cx);
    const eyeAbs = [...document.querySelectorAll('[data-testid^="eye-"]')].map((e) => box(e.getBoundingClientRect()));
    res.eyeCentresModal = eyeAbs.map((e) => ({ x: e.cx, y: e.cy }));
    res.eyeDiameterFracModal = eyeAbs[0].w; res.eyeSpacingFracModal = Math.abs(eyeAbs[1].cx - eyeAbs[0].cx);
    res.rotateButton = box(rect('[data-testid="rotate-button"]'));
    res.rotateIcon = box(rect('[data-testid="rotate-button"] svg'));
    res.readout = box(rect('[data-testid="rotation-readout"]'));
    const sl = q('[data-testid="rotation-slider"]'); const slr = sl.getBoundingClientRect();
    res.slider = box(slr);
        res.sliderThumbDiameterPx = 10; // thumb is styled 10px in both prototypes (shared CSS)
    res.sliderThumbDiameterFracModal = res.sliderThumbDiameterPx / W;
    res.sliderThumbCentre = { x: (slr.left + slr.width / 2 - modal.left) / W, y: (slr.top + slr.height / 2 - modal.top) / W };
    res.cancel = box(rect('[data-testid="cancel"]'));
    res.useCrop = box(rect('[data-testid="use-crop"]'));
    return res;
  }, STENCIL);
}

for (const bname of BROWSERS) {
  const browser = launched[bname]; if (!browser) continue;
  for (const proto of PROTOS) for (const width of [390, 1280]) {
    const tag = `${bname}:${proto}@${width}`;
    let ctx;
    await check(`render+DOM ${tag}`, async () => {
      ctx = await open(browser, server.base, proto, width, 'scene-o1.jpg');
      const { page, errors } = ctx;
      await page.screenshot({ path: join(out, `shot-${bname}-${proto}-${width}.png`) });
      const n = (s) => page.locator(s).count();
      assert.equal(await n('[data-testid^="handle-"]'), 8, 'handles');
      assert.equal(await n('[data-testid="guide"]'), 1, 'guide');
      assert.equal(await n('[data-testid^="eye-"]'), 2, 'eyes');
      assert.equal(await n('[data-testid="rotate-button"]'), 1, 'rotate button');
      assert.equal(await n('[data-testid="rotation-slider"]'), 1, 'slider');
      assert.equal(await n('[data-testid="rotation-readout"]'), 1, 'readout');
      const g = await page.evaluate(() => { const r = document.querySelector('[data-testid="guide"]').getBoundingClientRect(); return { w: r.width, h: r.height, br: getComputedStyle(document.querySelector('[data-testid="guide"]')).borderRadius }; });
      assert.ok(g.h > g.w && g.br.includes('50%'), `guide is an oval ${JSON.stringify(g)}`);
      const sl = await page.evaluate(() => ({ s: document.querySelector('[data-testid="rotation-slider"]').getBoundingClientRect().width, c: document.querySelector('[data-testid="content"]').getBoundingClientRect().width }));
      assert.ok(sl.s >= 0.9 * sl.c, `slider width ${sl.s} >= 90% of content ${sl.c}`);
      // rotate button: 90 deg per press (readout and state)
      const read = async () => (await page.locator('[data-testid="rotation-readout"]').textContent());
      const seq = [];
      for (let i = 0; i < 4; i++) { await page.locator('[data-testid="rotate-button"]').click(); seq.push(await read()); }
      assert.deepEqual(seq, ['90°', '180°', '-90°', '0°'], 'rotate sequence');
      // slider live readout
      await page.locator('[data-testid="rotation-slider"]').fill('17.5');
      assert.equal(await read(), '17.5°');
      assert.equal((await page.evaluate(() => __cropper.state())).total, 17.5);
      await page.locator('[data-testid="rotation-slider"]').fill('-30');
      assert.equal(await read(), '-30°');
      // the image really rotated: engine result carries the same rotation
      near((await page.evaluate(() => __cropper.getResult())).rotation, -30, 1e-6, 'engine rotation');
      assert.deepEqual(errors, [], 'console errors');
      return { slider: sl, guide: g };
    });
    await check(`boxes ${tag}`, async () => {
      await ctx.page.locator('[data-testid="rotation-slider"]').fill('0');
      const boxes = await measureBoxes(ctx.page);
      if (bname === 'chromium') writeFileSync(join(out, `boxes-${proto}-${width}.json`), JSON.stringify(boxes, null, 2));
      else writeFileSync(join(out, `boxes-${proto}-${width}-${bname}.json`), JSON.stringify(boxes, null, 2));
      assert.equal(Object.keys(boxes.handles).length, 8);
    });
    await ctx?.context.close();
  }
}

// ---------- 4: coordinate test ----------
const ORIENTS = [1, 3, 6, 8];
const ROTS = [0, 90, 17.5];
const CROPS = [{ x: 220, y: 140, size: 160 }, { x: 320, y: 240, size: 120 }]; // centres (300,220) and (380,300): cell centres
async function colourAt(page, bytes, x, y) {
  const b64 = Buffer.from(bytes).toString('base64');
  return page.evaluate(async ({ b64, x, y }) => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data; const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return s.map((v) => v / 25);
  }, { b64, x, y });
}
if (launched.chromium) {
  const browser = launched.chromium;
  for (const bname of BROWSERS.filter((b) => launched[b])) {
    const rawResults = {};
    for (const proto of PROTOS) rawResults[proto] = {};
    for (const o of ORIENTS) {
      const fileBytes = readFileSync(join(root, 'fixtures', `scene-o${o}.jpg`));
      for (const proto of PROTOS) {
        await check(`coords ${bname}:${proto} exif${o}`, async () => {
          const { page, context } = await open(launched[bname], server.base, proto, 1280, `scene-o${o}.jpg`);
          const info = await page.evaluate(() => __cropper.info());
          assert.equal(info.orientation, o); assert.deepEqual(info.upright, { w: 640, h: 480 }, 'upright size');
          for (const rot of ROTS) for (const [ci, crop] of CROPS.entries()) {
            const want = { ...crop, rotation: rot };
            await page.evaluate((w) => __cropper.setCrop(w), want);
            await page.waitForTimeout(60);
            const got = await page.evaluate(() => __cropper.getResult());
            for (const k of ['x', 'y', 'size']) near(got[k], want[k], 1, `${proto} o${o} rot${rot} crop${ci} upright ${k}`);
            near(((got.rotation - rot + 540) % 360) - 180, 0, 0.01, 'rotation');
            const raw = await page.evaluate(() => __cropper.getRawResult());
            rawResults[proto][`${o}|${rot}|${ci}`] = raw;
            // ground truth: colour at the crop centre of the upright scene (o1 fixture) equals the colour at the mapped RAW centre
            const o1 = readFileSync(join(root, 'fixtures', 'scene-o1.jpg'));
            const upC = await colourAt(page, o1, crop.x + crop.size / 2, crop.y + crop.size / 2);
            const rawC = await colourAt(page, stripExif(fileBytes), raw.x + raw.size / 2, raw.y + raw.size / 2);
            for (let i = 0; i < 3; i++) near(upC[i], rawC[i], 14, `colour channel ${i} at mapped raw centre (${raw.x + raw.size / 2},${raw.y + raw.size / 2})`);
          }
          await context.close();
          return 'ok';
        });
      }
    }
    await check(`coords ${bname}: both prototypes give the same raw source pixels (<=1px)`, async () => {
      let n = 0;
      for (const key of Object.keys(rawResults.hand)) {
        const a = rawResults.hand[key], b = rawResults.rac[key];
        assert.ok(a && b, `missing ${key}`);
        for (const k of ['x', 'y', 'size']) near(a[k], b[k], 1, `raw ${k} @${key}`);
        near(((a.rotation - b.rotation + 540) % 360) - 180, 0, 0.01, `raw rotation @${key}`);
        n++;
      }
      assert.equal(n, ORIENTS.length * ROTS.length * CROPS.length);
      return { compared: n };
    });
  }
}

// ---------- 5: operated touch check, 390 px, Chromium (CDP touch) ----------
async function touch(cdp, pts) { // pts: [{x,y}] first = start, last = end
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
  for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const path = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const INWARD = { nw: [1, 1], n: [0, 1], ne: [-1, 1], e: [-1, 0], se: [-1, -1], s: [0, -1], sw: [1, -1], w: [1, 0] };
const touchReport = {};
if (launched.chromium) for (const proto of PROTOS) {
  const rep = (touchReport[proto] = {});
  await check(`touch ${proto}@390 stencil drag, 8 handle resizes, rotate button + slider`, async () => {
    const { page, context } = await open(launched.chromium, server.base, proto, 390, 'scene-o1.jpg');
    const cdp = await context.newCDPSession(page);
    const base = { x: 200, y: 120, size: 240, rotation: 0 };
    const reset = async () => { await page.evaluate((c) => __cropper.setCrop(c), base); await page.waitForTimeout(80); };
    const centreOf = async (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const hitIs = (pt, sel) => page.evaluate(({ pt, sel }) => { const el = document.elementFromPoint(pt.x, pt.y); const t = document.querySelector(sel); return !!el && (el === t || t.contains(el)); }, { pt, sel });
    const vpScroll = () => page.evaluate(() => window.scrollY);
    assert.equal(await vpScroll(), 0);

    // stencil drag
    await reset();
    const sc = await centreOf(STENCIL);
    assert.ok(await page.evaluate(({ pt, S }) => { const el = document.elementFromPoint(pt.x, pt.y); return !!el.closest(S); }, { pt: sc, S: STENCIL }), 'stencil centre hit-test');
    const r0 = await page.evaluate(() => __cropper.getResult());
    await touch(cdp, path(sc, { x: sc.x + 60, y: sc.y + 40 }));
    const r1 = await page.evaluate(() => __cropper.getResult());
    const stageW = await page.evaluate(() => document.querySelector('[data-testid="stage"]').getBoundingClientRect().width);
    const scale = stageW / 640; // contain-fit scale (hand) / approx for RAC
    rep.stencilDrag = { dxSrc: r1.x - r0.x, dySrc: r1.y - r0.y, expectedDxSrc: 60 / scale, expectedDySrc: 40 / scale };
    assert.ok(r1.x > r0.x + 5 && r1.y > r0.y + 5, `stencil moved ${JSON.stringify(rep.stencilDrag)}`);
    near(r1.size, r0.size, 0.5, 'size unchanged by move');
    if (proto === 'hand') { near(r1.x - r0.x, 60 / scale, 1.5, 'dx'); near(r1.y - r0.y, 40 / scale, 1.5, 'dy'); }

    // 8 handles
    rep.handles = {};
    for (const [dir, [ix, iy]] of Object.entries(INWARD)) {
      await reset();
      const sel = `[data-testid="handle-${dir}"]`;
      const c = await centreOf(sel);
      assert.ok(await hitIs(c, sel), `elementFromPoint at ${dir} handle centre is that handle`);
      const a = await page.evaluate(() => __cropper.getResult());
      await touch(cdp, path(c, { x: c.x + ix * 28, y: c.y + iy * 28 }));
      const b = await page.evaluate(() => __cropper.getResult());
      const ds = b.size - a.size;
      // which edges stayed: report anchor drift (centre-relative) for corners/edges
      rep.handles[dir] = { sizeBefore: a.size, sizeAfter: b.size, dSize: ds, dLeft: b.x - a.x, dTop: b.y - a.y, dRight: b.x + b.size - (a.x + a.size), dBottom: b.y + b.size - (a.y + a.size) };
      assert.ok(ds < -10, `${dir}: size shrank (${ds.toFixed(1)} src px)`);
      assert.ok(Math.abs(b.rotation) < 1e-6);
    }
    // rotate button via touch tap
    await reset();
    const btn = await centreOf('[data-testid="rotate-button"]');
    assert.ok(await hitIs(btn, '[data-testid="rotate-button"]'), 'rotate button hit-test');
    await page.touchscreen.tap(btn.x, btn.y);
    assert.equal(await page.locator('[data-testid="rotation-readout"]').textContent(), '90°');
    await page.touchscreen.tap(btn.x, btn.y);
    assert.equal(await page.locator('[data-testid="rotation-readout"]').textContent(), '180°');
    await page.touchscreen.tap(btn.x, btn.y); await page.touchscreen.tap(btn.x, btn.y);
    assert.equal(await page.locator('[data-testid="rotation-readout"]').textContent(), '0°');
    // slider drag by touch
    const sl = await page.evaluate(() => { const r = document.querySelector('[data-testid="rotation-slider"]').getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height / 2 }; });
    const thumbR = 5, usable = sl.w - 2 * thumbR;
    const from = { x: sl.l + thumbR + usable * 0.5, y: sl.y };
    assert.ok(await hitIs(from, '[data-testid="rotation-slider"]'), 'slider thumb hit-test');
    await touch(cdp, path(from, { x: sl.l + thumbR + usable * 0.75, y: sl.y }));
    const txt = await page.locator('[data-testid="rotation-readout"]').textContent();
    const val = parseFloat(txt);
    rep.sliderDrag = { readout: txt };
    near(val, 22.5, 2.5, 'slider touch drag value');
    near((await page.evaluate(() => __cropper.getResult())).rotation, val, 0.01, 'engine follows slider');
    await context.close();
    return rep;
  });
}

// ---------- extras probes (informational, recorded in out/extras.json) ----------
const extras = {};
if (launched.chromium) {
  await check('extras: react-advanced-cropper wheel zoom, stencil past photo edge (probes)', async () => {
    const { page, context } = await open(launched.chromium, server.base, 'rac', 1280, 'scene-o1.jpg', {}, '&zoom=1&restrict=none');
    const va0 = await page.evaluate(() => __cropper.raw().getVisibleArea());
    const box = await page.evaluate(() => { const r = document.querySelector('[data-testid="stage"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, -400); await page.waitForTimeout(400);
    const va1 = await page.evaluate(() => __cropper.raw().getVisibleArea());
    extras.wheelZoom = { visibleWidthBefore: va0.width, visibleWidthAfter: va1.width, zoomed: va1.width < va0.width * 0.95 };
    await page.evaluate(() => __cropper.raw().setCoordinates({ left: -60, top: -40, width: 200, height: 200 }, { immediately: true }));
    await page.waitForTimeout(200);
    const c = await page.evaluate(() => __cropper.raw().getCoordinates());
    extras.pastEdge = { requested: { left: -60, top: -40 }, got: c, outsidePhoto: c.left < 0 || c.top < 0 };
    await context.close();
    return extras;
  });
  // hand-written: stencil already extends past the photo (letterbox / photo edge) because it is clamped to the stage, not the photo
  await check('extras: hand-written stencil can extend past the photo edge (stage-clamped)', async () => {
    const { page, context } = await open(launched.chromium, server.base, 'hand', 1280, 'scene-o1.jpg');
    const r = await page.evaluate(() => __cropper.getResult());
    extras.handPastEdge = { y: r.y, size: r.size, outsidePhoto: r.y < 0 || r.x < 0 || r.x + r.size > 640 || r.y + r.size > 480 };
    assert.ok(extras.handPastEdge.outsidePhoto);
    await context.close();
  });
}
writeFileSync(join(out, 'extras.json'), JSON.stringify(extras, null, 2));

// ---------- summary ----------
writeFileSync(join(out, 'touch-report.json'), JSON.stringify(touchReport, null, 2));
await Promise.all(Object.values(launched).map((b) => b.close()));
await server.close();
const failed = results.filter((r) => !r.ok && !r.untested);
const summary = { geometryUnit: geometryResult, browserChecks: { total: results.length, passed: results.filter((r) => r.ok).length, failed: failed.length, untested: results.filter((r) => r.untested).length }, failures: failed.map((f) => ({ name: f.name, detail: f.detail })) };
writeFileSync(join(out, 'results.json'), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(failed.length || geometryResult.failed ? 1 : 0);
