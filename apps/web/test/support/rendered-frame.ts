import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright';

// Measure the displayed source rectangle, every clipping ancestor and the compositor hit
// at each source corner. Scroll normally to corners on short screens, never resize media.
export async function corners(page: Page, media: Locator) {
  const evidence = [];
  for (const [horizontal, vertical] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const result = await media.evaluate(
      (element, [right, bottom]) => {
        const dimensions = (el: Element) => {
          if (el instanceof HTMLVideoElement) return [el.videoWidth, el.videoHeight];
          if (el instanceof HTMLImageElement) return [el.naturalWidth, el.naturalHeight];
          if (el instanceof HTMLCanvasElement) return [el.width, el.height];
          return [0, 0];
        };
        const measure = () => {
          const b = element.getBoundingClientRect(),
            css = getComputedStyle(element);
          const [sw, sh] = dimensions(element);
          if (!sw || !sh) throw Error('Media not decoded');
          const left = b.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
          const top = b.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
          const w =
            b.width -
            parseFloat(css.borderLeftWidth) -
            parseFloat(css.borderRightWidth) -
            parseFloat(css.paddingLeft) -
            parseFloat(css.paddingRight);
          const h =
            b.height -
            parseFloat(css.borderTopWidth) -
            parseFloat(css.borderBottomWidth) -
            parseFloat(css.paddingTop) -
            parseFloat(css.paddingBottom);
          if (Math.abs(w / h - sw! / sh!) > 0.01 && css.objectFit !== 'contain')
            throw Error('Displayed frame crops or distorts the source');
          const scale = Math.min(w / sw!, h / sh!);
          return {
            left: left + (w - sw! * scale) / 2,
            top: top + (h - sh! * scale) / 2,
            width: sw! * scale,
            height: sh! * scale,
          };
        };
        let content = measure();
        const point = () => ({
          x: content.left + (right ? content.width - 3 : 3),
          y: content.top + (bottom ? content.height - 3 : 3),
        });
        const initial = point();
        window.scrollBy({ left: 0, top: initial.y - innerHeight / 2, behavior: 'instant' });
        content = measure();
        const clipped: {
          tag: string;
          className: string;
          overflowX: string;
          overflowY: string;
          scrollingRoot: boolean;
          bounds: { left: number; top: number; width: number; height: number };
        }[] = [];
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const c = getComputedStyle(ancestor),
            b = ancestor.getBoundingClientRect();
          const scrollingRoot = ancestor === document.scrollingElement;
          // The document's auto/scroll axes are the viewport, not a clipping box
          // offset by -scrollY. Each corner's real viewport hit is checked below.
          const x =
              /(hidden|clip)/.test(c.overflowX) ||
              (!scrollingRoot && /(scroll|auto)/.test(c.overflowX)),
            y =
              /(hidden|clip)/.test(c.overflowY) ||
              (!scrollingRoot && /(scroll|auto)/.test(c.overflowY));
          const left = b.left + ancestor.clientLeft,
            top = b.top + ancestor.clientTop;
          if (
            (x &&
              (content.left < left - 1 ||
                content.left + content.width > left + ancestor.clientWidth + 1)) ||
            (y &&
              (content.top < top - 1 ||
                content.top + content.height > top + ancestor.clientHeight + 1))
          )
            clipped.push({
              tag: ancestor.tagName,
              className: ancestor.className,
              overflowX: c.overflowX,
              overflowY: c.overflowY,
              scrollingRoot,
              bounds: { left, top, width: ancestor.clientWidth, height: ancestor.clientHeight },
            });
        }
        const p = point(),
          hit = document.elementFromPoint(p.x, p.y);
        return {
          content,
          point: p,
          clipped,
          visible:
            p.x >= 0 &&
            p.x < innerWidth &&
            p.y >= 0 &&
            p.y < innerHeight &&
            (hit === element || element.contains(hit)),
          hit: hit?.outerHTML.slice(0, 200),
        };
      },
      [horizontal, vertical],
    );
    assert.deepEqual(result.clipped, [], 'full source frame stays inside clipping ancestors');
    assert.ok(
      result.visible,
      `rendered corner ${horizontal},${vertical} is obscured: ${result.hit}`,
    );
    evidence.push(result);
  }
  return evidence;
}
