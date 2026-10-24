#!/usr/bin/env python3
"""Measure the three locked legacy encode-dialog screenshots (fm-bbhu).

Reads `images/crop image.png`, `images/crop 2.png` and `images/failed to align.png`
from the locked reference bundle, verifies each against the bundle's SHA256SUMS, and
writes two deterministic JSON files (sorted keys, fixed rounding, trailing newline):

  docs/design/legacy-encode-dialog-geometry.json   boxes as fractions of modal width
  docs/design/legacy-encode-dialog-colours.json    colour table, WCAG contrast, light theme

The images contain face photographs: only measurements are written; no pixels are copied.
Every element is found by colour/shape segmentation inside a search region derived from
previously found elements, and each step asserts its expected count/shape and fails loudly.

Run (needs numpy, Pillow and scipy; e.g. `python3 -m venv /tmp/v && /tmp/v/bin/pip install numpy pillow scipy`):

  python3 scripts/design/measure-legacy-dialog.py            # write both JSON files
  python3 scripts/design/measure-legacy-dialog.py --check    # recompute; exit 1 if committed files differ
  python3 scripts/design/measure-legacy-dialog.py --bundle DIR --out-dir DIR

Default bundle: ../reference-locks/2026-10-11-original-plan-and-images relative to the repo root.
Unit tests of the pure helpers: python3 -m unittest scripts/design/measure_legacy_dialog_test.py

Conventions: a Box is (x0, y0, x1, y1) in pixels with x1/y1 exclusive. A "fraction box" is
{x, y, w, h} with every number divided by the modal width (both axes) after subtracting the
modal's top-left, rounded to 4 decimals. Modal pixel sizes are reported alongside.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROUND = 4
CORNER_INSET = 6  # px kept away from the modal's rounded corners when searching
INK_THRESHOLD = 24  # L1 RGB distance from the background that counts as ink
IMAGES = {
    "confirmation": "images/crop image.png",
    "editor": "images/crop 2.png",
    "failure": "images/failed to align.png",
}
warnings.filterwarnings("ignore", message="Mean of empty slice")  # handle zones are NaN-masked on purpose
EIGHT_ADJACENT = np.ones((3, 3), dtype=bool)


# ---------------------------------------------------------------- pure helpers
def srgb_to_linear(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb) -> float:
    r, g, b = (srgb_to_linear(float(v)) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def to_hex(rgb) -> str:
    return "#%02X%02X%02X" % tuple(int(round(float(v))) for v in rgb)


def from_hex(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def composite(fg, bg, alpha: float):
    """Opaque result of fg at `alpha` over bg."""
    return tuple(float(f) * alpha + float(b) * (1.0 - alpha) for f, b in zip(fg, bg))


def box_w(b):
    return b[2] - b[0]


def box_h(b):
    return b[3] - b[1]


def box_centre(b):
    return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def box_to_fractions(box, origin, scale, nd: int = ROUND) -> dict:
    """Pixel box -> {x,y,w,h} relative to `origin` (x, y) and divided by `scale` px."""
    return {
        "x": round((box[0] - origin[0]) / scale, nd),
        "y": round((box[1] - origin[1]) / scale, nd),
        "w": round((box[2] - box[0]) / scale, nd),
        "h": round((box[3] - box[1]) / scale, nd),
    }


def point_to_fractions(pt, origin, scale, nd: int = ROUND) -> dict:
    return {"x": round((pt[0] - origin[0]) / scale, nd), "y": round((pt[1] - origin[1]) / scale, nd)}


def colour_mask(arr, rgb, tol: int = 0):
    """True where every channel is within `tol` of rgb."""
    return (np.abs(arr.astype(np.int32) - np.asarray(rgb, dtype=np.int32)).max(axis=-1) <= tol)


def l1_distance(arr, rgb):
    return np.abs(arr.astype(np.int32) - np.asarray(rgb, dtype=np.int32)).sum(axis=-1)


def mode_colour(pixels):
    """Most frequent exact colour (ties: lowest value) of an (N,3) array."""
    px = np.asarray(pixels).reshape(-1, 3)
    if px.shape[0] == 0:
        raise AssertionError("mode_colour: no pixels")
    u, counts = np.unique(px, axis=0, return_counts=True)
    return tuple(int(v) for v in u[int(np.argmax(counts))])


def median_colour(pixels):
    px = np.asarray(pixels).reshape(-1, 3)
    if px.shape[0] == 0:
        raise AssertionError("median_colour: no pixels")
    return tuple(float(v) for v in np.median(px, axis=0))


def bbox_of_mask(mask, offset=(0, 0)):
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        raise AssertionError("bbox_of_mask: empty mask")
    return (int(xs.min()) + offset[0], int(ys.min()) + offset[1], int(xs.max()) + 1 + offset[0], int(ys.max()) + 1 + offset[1])


def components(mask, min_area: int = 1):
    """8-connected components as [(box, area, label_mask_index)], ordered by (y0, x0)."""
    lab, n = ndi.label(mask, structure=EIGHT_ADJACENT)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        area = int((lab[sl] == i).sum())
        if area >= min_area:
            out.append(((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop), area, i))
    out.sort(key=lambda t: (t[0][1], t[0][0]))
    return out, lab


def largest_component(mask, min_area: int = 1):
    comps, lab = components(mask, min_area)
    if not comps:
        raise AssertionError("largest_component: none found")
    box, area, i = max(comps, key=lambda t: t[1])
    return box, area, lab == i


def runs(flags, min_gap: int = 1):
    """Runs of True in a 1-D bool sequence as (start, stop); runs closer than min_gap merge."""
    out = []
    start = None
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append([start, i])
            start = None
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [tuple(r) for r in merged]


def darken_to_contrast(fg, bg, minimum: float):
    """Scale fg toward black in 1% steps until contrast against bg reaches `minimum`."""
    for t in range(0, 101):
        c = tuple(float(v) * (1 - t / 100.0) for v in fg)
        if contrast_ratio(c, bg) >= minimum:
            return tuple(int(round(v)) for v in c)
    raise AssertionError("cannot reach contrast %.2f" % minimum)


def fit_axis_aligned_ellipse(xs, ys):
    """Least squares A x^2 + B x + C y^2 + D y = 1 -> (cx, cy, a, b)."""
    m = np.stack([xs**2, xs, ys**2, ys], axis=1)
    (A, B, C, D), *_ = np.linalg.lstsq(m, np.ones(len(xs)), rcond=None)
    cx, cy = -B / (2 * A), -D / (2 * C)
    rhs = 1 + A * cx * cx + C * cy * cy
    return float(cx), float(cy), float(math.sqrt(rhs / A)), float(math.sqrt(rhs / C))


def ellipse_residual(xs, ys, e):
    cx, cy, a, b = e
    rho = np.sqrt(((xs - cx) / a) ** 2 + ((ys - cy) / b) ** 2)
    return np.abs(rho - 1.0) * (a + b) / 2.0


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------------------------------------------------------- measurement
class Dialog:
    def __init__(self, name, arr):
        self.name = name
        self.arr = arr  # (H, W, 3) uint8
        self.bg = mode_colour(arr.reshape(-1, 3))
        m = colour_mask(arr, self.bg, 1)
        box, area, _ = largest_component(m, 1000)
        self.modal = box
        self.W = box_w(box)
        self.H = box_h(box)
        self.origin = (box[0], box[1])
        inner = (box[0] + CORNER_INSET, box[1] + CORNER_INSET, box[2] - CORNER_INSET, box[3] - CORNER_INSET)
        self.inner = inner
        self.px = {}
        self.cursor = None

    def frac(self, box):
        return box_to_fractions(box, self.origin, self.W)

    def pfrac(self, pt):
        return point_to_fractions(pt, self.origin, self.W)

    def sub(self, box):
        return self.arr[box[1] : box[3], box[0] : box[2]]

    def nonbg(self, box, thr=INK_THRESHOLD):
        m = l1_distance(self.sub(box), self.bg) > thr
        if self.cursor is not None:
            m &= ~self.cursor[box[1] : box[3], box[0] : box[2]]
        return m

    def find_cursor(self, photo):
        """Mask of the mouse-pointer arrow (dark outline, white fill) outside the photo; exactly one."""
        self.cursor = None
        i = self.modal
        lum = self.arr.astype(np.float64).mean(axis=-1)
        dark = np.zeros(lum.shape, bool)
        dark[i[1] : i[3], i[0] : i[2]] = lum[i[1] : i[3], i[0] : i[2]] < 35
        dark[photo[1] - 3 : photo[3] + 3, photo[0] - 3 : photo[2] + 3] = False
        comps, lab = components(dark, 20)
        found = []
        for box, area, idx in comps:
            core = lab == idx
            grown = ndi.binary_dilation(core, iterations=3)
            ring = grown & ~core
            # the pointer is a black arrow with a white outline (button text is dark on a 224 grey fill)
            if area >= 15 and (lum[ring] > 240).mean() >= 0.1:
                found.append((box, grown))
        check(len(found) == 1, "expected one mouse-pointer arrow (black fill, white outline) in %s, found %d of %s" % (self.name, len(found), [(c[0], c[1], round(float((lum[ndi.binary_dilation(lab == c[2], iterations=3) & ~(lab == c[2])] > 240).mean()), 2)) for c in comps]))
        mask = found[0][1]
        self.cursor = mask
        self.px["cursor_box"] = bbox_of_mask(mask)

    def ink_box(self, box, thr=INK_THRESHOLD, mask_extra=None):
        m = self.nonbg(box, thr)
        if mask_extra is not None:
            m &= mask_extra
        return bbox_of_mask(m, (box[0], box[1]))

    def text_colour(self, box, bg, frac=0.9):
        sub = self.sub(box).astype(np.int32)
        d = l1_distance(sub, bg)
        check(d.max() > 0, "no text pixels in %s" % (box,))
        sel = d >= frac * d.max()
        return median_colour(sub[sel])

    def locate_photo(self):
        i = self.inner
        m = self.nonbg(i, 10)
        m = ndi.binary_fill_holes(m)
        box, area, _ = largest_component(m, 1000)
        box = (box[0] + i[0], box[1] + i[1], box[2] + i[0], box[3] + i[1])
        check(area > 0.1 * self.W * self.H, "photo too small")
        self.find_cursor(box)
        return box

    def header(self, photo):
        """title box, title baseline row, logo box, colours."""
        band = (self.inner[0], self.inner[1], self.inner[2], photo[1] - 2)
        m = self.nonbg(band)
        cols = np.nonzero(m.any(axis=0))[0]
        split = band[0] + int(0.75 * self.W)  # logo sits in the right quarter
        left = m.copy()
        left[:, split - band[0] :] = False
        right = m.copy()
        right[:, : split - band[0]] = False
        title = bbox_of_mask(left, (band[0], band[1]))
        logo = bbox_of_mask(right, (band[0], band[1]))
        check(box_w(title) > 0.15 * self.W, "title too narrow")
        check(box_w(logo) < 0.15 * self.W and box_h(logo) > 10, "logo shape")
        counts = left.sum(axis=1)
        peak = counts.max()
        rows = np.nonzero(counts >= 0.4 * peak)[0]
        baseline = int(rows.max()) + 1 + band[1]  # bottom edge of the last dense row
        return title, baseline, logo

    def fill_button(self, region, cls, side):
        """Find a filled button inside region by colour class; returns (box, fill rgb)."""
        sub = self.sub(region).astype(np.int32)
        r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
        if cls == "neutral":
            sel = (sub.max(-1) - sub.min(-1) <= 3) & (sub.mean(-1) >= 150)
        elif cls == "blue":
            sel = (b - r > 80) & (b - g > 60) & (b > 120)
        elif cls == "red":
            sel = (r - g > 150) & (r > 200)
        else:
            raise AssertionError(cls)
        half = sub.shape[1] // 2
        if side == "left":
            sel[:, half:] = False
        elif side == "right":
            sel[:, :half] = False
        check(sel.sum() > 200, "%s button pixels missing" % cls)
        fill = mode_colour(sub[sel].astype(np.uint8))
        m = colour_mask(sub, fill, 2)
        if side == "left":
            m[:, half:] = False
        elif side == "right":
            m[:, :half] = False
        box, area, mask = largest_component(m, 300)
        box = (box[0] + region[0], box[1] + region[1], box[2] + region[0], box[3] + region[1])
        check(box_w(box) > 40 and box_h(box) > 20, "%s button size %s" % (cls, box))
        return box, fill

    def button_text(self, box, fill):
        inset = (box[0] + 3, box[1] + 3, box[2] - 3, box[3] - 3)
        d = l1_distance(self.sub(inset), fill)
        check(d.max() > 100, "button text contrast")
        tb = bbox_of_mask(d > 0.3 * d.max(), (inset[0], inset[1]))
        colour = self.text_colour(inset, fill)
        return tb, colour


def measure_footer(d, region, left_cls, right_cls, out_geo, out_col, left_name, right_name, left_text_name, right_text_name):
    lb, lfill = d.fill_button(region, left_cls, "left")
    rb, rfill = d.fill_button(region, right_cls, "right")
    check(abs(lb[1] - rb[1]) <= 2 and abs(box_h(lb) - box_h(rb)) <= 2, "footer buttons not aligned")
    for name, box, fill in ((left_name, lb, lfill), (right_name, rb, rfill)):
        tb, tc = d.button_text(box, fill)
        out_geo[name] = d.frac(box)
        out_geo[name + "_text"] = d.frac(tb)
        out_col[name] = {"fill": fill, "text": tc}
    return lb, rb


def measure_confirmation(d):
    geo, col = {}, {}
    photo = d.locate_photo()
    check(abs(box_w(photo) - box_h(photo)) <= 2, "preview must be square")
    title, base, logo = d.header(photo)
    geo["preview"] = d.frac(photo)
    footer_top = d.modal[3] - int(0.20 * d.H)
    lb, rb = measure_footer(d, (d.inner[0], footer_top, d.inner[2], d.inner[3]), "neutral", "blue", geo, col, "cancel", "ok", "", "")
    band = (d.inner[0], photo[3] + 2, d.inner[2], lb[1] - 2)
    # cursor lives below the text row (outside this band's text rows); pick the single text run
    m = d.nonbg(band)
    rr = runs(m.any(axis=1), 2)
    check(len(rr) >= 1, "adjust-crop row")
    r0, r1 = rr[0]
    rowband = (band[0], band[1] + r0, band[2], band[1] + r1)
    adj = d.ink_box(rowband)
    check(abs(box_centre(adj)[0] - box_centre(photo)[0]) <= 3, "ADJUST CROP must be centred under the preview")
    geo["adjust_crop_text"] = d.frac(adj)
    col["adjust_crop_text"] = {"text": d.text_colour(rowband, d.bg)}
    return photo, title, base, logo, geo, col


def find_handles(d, photo):
    sub = d.sub(photo)
    m = colour_mask(sub, (255, 255, 255), 0)
    comps, _ = components(m, 20)
    hs = []
    for box, area, _i in comps:
        w, h = box_w(box), box_h(box)
        if 6 <= w <= 20 and abs(w - h) <= 1 and area >= 0.9 * w * h:
            hs.append((box[0] + photo[0], box[1] + photo[1], box[2] + photo[0], box[3] + photo[1]))
    check(len(hs) == 8, "expected exactly 8 handles, found %d" % len(hs))
    return hs


def measure_editor(d):
    geo, col = {}, {}
    photo = d.locate_photo()
    title, base, logo = d.header(photo)
    geo["photo_frame"] = d.frac(photo)
    sub = d.sub(photo)
    black = sub.max(-1) <= 2
    band_rows = np.nonzero(black.mean(axis=1) >= 0.97)[0]
    check(band_rows.size >= 5 and band_rows.min() == 0, "black band at top")
    band_h = int(np.nonzero(np.diff(band_rows) > 1)[0][0] + 1) if np.any(np.diff(band_rows) > 1) else int(band_rows.size)
    band = (photo[0], photo[1], photo[2], photo[1] + band_h)
    content = (photo[0], photo[1] + band_h, photo[2], photo[3])
    geo["black_band"] = d.frac(band)
    geo["photo_content"] = d.frac(content)

    hs = find_handles(d, photo)
    cs = [box_centre(h) for h in hs]
    xs = sorted(set(round(c[0]) for c in cs))
    ys = sorted(set(round(c[1]) for c in cs))
    def cluster(vals):
        out = []
        for v in sorted(vals):
            if out and abs(v - out[-1][-1]) <= 2:
                out[-1].append(v)
            else:
                out.append([v])
        return [float(np.mean(o)) for o in out]
    cx = cluster([c[0] for c in cs])
    cy = cluster([c[1] for c in cs])
    check(len(cx) == 3 and len(cy) == 3, "handles must lie on a 3x3 grid")
    names = {}
    for h, c in zip(hs, cs):
        i = int(np.argmin([abs(c[0] - v) for v in cx]))
        j = int(np.argmin([abs(c[1] - v) for v in cy]))
        check(not (i == 1 and j == 1), "centre handle")
        names[("t", "m", "b")[j] + ("l", "m", "r")[i]] = (h, c)
    check(len(names) == 8, "duplicate handle slots")
    label = {"tl": "top_left", "tm": "top", "tr": "top_right", "ml": "left", "mr": "right", "bl": "bottom_left", "bm": "bottom", "br": "bottom_right"}
    sizes = sorted(set((box_w(h), box_h(h)) for h, _ in names.values()))
    check(max(max(s) for s in sizes) - min(min(s) for s in sizes) <= 1, "handle sizes differ %s" % sizes)
    hw = float(np.median([box_w(h) for h, _ in names.values()]))
    geo["handles"] = {
        "size": round(hw / d.W, ROUND),
        "size_px": hw,
        "centres": {label[k]: d.pfrac(v[1]) for k, v in sorted(names.items())},
    }
    stencil = (cx[0], cy[0], cx[2], cy[2])
    sw, sh = stencil[2] - stencil[0], stencil[3] - stencil[1]
    check(abs(sw - sh) <= 2.5, "stencil must be square: %.1f x %.1f" % (sw, sh))
    check(abs(cx[1] - (cx[0] + cx[2]) / 2) <= 1.5 and abs(cy[1] - (cy[0] + cy[2]) / 2) <= 1.5, "edge handles must sit at midpoints")
    geo["stencil"] = {"x": round((stencil[0] - d.origin[0]) / d.W, ROUND), "y": round((stencil[1] - d.origin[1]) / d.W, ROUND), "w": round(sw / d.W, ROUND), "h": round(sh / d.W, ROUND)}

    # outline width/alpha from the four edges between handles
    lum = d.arr.astype(np.float64).mean(axis=-1)
    widths, alphas = [], []
    pad = int(hw) + 3
    for edge in range(4):
        prof = []
        base_v = []
        peak_v = []
        if edge < 2:  # top / bottom: vary x between handles, scan y
            line = cy[0] if edge == 0 else cy[2]
            lo, hi = int(cx[0]) + pad, int(cx[1]) - pad
            for x in range(lo, hi):
                col_ = lum[int(round(line)) - 5 : int(round(line)) + 6, x]
                prof.append(col_)
        else:
            line = cx[0] if edge == 2 else cx[2]
            lo, hi = int(cy[0]) + pad, int(cy[1]) - pad
            for y in range(lo, hi):
                prof.append(lum[y, int(round(line)) - 5 : int(round(line)) + 6])
        prof = np.array(prof)  # (n, 11), centre index 5
        bl = (prof[:, 0:3].mean(axis=1) + prof[:, 8:11].mean(axis=1)) / 2.0
        ex = np.clip(prof - bl[:, None], 0, None)
        med = np.median(ex, axis=0)
        widths.append(float(med.sum() / med.max()))
        pk = ex[:, 3:8].max(axis=1)
        alphas.append(float(np.median(pk / np.maximum(255.0 - bl, 1.0))))
    geo["stencil_outline"] = {"width_px": round(float(np.median(widths)), 1)}
    col["stencil_outline"] = {"assumed_colour": "#FFFFFF", "alpha_if_white": round(float(np.median(alphas)), 2)}
    outline_w = float(np.median(widths))
    check(0.5 <= outline_w <= 3.0, "outline width %.2f" % outline_w)

    # oval guide
    handle_zone = np.zeros(lum.shape, bool)
    for h, _ in names.values():
        handle_zone[h[1] - 4 : h[3] + 4, h[0] - 4 : h[2] + 4] = True
    llum = np.log(np.clip(lum, 1.0, None))
    llum[handle_zone] = np.nan
    ccx, ccy = box_centre(stencil)
    n_rays = 360
    theta = np.linspace(0, 2 * math.pi, 180, endpoint=False)
    offs = np.arange(6.0, 16.0, 1.0)

    def edge_score(cx_, cy_, a_, b_, offs=offs):
        """Mean clipped inward-brighter log-luminance step around an axis-aligned ellipse."""
        px, py = cx_ + a_ * np.cos(theta), cy_ + b_ * np.sin(theta)
        nx, ny = np.cos(theta) / a_, np.sin(theta) / b_
        nn = np.hypot(nx, ny)
        nx, ny = nx / nn, ny / nn
        ins = ndi.map_coordinates(llum, [(py[:, None] - ny[:, None] * offs), (px[:, None] - nx[:, None] * offs)], order=1, mode="nearest")
        out = ndi.map_coordinates(llum, [(py[:, None] + ny[:, None] * offs), (px[:, None] + nx[:, None] * offs)], order=1, mode="nearest")
        step = np.nanmean(ins, axis=1) - np.nanmean(out, axis=1)
        return float(np.nanmean(np.clip(step, -0.3, 0.6)))

    best = (ccx, ccy, 0.35 * sw, 0.47 * sh)
    best_s = -1e9
    for a_ in np.arange(0.2 * sw, 0.5 * sw, 3.0):
        for b_ in np.arange(0.3 * sh, 0.5 * sh, 3.0):
            s_ = edge_score(ccx, ccy, a_, b_)
            if s_ > best_s:
                best_s, best = s_, (ccx, ccy, a_, b_)
    for step_px, span in ((2.0, 8.0), (1.0, 3.0), (0.5, 1.5), (0.25, 0.5)):
        for _ in range(2):
            cx0, cy0, a0, b0 = best
            for dcx in np.arange(-span, span + 1e-9, step_px):
                for dcy in np.arange(-span, span + 1e-9, step_px):
                    for da in np.arange(-span, span + 1e-9, step_px):
                        for db in np.arange(-span, span + 1e-9, step_px):
                            s_ = edge_score(cx0 + dcx, cy0 + dcy, a0 + da, b0 + db)
                            if s_ > best_s + 1e-12:
                                best_s, best = s_, (cx0 + dcx, cy0 + dcy, a0 + da, b0 + db)
    fine = np.arange(1.5, 5.5, 0.5)
    best_s = edge_score(*best, offs=fine)
    for step_px, span in ((1.0, 3.0), (0.5, 1.5), (0.25, 0.5)):
        for _ in range(2):
            cx0, cy0, a0, b0 = best
            for dcx in np.arange(-span, span + 1e-9, step_px):
                for dcy in np.arange(-span, span + 1e-9, step_px):
                    for da in np.arange(-span, span + 1e-9, step_px):
                        for db in np.arange(-span, span + 1e-9, step_px):
                            s_ = edge_score(cx0 + dcx, cy0 + dcy, a0 + da, b0 + db, offs=fine)
                            if s_ > best_s + 1e-12:
                                best_s, best = s_, (cx0 + dcx, cy0 + dcy, a0 + da, b0 + db)
    e = best
    check(best_s > 0.12, "oval edge evidence too weak: %.3f" % best_s)
    ocx, ocy, oa, ob = e
    check(0.4 < oa / ob < 0.95, "oval aspect %.2f" % (oa / ob))
    ovbox = (ocx - oa, ocy - ob, ocx + oa, ocy + ob)
    check(ovbox[0] > stencil[0] and ovbox[2] < stencil[2] and ovbox[1] > stencil[1] and ovbox[3] < stencil[3], "oval inside stencil")
    geo["oval_guide"] = {
        "x": round((ovbox[0] - d.origin[0]) / d.W, ROUND), "y": round((ovbox[1] - d.origin[1]) / d.W, ROUND),
        "w": round(2 * oa / d.W, ROUND), "h": round(2 * ob / d.W, ROUND),
        "in_stencil": {
            "x": round((ovbox[0] - stencil[0]) / sw, ROUND), "y": round((ovbox[1] - stencil[1]) / sh, ROUND),
            "w": round(2 * oa / sw, ROUND), "h": round(2 * ob / sh, ROUND),
        },
        "centre_offset_from_stencil_centre": {"x": round((ocx - ccx) / sw, ROUND), "y": round((ocy - ccy) / sh, ROUND)},
    }
    # alpha: pixels 3 px inside vs 3 px outside along the radial where the photo is similar either side
    rgb = d.arr.astype(np.float64)
    white_a, black_a = [], []
    for k in range(n_rays):
        th = 2 * math.pi * k / n_rays
        dx, dy = math.cos(th), math.sin(th)
        # radius of ellipse in this direction
        r = 1.0 / math.sqrt((dx / oa) ** 2 + (dy / ob) ** 2)
        def samp(rr):
            x, y = ocx + dx * rr, ocy + dy * rr
            return np.array([ndi.map_coordinates(rgb[..., c], [[y], [x]], order=1)[0] for c in range(3)]), (x, y)
        i1, p1 = samp(r - 2)
        i2, _ = samp(r - 6)
        o1, p2 = samp(r + 2)
        o2, _ = samp(r + 6)
        if handle_zone[int(round(p1[1])), int(round(p1[0]))] or handle_zone[int(round(p2[1])), int(round(p2[0]))]:
            continue
        li, lo = i1.mean(), o1.mean()
        # photo similar on each side of the edge (flat), and an outside darker than inside
        if abs(i1.mean() - i2.mean()) > 0.12 * li or abs(o1.mean() - o2.mean()) > 0.12 * max(lo, 20) or lo < 20 or li <= lo * 1.1:
            continue
        white_a.append(float(np.mean((i1 - o1) / (255.0 - o1))))
        black_a.append(float(np.mean(1 - o1 / i1)))
    check(len(white_a) >= 8, "too few flat edge samples for alpha: %d" % len(white_a))
    def stat(v):
        v = np.array(v)
        return {"median": round(float(np.median(v)), 2), "p25": round(float(np.percentile(v, 25)), 2), "p75": round(float(np.percentile(v, 75)), 2)}
    col["oval_guide"] = {
        "samples": len(white_a),
        "alpha_if_white_overlay_inside": stat(white_a),
        "alpha_if_black_dim_outside": stat(black_a),
        "note": "inside/outside differ by one translucent layer; white-inside and black-outside fit equally and cannot be told apart from the screenshot alone",
    }

    # eye markers: round uniform dark blobs in the oval's upper half
    x0, y0, x1, y1 = [int(v) for v in stencil]
    patch = lum[y0:y1, x0:x1]
    local = ndi.median_filter(patch, size=41, mode="nearest")
    ratio = patch / np.maximum(local, 1.0)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    inside = ((xx - ocx) / oa) ** 2 + ((yy - ocy) / ob) ** 2 <= 0.9
    cand = (ratio < 0.75) & inside & (yy < ocy)
    disk = (np.hypot(*np.mgrid[-6:7, -6:7]) <= 6.0)
    cand = ndi.binary_opening(cand, structure=disk)
    comps, _ = components(cand, 60)
    eyes = []
    for box, area, _i in comps:
        w, h = box_w(box), box_h(box)
        if 10 <= w <= 40 and abs(w - h) <= 2 and 0.68 <= area / (w * h) <= 0.86:
            eyes.append((box[0] + x0, box[1] + y0, box[2] + x0, box[3] + y0, area))
    check(len(eyes) == 2, "expected exactly 2 eye markers, found %d: %s" % (len(eyes), eyes))
    eyes.sort()
    ec = [box_centre(e_[:4]) for e_ in eyes]
    check(abs(ec[0][1] - ec[1][1]) <= 2, "eye markers must share a horizontal line")
    diam = float(np.mean([math.sqrt(4 * e_[4] / math.pi) for e_ in eyes]))
    check(abs(diam - np.mean([box_w(e_[:4]) for e_ in eyes])) <= 2.5, "eye diameter vs bbox")
    check(ec[0][1] < ocy, "eye line in the upper half of the oval")
    geo["eye_markers"] = {
        "diameter": round(diam / d.W, ROUND),
        "diameter_px": round(diam, 1),
        "centres": [d.pfrac(c) for c in ec],
        "spacing": round((ec[1][0] - ec[0][0]) / d.W, ROUND),
        "line_y_in_oval": round((ec[0][1] - ovbox[1]) / (2 * ob), ROUND),
        "mid_x_offset_from_oval_centre": round(((ec[0][0] + ec[1][0]) / 2 - ocx) / d.W, ROUND),
    }
    # colour: median of the disc interior versus a ring just outside
    ring_ratio, disc_px = [], []
    for e_ in eyes:
        c = box_centre(e_[:4])
        r = diam / 2
        yy2, xx2 = np.mgrid[0:d.arr.shape[0], 0:d.arr.shape[1]]
        dist = np.hypot(xx2 + 0.5 - c[0], yy2 + 0.5 - c[1])
        disc = dist <= r - 2
        ring = (dist >= r + 3) & (dist <= r + 7)
        disc_px.append(d.arr[disc])
        ring_ratio.append(float(np.median(lum[disc]) / np.median(lum[ring])))
    col["eye_markers"] = {
        "observed_rgb_median": median_colour(np.concatenate(disc_px)),
        "alpha_if_black": round(1 - float(np.median(ring_ratio)), 2),
    }

    # below the photo: rotate icon + readout, slider, copy block
    footer_top = d.modal[3] - int(0.20 * d.H)
    lb, rb = measure_footer(d, (d.inner[0], footer_top, d.inner[2], d.inner[3]), "neutral", "blue", geo, col, "cancel", "use_crop", "", "")
    band = (d.inner[0], photo[3] + 2, d.inner[2], lb[1] - 2)
    m = d.nonbg(band, 10)
    rr = runs(m.any(axis=1), 2)
    check(len(rr) == 6, "expected rotate row, slider and 4 copy lines; got %d runs %s" % (len(rr), rr))
    rot = (band[0], band[1] + rr[0][0], band[2], band[1] + rr[0][1])
    cols_ = d.nonbg(rot).any(axis=0)
    groups = runs(cols_, 6)
    check(len(groups) == 2, "rotate row: expected icon + readout, got %s" % groups)
    icon = d.ink_box((rot[0] + groups[0][0], rot[1], rot[0] + groups[0][1], rot[3]))
    readout = d.ink_box((rot[0] + groups[1][0], rot[1], rot[0] + groups[1][1], rot[3]))
    check(abs(box_w(icon) - box_h(icon)) <= 3, "rotate icon square")
    geo["rotate_icon"] = d.frac(icon)
    geo["rotate_readout"] = d.frac(readout)
    pair = (icon[0], readout[2])
    pair_off = ((pair[0] + pair[1]) / 2 - box_centre(photo)[0]) / d.W
    check(abs(pair_off) <= 0.02, "icon+readout roughly centred under the photo")
    geo["rotate_pair_centre_offset_from_photo_centre"] = round(pair_off, ROUND)
    col["rotate_readout"] = {"text": d.text_colour((readout[0], readout[1], readout[2], readout[3]), d.bg)}
    col["rotate_icon"] = {"stroke": d.text_colour(icon, d.bg)}
    # slider
    sl = (band[0], band[1] + rr[1][0], band[2], band[1] + rr[1][1])
    ssub = d.sub(sl).astype(np.int32)
    nb = l1_distance(ssub, d.bg) > 10
    track_rows = np.nonzero(nb.sum(axis=1) >= 0.6 * box_w(photo))[0]
    check(1 <= track_rows.size <= 5 and np.all(np.diff(track_rows) == 1), "slider track rows %s" % track_rows)
    tr = sl[1] + int(track_rows.min()), sl[1] + int(track_rows.max()) + 1
    tcols = np.nonzero(nb[track_rows].any(axis=0))[0]
    track = (sl[0] + int(tcols.min()), tr[0], sl[0] + int(tcols.max()) + 1, tr[1])
    geo["slider_track"] = {"y": round((box_centre(track)[1] - d.origin[1]) / d.W, ROUND), "x0": round((track[0] - d.origin[0]) / d.W, ROUND), "x1": round((track[2] - d.origin[0]) / d.W, ROUND), "thickness": round(box_h(track) / d.W, ROUND), "thickness_px": box_h(track), "span_of_modal_width": round(box_w(track) / d.W, ROUND)}
    check(box_w(track) >= 0.8 * d.W - 2 * 20, "slider spans most of the modal width")
    blue = ((ssub[..., 2] - ssub[..., 0] > 80) & (ssub[..., 2] - ssub[..., 1] > 60) & (ssub[..., 2] > 120))
    opened = ndi.binary_opening(blue, structure=np.ones((7, 7)))
    tcomps, _ = components(opened, 20)
    check(len(tcomps) == 1, "expected exactly one thumb, found %d" % len(tcomps))
    tb = tcomps[0][0]
    thumb = (tb[0] + sl[0], tb[1] + sl[1], tb[2] + sl[0], tb[3] + sl[1])
    check(abs(box_w(thumb) - box_h(thumb)) <= 2 and box_h(thumb) > box_h(track), "thumb round and thicker than track")
    tcx, tcy = box_centre(thumb)
    geo["slider_thumb"] = {"centre": d.pfrac((tcx, tcy)), "diameter": round(box_w(thumb) / d.W, ROUND), "diameter_px": box_w(thumb), "centre_along_track": round((tcx - track[0]) / box_w(track), ROUND)}
    check(abs((tcx - track[0]) / box_w(track) - 0.5) <= 0.02, "thumb at the centre of the track")
    check(abs(tcy - box_centre(track)[1]) <= 1.0, "thumb on the track line")
    active = mode_colour(ssub[blue])
    inactive_px = d.arr[track[1] : track[3], int(thumb[2]) + 2 : track[2]]
    col["slider"] = {"track_active": active, "track_inactive": mode_colour(inactive_px.reshape(-1, 3)), "thumb": mode_colour(d.sub(thumb)[ndi.binary_erosion(opened[tb[1]:tb[3], tb[0]:tb[2]], iterations=2)])}
    col["handle"] = {"fill": median_colour(np.concatenate([d.sub(h[0]).reshape(-1, 3)[colour_mask(d.sub(h[0]), (255, 255, 255), 0).reshape(-1)] for h in names.values()]))}
    # copy block
    lines = [(band[0], band[1] + a, band[2], band[1] + b) for a, b in rr[2:]]
    boxes = [d.ink_box(l_, 10) for l_ in lines]
    block = (min(b[0] for b in boxes), boxes[0][1], max(b[2] for b in boxes), boxes[-1][3])
    geo["copy_block"] = {"box": d.frac(block), "lines": [d.frac(b) for b in boxes]}
    bold_colour = d.text_colour(lines[0], d.bg)
    reg_colour = d.text_colour(lines[3], d.bg)
    col["copy_text"] = {"bold": bold_colour, "regular": reg_colour}
    return photo, title, base, logo, geo, col


def measure_failure(d):
    geo, col = {}, {}
    photo = d.locate_photo()
    title, base, logo = d.header(photo)
    geo["preview"] = d.frac(photo)
    check(abs(box_w(photo) - box_h(photo)) > 20, "failure preview must not be square")
    footer_top = d.modal[3] - int(0.20 * d.H)
    lb, rb = measure_footer(d, (d.inner[0], footer_top, d.inner[2], d.inner[3]), "neutral", "blue", geo, col, "cancel", "ok", "", "")
    region = (d.inner[0], photo[3] + 2, d.inner[2], lb[1] - 2)
    crop, cfill = d.fill_button((region[0], region[1], region[2], region[1] + int(0.12 * d.H)), "red", "both")
    check(abs(box_centre(crop)[0] - box_centre(photo)[0]) <= 3, "CROP centred under the preview")
    tb, tc = d.button_text(crop, cfill)
    geo["crop_button"] = d.frac(crop)
    geo["crop_button_text"] = d.frac(tb)
    col["crop_button"] = {"fill": cfill, "text": tc}
    below = (region[0], crop[3] + 2, region[2], region[3])
    sub = d.sub(below).astype(np.int32)
    ink = l1_distance(sub, d.bg) > 10
    rr = [r for r in runs(ink.any(axis=1), 2) if r[1] - r[0] >= 4]  # drop the button's shadow row
    check(len(rr) == 4, "expected 1 red line + 3 guidance lines, got %d runs %s" % (len(rr), rr))
    red_row = (below[0], below[1] + rr[0][0], below[2], below[1] + rr[0][1])
    redsub = d.sub(red_row).astype(np.int32)
    isred = (redsub[..., 0] - redsub[..., 1] > 80)
    check(isred.sum() > 100, "failure line must be red")
    red_box = bbox_of_mask(isred, (red_row[0], red_row[1]))
    geo["failure_line"] = d.frac(red_box)
    redpx = redsub[isred]
    redness = redpx[:, 0] - redpx[:, 1]
    col["failure_line"] = {"text": median_colour(redpx[redness >= 0.9 * redness.max()])}
    lines = [(below[0], below[1] + a, below[2], below[1] + b) for a, b in rr[1:]]
    boxes = [d.ink_box(l_, 10) for l_ in lines]
    block = (min(b[0] for b in boxes), boxes[0][1], max(b[2] for b in boxes), boxes[-1][3])
    geo["guidance"] = {"box": d.frac(block), "lines": [d.frac(b) for b in boxes]}
    col["guidance_text"] = {"text": d.text_colour(lines[0], d.bg)}
    return photo, title, base, logo, geo, col


def finish(d, photo, title, base, logo, geo, col):
    geo["modal"] = {"width_px": d.W, "height_px": d.H, "aspect_h_over_w": round(d.H / d.W, ROUND)}
    geo["title"] = d.frac(title)
    geo["title_baseline_y"] = round((base - d.origin[1]) / d.W, ROUND)
    geo["logo"] = d.frac(logo)
    geo["padding"] = {
        "left": round((title[0] - d.origin[0]) / d.W, ROUND),
        "top": round((title[1] - d.origin[1]) / d.W, ROUND),
        "right": round((d.modal[2] - logo[2]) / d.W, ROUND),
        "preview_left": round((photo[0] - d.origin[0]) / d.W, ROUND),
        "preview_right": round((d.modal[2] - photo[2]) / d.W, ROUND),
    }
    lb = geo.get("cancel")
    geo["padding"]["bottom"] = round(d.H / d.W - (lb["y"] + lb["h"]), ROUND)
    geo["padding"]["footer_left"] = lb["x"]
    # colours
    col["modal_background"] = d.bg
    col["title_text"] = {"text": d.text_colour(title, d.bg)}
    # page dim: the strip outside the modal (translucent scrim over page content)
    ring = np.zeros(d.arr.shape[:2], bool)
    ring[:, : d.modal[0] - 1] = True
    ring[:, d.modal[2] + 1 :] = True
    ring[: d.modal[1] - 1, :] = True
    ring[d.modal[3] + 1 :, :] = True
    px = d.arr[ring]
    if px.shape[0] > 50:
        col["page_dim"] = {"mode": mode_colour(px), "median": median_colour(px), "samples": int(px.shape[0])}
    geo["logo_stroke_colour_sampled_in_colours"] = True
    col["logo_stroke"] = d.text_colour(logo, d.bg)
    del geo["logo_stroke_colour_sampled_in_colours"]


def verify_bundle(bundle: Path):
    sums = {}
    for line in (bundle / "SHA256SUMS").read_text().splitlines():
        if line.strip():
            h, _, p = line.partition("  ")
            sums[p.strip()] = h.strip()
    out = {}
    for name, rel in IMAGES.items():
        check(rel in sums, "%s not listed in SHA256SUMS" % rel)
        data = (bundle / rel).read_bytes()
        got = hashlib.sha256(data).hexdigest()
        check(got == sums[rel], "SHA256 mismatch for %s: %s != %s" % (rel, got, sums[rel]))
        out[name] = (rel, got)
    return out


def contrast_pairs(col):
    bg = col["modal_background"]
    pairs = {}
    def add(name, fg, back):
        pairs[name] = {"fg": to_hex(fg), "bg": to_hex(back), "ratio": round(contrast_ratio(fg, back), 2), "aa_text_4_5": contrast_ratio(fg, back) >= 4.5}
    return pairs, add, bg


def hexify(v):
    if isinstance(v, tuple) and len(v) == 3 and all(isinstance(x, (int, float)) for x in v):
        return to_hex(v)
    if isinstance(v, dict):
        return {k: hexify(x) for k, x in v.items()}
    if isinstance(v, list):
        return [hexify(x) for x in v]
    return v


def build_colours(cols, hashes):
    c = cols["confirmation"], cols["editor"], cols["failure"]
    bg = c[0]["modal_background"]
    for x in c:
        check(x["modal_background"] == bg, "modal background differs between dialogs")
    pairs, add, _ = contrast_pairs(c[0])
    add("title_on_modal", c[0]["title_text"]["text"], bg)
    add("adjust_crop_on_modal", c[0]["adjust_crop_text"]["text"], bg)
    add("cancel_text_on_cancel_fill", c[0]["cancel"]["text"], c[0]["cancel"]["fill"])
    add("ok_text_on_ok_fill", c[0]["ok"]["text"], c[0]["ok"]["fill"])
    add("use_crop_text_on_fill", c[1]["use_crop"]["text"], c[1]["use_crop"]["fill"])
    add("crop_text_on_crop_fill", c[2]["crop_button"]["text"], c[2]["crop_button"]["fill"])
    add("failure_line_on_modal", c[2]["failure_line"]["text"], bg)
    add("guidance_on_modal", c[2]["guidance_text"]["text"], bg)
    add("copy_bold_on_modal", c[1]["copy_text"]["bold"], bg)
    add("copy_regular_on_modal", c[1]["copy_text"]["regular"], bg)
    add("rotate_readout_on_modal", c[1]["rotate_readout"]["text"], bg)
    # non-text (WCAG 1.4.11, informational for the legacy theme)
    non_text = {}
    for nm, fg in (("slider_thumb_on_modal", c[1]["slider"]["thumb"]), ("slider_active_track_on_modal", c[1]["slider"]["track_active"]), ("slider_inactive_track_on_modal", c[1]["slider"]["track_inactive"]), ("handle_on_modal", c[1]["handle"]["fill"]), ("logo_on_modal", c[0]["logo_stroke"])):
        non_text[nm] = {"fg": to_hex(fg), "bg": to_hex(bg), "ratio": round(contrast_ratio(fg, bg), 2), "meets_3_1": contrast_ratio(fg, bg) >= 3.0}

    # ----- light-theme proposal (opaque variants; text pairs asserted >= 4.5)
    surface = (255, 255, 255)
    on_surface = (33, 33, 33)
    muted = (89, 89, 89)
    primary = c[1]["use_crop"]["fill"]
    check(primary == c[0]["ok"]["fill"], "OK and USE CROP fills must match")
    danger_fill = darken_to_contrast(c[2]["crop_button"]["fill"], (255, 255, 255), 4.5)
    danger_text = darken_to_contrast(c[2]["failure_line"]["text"], surface, 4.5)
    cancel_fill = c[0]["cancel"]["fill"]
    light_pairs = {}
    def ladd(name, fg, back, minimum=4.5):
        r = contrast_ratio(fg, back)
        check(r >= minimum, "light pair %s %.2f < %.1f" % (name, r, minimum))
        light_pairs[name] = {"fg": to_hex(fg), "bg": to_hex(back), "ratio": round(r, 2)}
    ladd("title_on_surface", on_surface, surface)
    ladd("body_on_surface", on_surface, surface)
    ladd("copy_on_surface", muted, surface)
    ladd("readout_on_surface", muted, surface)
    ladd("adjust_crop_on_surface", primary, surface)
    ladd("cancel_text_on_cancel_fill", on_surface, cancel_fill)
    ladd("ok_text_on_primary", surface, primary)
    ladd("use_crop_text_on_primary", surface, primary)
    ladd("crop_text_on_danger_fill", surface, danger_fill)
    ladd("failure_line_on_surface", danger_text, surface)
    light_non_text = {}
    def lnt(name, fg, back, minimum=3.0):
        r = contrast_ratio(fg, back)
        check(r >= minimum, "light non-text %s %.2f < 3" % (name, r))
        light_non_text[name] = {"fg": to_hex(fg), "bg": to_hex(back), "ratio": round(r, 2)}
    lnt("slider_thumb_on_surface", primary, surface)
    lnt("slider_active_track_on_surface", primary, surface)
    lnt("handle_edge_on_handle_fill", on_surface, surface)
    lnt("stencil_outline_pair_dark_on_white", on_surface, surface)
    light = {
        "surface": to_hex(surface), "on_surface": to_hex(on_surface), "on_surface_muted": to_hex(muted),
        "primary": to_hex(primary), "on_primary": to_hex(surface), "cancel_fill": to_hex(cancel_fill), "on_cancel": to_hex(on_surface),
        "danger_fill": to_hex(danger_fill), "on_danger_fill": to_hex(surface), "danger_text": to_hex(danger_text),
        "slider_inactive_track": to_hex(composite(primary, surface, 0.3)),
        "scrim": "rgba(0,0,0,0.5)",
        "handle_fill": "#FFFFFF", "handle_edge": to_hex(on_surface),
        "stencil_outline": {"light": "#FFFFFF", "dark_companion": to_hex(on_surface), "note": "draw both 1px rings so the stencil reads on any photo"},
        "oval_guide": {"fill": "rgba(255,255,255,0.5)", "note": "overlay over the photo, no text; opacity from the legacy estimate"},
        "eye_marker": {"fill": "rgba(0,0,0,0.5)", "note": "overlay over the photo, no text"},
    }
    states = {
        "confirmation": ["title_on_surface", "adjust_crop_on_surface", "cancel_text_on_cancel_fill", "ok_text_on_primary"],
        "editor": ["title_on_surface", "copy_on_surface", "readout_on_surface", "cancel_text_on_cancel_fill", "use_crop_text_on_primary"],
        "failure": ["title_on_surface", "failure_line_on_surface", "body_on_surface", "crop_text_on_danger_fill", "cancel_text_on_cancel_fill", "ok_text_on_primary"],
    }
    out = {
        "schema": 1,
        "note": "Colours are medians/modes of the element's own pixels (hex, 8-bit sRGB); contrast is WCAG 2.x relative luminance. Legacy pairs are reported as measured and may fail AA; the light theme is a proposal whose text pairs the script asserts at >= 4.5:1 and non-text at >= 3:1.",
        "source": {k: {"file": v[0], "sha256": v[1]} for k, v in hashes.items()},
        "legacy": hexify({
            "modal_background": bg,
            "page_dim": c[0].get("page_dim"),
            "title_text": c[0]["title_text"]["text"],
            "logo_stroke": c[0]["logo_stroke"],
            "adjust_crop_text": c[0]["adjust_crop_text"]["text"],
            "cancel": c[0]["cancel"], "ok": c[0]["ok"], "use_crop": c[1]["use_crop"], "crop_button": c[2]["crop_button"],
            "failure_line_text": c[2]["failure_line"]["text"],
            "guidance_text": c[2]["guidance_text"]["text"],
            "copy_text": c[1]["copy_text"],
            "rotate_readout_text": c[1]["rotate_readout"]["text"], "rotate_icon_stroke": c[1]["rotate_icon"]["stroke"],
            "slider": c[1]["slider"],
            "handle_fill": c[1]["handle"]["fill"],
            "stencil_outline": c[1]["stencil_outline"],
            "oval_guide": c[1]["oval_guide"],
            "eye_markers": c[1]["eye_markers"],
        }),
        "legacy_contrast_text": pairs,
        "legacy_contrast_non_text": non_text,
        "light_theme": light,
        "light_theme_contrast_text": light_pairs,
        "light_theme_contrast_non_text": light_non_text,
        "light_theme_states": {k: {n: light_pairs[n] for n in v} for k, v in states.items()},
    }
    return out


def measure_all(bundle: Path):
    hashes = verify_bundle(bundle)
    geos, cols = {}, {}
    fns = {"confirmation": measure_confirmation, "editor": measure_editor, "failure": measure_failure}
    for name, rel in IMAGES.items():
        arr = np.array(Image.open(bundle / rel).convert("RGB"))
        d = Dialog(name, arr)
        photo, title, base, logo, geo, col = fns[name](d)
        finish(d, photo, title, base, logo, geo, col)
        geo["image_px"] = {"width": int(arr.shape[1]), "height": int(arr.shape[0])}
        geo["modal_offset_in_image_px"] = {"x": d.modal[0], "y": d.modal[1]}
        geos[name] = geo
        cols[name] = col
    geometry = {
        "schema": 1,
        "units": "Every x/y/w/h is a fraction of the modal width (both axes) from the modal's top-left, rounded to 4 decimals; *_px keys are pixels in the locked screenshot. Fractions are comparable at any viewport (e.g. 390 or 1280 px wide) by multiplying by the modal width.",
        "source": {k: {"file": v[0], "sha256": v[1]} for k, v in hashes.items()},
        "dialogs": geos,
        "notes": [
            "Boxes are the exact-colour fill extent for buttons and the ink extent for text; anti-aliased edge pixels may add up to one pixel of error (about 0.002 of modal width).",
            "The title baseline is the bottom edge of the last row whose ink count is at least 40 percent of the densest row (descenders excluded).",
            "A mouse-pointer arrow is present in all three screenshots and is excluded by search-region choice.",
            "The screenshots are cropped to the modal plus a thin strip of dimmed page; the viewport size they came from is unknown.",
        ],
    }
    colours = build_colours(cols, hashes)
    return geometry, colours


def dump(obj) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def main(argv=None) -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bundle", type=Path, default=root.parent / "reference-locks" / "2026-10-11-original-plan-and-images")
    ap.add_argument("--out-dir", type=Path, default=root / "docs" / "design")
    ap.add_argument("--check", action="store_true", help="recompute and exit 1 if the committed JSON differs byte-for-byte")
    args = ap.parse_args(argv)
    geometry, colours = measure_all(args.bundle)
    targets = {"legacy-encode-dialog-geometry.json": dump(geometry), "legacy-encode-dialog-colours.json": dump(colours)}
    bad = False
    for fname, text in targets.items():
        path = args.out_dir / fname
        if args.check:
            have = path.read_text() if path.exists() else None
            if have != text:
                print("DIFFERS: %s" % path, file=sys.stderr)
                bad = True
            else:
                print("ok: %s" % path)
        else:
            args.out_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            print("wrote %s" % path)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
