// Browser side of the scroll measurement (measure.mjs serves this under /r/<run>/ and reads window.__result).
// ?alt=files | pack-<K> | atlas-<K> (&cols, &rows), &speed=<px/s>, &duration=<ms>, &margin=<px> (prefetch distance).
const params = new URLSearchParams(location.search);
const alt = params.get('alt') || 'files';
const speed = Number(params.get('speed') || 2400);
const duration = Number(params.get('duration') || 8000);
const margin = Number(params.get('margin') || 1250); // Chromium's native lazy-load distance on fast networks
const [kind, kText] = alt.split('-');
const K = Number(kText || 0);

const longTasks = [];
const longTaskSupported = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false;
if (longTaskSupported) new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });

const grid = document.getElementById('grid');
const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function main() {
  const [text, manifest] = await Promise.all([fetch('names.txt').then((r) => r.text()), fetch('manifest.json').then((r) => r.json())]);
  const names = text.split('\n').slice(0, -1);
  if (names.length !== manifest.names.count) throw Error('names/manifest count mismatch');
  const idStart = performance.now();
  // URLs follow from id = SHA-256(name.toLowerCase()); the cost of deriving all of them is part of the shape.
  const ids = kind === 'files' ? await Promise.all(names.map(async (n) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(n.toLowerCase()))))) : null;
  const idMs = performance.now() - idStart;

  const ready = new Uint8Array(names.length);
  const tiles = names.map((name, i) => {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.setAttribute('role', 'listitem');
    const label = document.createElement('span');
    label.textContent = name;
    if (kind === 'atlas') {
      const sprite = document.createElement('i');
      sprite.className = 'sprite';
      tile.append(sprite, label);
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.width = img.height = 200;
      img.decoding = 'async';
      img.addEventListener('load', () => { ready[i] = 1; }, { once: true });
      if (kind === 'files') { img.loading = 'lazy'; img.src = `previews/${ids[i]}.jpg`; }
      tile.append(img, label);
    }
    return tile;
  });
  grid.append(...tiles);

  if (kind === 'pack' || kind === 'atlas') {
    const requested = new Set();
    const load = kind === 'pack' ? loadPack : loadAtlas;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        const p = Math.floor(Number(e.target.dataset.i) / K);
        if (!requested.has(p)) { requested.add(p); load(p); }
      }
    }, { rootMargin: `${margin}px 0px` });
    tiles.forEach((t, i) => { t.dataset.i = i; observer.observe(t); });

    async function loadPack(p) {
      const bytes = new Uint8Array(await (await fetch(`previews-pack-${K}/${p}.bin`)).arrayBuffer());
      const view = new DataView(bytes.buffer);
      const count = view.getUint32(4, true);
      let at = 8 + 4 * count;
      for (let j = 0; j < count; j++) {
        const n = view.getUint32(8 + 4 * j, true);
        const img = tiles[p * K + j].querySelector('img');
        img.src = URL.createObjectURL(new Blob([bytes.subarray(at, at + n)], { type: 'image/jpeg' }));
        at += n;
      }
    }
    function loadAtlas(p) {
      const cols = Number(params.get('cols')), rows = Number(params.get('rows')); // shapes.mjs atlasGrid
      const url = `previews-atlas-${K}/${p}.jpg`;
      const image = new Image();
      image.onload = () => {
        for (let j = 0; j < K && p * K + j < tiles.length; j++) {
          const s = tiles[p * K + j].firstChild.style;
          s.backgroundImage = `url(${url})`;
          s.backgroundSize = `${cols * 100}% ${rows * 100}%`;
          s.backgroundPosition = `${cols > 1 ? ((j % cols) / (cols - 1)) * 100 : 0}% ${rows > 1 ? (Math.floor(j / cols) / (rows - 1)) * 100 : 0}%`;
          ready[p * K + j] = 1;
        }
      };
      image.src = url;
    }
  }

  // Grid geometry: tiles are square and regular, so the visible range is arithmetic, not layout reads.
  await nextFrame();
  const first = tiles[0].getBoundingClientRect();
  const tileHeight = first.height;
  const columns = Math.round(grid.getBoundingClientRect().width / first.width);
  const viewportHeight = innerHeight;
  const visible = (top) => {
    const a = Math.max(0, Math.floor(top / tileHeight) * columns);
    const b = Math.min(names.length, Math.ceil((top + viewportHeight) / tileHeight) * columns);
    let blank = 0;
    for (let i = a; i < b; i++) blank += ready[i] ? 0 : 1;
    return { count: b - a, blank };
  };

  // Phase 1: first viewport fully painted.
  const giveUp = performance.now() + 120000;
  while (visible(0).blank) { if (performance.now() > giveUp) throw Error('first viewport never completed'); await nextFrame(); }
  await nextFrame();
  const firstViewportMs = performance.now();
  await fetch('mark?phase=first');

  // Phase 2: idle frames give this display's vsync interval.
  const idle = [];
  const idleEnd = performance.now() + 1000;
  while (performance.now() < idleEnd) idle.push(await nextFrame());

  // Phase 3: scripted constant-speed scroll at the fixed viewport.
  const scroller = document.scrollingElement;
  const frames = [];
  let blankTileFrames = 0, tileFrames = 0, framesWithBlank = 0;
  const t0 = await nextFrame();
  for (;;) {
    const t = await nextFrame();
    const top = Math.min(scroller.scrollHeight - viewportHeight, (speed * (t - t0)) / 1000);
    scroller.scrollTop = top;
    frames.push(t);
    const v = visible(scroller.scrollTop);
    blankTileFrames += v.blank; tileFrames += v.count; framesWithBlank += v.blank ? 1 : 0;
    if (t - t0 >= duration) break;
  }
  const t1 = performance.now();
  await fetch('mark?phase=scroll');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const inWindow = (a, b) => longTasks.filter((e) => e.start >= a && e.start < b);
  const scrollTasks = inWindow(t0, t1), loadTasks = inWindow(0, firstViewportMs);
  window.__result = {
    alt, speed, duration, margin, columns, tileHeight, viewportHeight, idMs, firstViewportMs,
    idle, frames,
    scrolledPx: scroller.scrollTop,
    blankTileFraction: tileFrames ? blankTileFrames / tileFrames : 0,
    framesWithBlank,
    longTaskSupported,
    longTasks: longTaskSupported ? {
      load: { count: loadTasks.length, ms: loadTasks.reduce((s, e) => s + e.duration, 0) },
      scroll: { count: scrollTasks.length, ms: scrollTasks.reduce((s, e) => s + e.duration, 0) },
    } : null,
  };
}

main().catch((error) => { window.__result = { error: String(error?.stack || error) }; });
