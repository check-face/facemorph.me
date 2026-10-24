// Session storage core (fm-udut) in a real browser: tab-scoped words, stored size and Clear, the byte-bounded
// session restore with no face count, and the faces store's oldest-first eviction. The modules run in Playwright
// Chromium exactly as written: shell/session/*.ts is served after Node's own type stripping, the candidate's
// last-result.mjs and originals.mjs as they are. Planted images and latents are inputs, not fakes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { test, type TestContext } from 'node:test';
import { planEviction } from '../../shell/session/faces-store.ts';

const web = (p: string) => new URL(`../../${p}`, import.meta.url);
const ORIGIN = 'https://session.test';
const SOURCES: Record<string, () => { body: string; type: string }> = {
  '/': () => ({ body: '<!doctype html><title>session</title>', type: 'text/html' }),
  '/session-words.ts': () => ({
    body: stripTypeScriptTypes(readFileSync(web('shell/session/session-words.ts'), 'utf8')),
    type: 'text/javascript',
  }),
  '/app-storage.ts': () => ({
    body: stripTypeScriptTypes(readFileSync(web('shell/session/app-storage.ts'), 'utf8')),
    type: 'text/javascript',
  }),
  '/last-result.mjs': () => ({
    body: readFileSync(web('src/Next/last-result.mjs'), 'utf8'),
    type: 'text/javascript',
  }),
  '/browser/originals.mjs': () => ({
    body: readFileSync(web('src/Next/browser/originals.mjs'), 'utf8'),
    type: 'text/javascript',
  }),
  '/plain.png': () => ({
    body: readFileSync(
      new URL('../../../../packages/stylegan-js/test/vectors/plain.png', import.meta.url),
    ).toString('latin1'),
    type: 'image/png',
  }),
};

type Page = {
  goto: (u: string) => Promise<unknown>;
  reload: () => Promise<unknown>;
  evaluate: <T>(f: string | ((a: never) => T), a?: unknown) => Promise<T>;
  setContent: (h: string) => Promise<void>;
  frames: () => { evaluate: <T>(f: string) => Promise<T>; url: () => string }[];
  waitForTimeout: (ms: number) => Promise<void>;
};
type Context = {
  newPage: () => Promise<Page>;
  route: (p: string, h: (r: Route) => unknown) => Promise<void>;
  close: () => Promise<void>;
};
type Route = { request: () => { url: () => string }; fulfill: (o: object) => Promise<void> };
type Browser = { newContext: () => Promise<Context>; close: () => Promise<void> };

async function launch(t: TestContext): Promise<{ browser: Browser; context: Context } | null> {
  let chromium: { launch: () => Promise<Browser> };
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    t.skip('untested here: playwright is not installed');
    return null;
  }
  const browser = await chromium.launch().catch(() => null);
  if (!browser) {
    t.skip('untested here: no Playwright Chromium on this runner');
    return null;
  }
  const context = await browser.newContext();
  await context.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const source = SOURCES[path];
    if (!source) return route.fulfill({ status: 404, body: '' });
    const { body, type } = source();
    return route.fulfill({
      status: 200,
      body: Buffer.from(body, type === 'image/png' ? 'latin1' : 'utf8'),
      contentType: type,
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return { browser, context };
}

test('session-words: same-tab reload restores, a new tab has none, a late restore after an edit is abandoned', async (t) => {
  const l = await launch(t);
  if (!l) return;
  try {
    const page = await l.context.newPage();
    await page.goto(`${ORIGIN}/`);
    assert.equal(
      await page.evaluate(
        `import('${ORIGIN}/session-words.ts').then(m => m.rememberWords('s1', 'face-1', { mode: 'text', value: 'Zoë and the moon' }))`,
      ),
      true,
    );
    await page.evaluate(
      `import('${ORIGIN}/session-words.ts').then(m => m.rememberWords('s1', 'face-2', { mode: 'photo', value: 'C:\\\\Users\\\\me\\\\holiday\\u202e.jpg' }))`,
    );
    await page.reload();
    const restored = await page.evaluate<{ reason: string; label: string }>(
      `import('${ORIGIN}/session-words.ts').then(m => m.restoreWords('s1', 'face-1', () => true))`,
    );
    assert.deepEqual(
      [restored.reason, restored.label],
      ['restored', 'Zoë and the moon'],
      'session-words.same-tab-reload-restores',
    );
    const photo = await page.evaluate<{ label: string }>(
      `import('${ORIGIN}/session-words.ts').then(m => m.restoreWords('s1', 'face-2', () => true))`,
    );
    assert.equal(photo.label, 'holiday.jpg', 'only a sanitized file name is kept');
    const edited = await page.evaluate<{ reason: string; label: string }>(
      `import('${ORIGIN}/session-words.ts').then(m => m.restoreWords('s1', 'face-1', () => false))`,
    );
    assert.deepEqual(
      [edited.reason, edited.label],
      ['edited', 'Restored face'],
      'session-words.late-restore-abandoned-after-edit',
    );
    const other = await l.context.newPage();
    await other.goto(`${ORIGIN}/`);
    const fresh = await other.evaluate<{ reason: string; label: string }>(
      `import('${ORIGIN}/session-words.ts').then(m => m.restoreWords('s1', 'face-1', () => true))`,
    );
    assert.deepEqual(
      [fresh.reason, fresh.label],
      ['none', 'Restored face'],
      'session-words.new-tab-no-words',
    );
  } finally {
    await l.browser.close();
  }
});

test('session-words.storage-throws-falls-back: a sandboxed frame whose sessionStorage throws gets the Restored face label', async (t) => {
  const l = await launch(t);
  if (!l) return;
  try {
    const page = await l.context.newPage();
    await page.goto(`${ORIGIN}/`);
    // An opaque-origin frame: reading window.sessionStorage throws SecurityError, a real browser behaviour.
    await page.evaluate(
      `new Promise(r => { const f = document.createElement('iframe'); f.sandbox = 'allow-scripts'; f.srcdoc = '<p>x</p>'; f.onload = r; document.body.append(f); })`,
    );
    const frame = page.frames().find((f) => f.url() === 'about:srcdoc')!;
    const thrown = await frame.evaluate<string>(
      `(() => { try { return typeof sessionStorage.length; } catch (e) { return e.name; } })()`,
    );
    assert.equal(thrown, 'SecurityError', 'the frame really cannot reach sessionStorage');
    const result = await frame.evaluate<{ reason: string; label: string; saved: boolean }>(
      `import('${ORIGIN}/session-words.ts').then(m => ({ ...m.restoreWords('s1', 'face-1', () => true), saved: m.rememberWords('s1', 'face-1', { mode: 'text', value: 'x' }) }))`,
    );
    assert.deepEqual(
      [result.reason, result.label, result.saved],
      ['storage-unavailable', 'Restored face', false],
    );
  } finally {
    await l.browser.close();
  }
});

/** Builds `n` real faces for rememberSession in the page: plain.png, a random latent, digests by the page itself. */
const FACES = (n: number, size?: number) => `(async () => {
  const lr = await import('${ORIGIN}/last-result.mjs');
  const { digest } = await import('${ORIGIN}/browser/originals.mjs');
  const png = await (await fetch('${ORIGIN}/plain.png')).blob();
  const faces = [];
  for (let i = 0; i < ${n}; i++) {
    const blob = ${size ? `new Blob([new Uint8Array(${size})], { type: 'image/png' })` : 'png'};
    const values = Float32Array.from({ length: 9216 }, (_, j) => Math.sin(i * 9216 + j));
    faces.push({ id: 'face-' + i, result: { blob, latent: { space: 'w-plus', shape: [18, 512], values }, imageSha256: await digest(await blob.arrayBuffer()), latentSha256: await digest(values), generationSha256: (i.toString(16).padStart(2, '0')).repeat(32).slice(0, 64), generationKind: 'seed', cacheKey: 'c'.repeat(64), provenance: { modelSha256: 'm', noiseSha256: 'n' } } });
  }
  return { lr, faces, settings: { kind: 'linear', width: 0.2, pinch: true, frames: 16, fps: 16 } };
})()`;

test('session-restore.150-faces and .indexeddb-record-has-no-strings; session-save.over-byte-bound-refused', async (t) => {
  const l = await launch(t);
  if (!l) return;
  try {
    const page = await l.context.newPage();
    await page.goto(`${ORIGIN}/`);
    const restored = await page.evaluate<{
      saved: boolean;
      faces: number;
      strings: string[];
    }>(`(async () => {
      const { lr, faces, settings } = await ${FACES(150)};
      const words = await import('${ORIGIN}/session-words.ts');
      for (const f of faces) words.rememberWords('s1', f.id, { mode: 'text', value: 'secret words ' + f.id });
      const saved = await lr.rememberSession({ ids: faces.map(f => f.id), faces, settings, project: null, video: null });
      const back = await lr.readSession();
      // The raw IndexedDB record: every string in it, Blobs and typed arrays aside.
      const db = await new Promise(r => { const q = indexedDB.open('checkface-originals-v1', 1); q.onsuccess = () => r(q.result); });
      const raw = await new Promise(r => { const q = db.transaction('originals').objectStore('originals').get('last-generated-session-v2'); q.onsuccess = () => r(q.result); });
      db.close();
      const strings = []; const walk = v => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object' && !(v instanceof Blob) && !ArrayBuffer.isView(v)) Object.values(v).forEach(walk); };
      walk(raw);
      return { saved, faces: back.faces.length, strings };
    })()`);
    assert.equal(restored.saved, true);
    assert.equal(restored.faces, 150, 'session-restore.150-faces');
    assert.ok(
      !restored.strings.some((s) => s.includes('secret words')),
      'session-words.indexeddb-record-has-no-strings',
    );
    assert.doesNotMatch(
      readFileSync(web('src/Next/last-result.mjs'), 'utf8'),
      /length>64/,
      'no face-count check in the source',
    );
    const refused = await page.evaluate<{
      saved: boolean;
      messages: string[];
      faces: number;
    }>(`(async () => {
      const { lr, faces, settings } = await ${FACES(3, 12 * 1024 * 1024)};
      const messages = [];
      const saved = await lr.rememberSession({ ids: faces.map(f => f.id), faces, settings, project: null, video: null }, () => true, m => messages.push(m));
      const back = await lr.readSession();
      return { saved, messages, faces: back.faces.length };
    })()`);
    assert.deepEqual(
      refused,
      {
        saved: false,
        messages: [
          'These faces are too large to keep for next time. They stay here until you close this tab.',
        ],
        faces: 0,
      },
      'session-save.over-byte-bound-refused',
    );
  } finally {
    await l.browser.close();
  }
});

test('storage-size.matches-estimate; storage-clear removes app records and keeps model caches and preferences', async (t) => {
  const l = await launch(t);
  if (!l) return;
  try {
    const page = await l.context.newPage();
    await page.goto(`${ORIGIN}/`);
    const r = await page.evaluate<{
      size: { faces: number; session: number; words: number; total: number };
      expected: number;
      usageDelta: number;
      afterClear: { faces: number; words: number };
      cleared: { records: number };
      slider: string | null;
      cache: boolean;
    }>(`(async () => {
      const st = await import('${ORIGIN}/app-storage.ts');
      const words = await import('${ORIGIN}/session-words.ts');
      const before = (await navigator.storage.estimate()).usage;
      const db = await new Promise(r => { const q = indexedDB.open('checkface-originals-v1', 1); q.onupgradeneeded = () => q.result.createObjectStore('originals'); q.onsuccess = () => r(q.result); });
      let expected = 0;
      await new Promise(done => { const tx = db.transaction('originals', 'readwrite'); for (let i = 0; i < 4; i++) { const b = new Blob([new Uint8Array(2 * 1024 * 1024 + i)], { type: 'image/png' }); expected += b.size; tx.objectStore('originals').put({ blob: b }, 'k' + i); } tx.oncomplete = done; });
      db.close();
      words.rememberWords('s1', 'face-1', { mode: 'text', value: 'hello' });
      localStorage.setItem('facemorph-slider-v1', JSON.stringify({ enabled: true, frame: 3 }));
      const cache = await caches.open('facemorph-model-cache-v1'); await cache.put('${ORIGIN}/model.bin', new Response(new Uint8Array(1024)));
      const size = await st.storedSize();
      const usageDelta = (await navigator.storage.estimate()).usage - before;
      const cleared = await st.clearAppStorage();
      const afterClear = await st.storedSize();
      return { size, expected, usageDelta, afterClear, cleared, slider: localStorage.getItem('facemorph-slider-v1'), cache: !!(await (await caches.open('facemorph-model-cache-v1')).match('${ORIGIN}/model.bin')) };
    })()`);
    // The blobs dominate; keys and wrapper objects add a few bytes each.
    assert.ok(
      r.size.faces >= r.expected && r.size.faces < r.expected + 1024,
      `faces ${r.size.faces} vs ${r.expected}`,
    );
    assert.ok(r.size.words > 0);
    // The browser's own usage figure moved by about what we counted (it also includes the cache entry).
    assert.ok(
      Math.abs(r.usageDelta - r.size.total) < 0.1 * r.size.total + 256 * 1024,
      `storage-size.matches-estimate: usage delta ${r.usageDelta} vs counted ${r.size.total}`,
    );
    assert.equal(r.cleared.records, 4);
    assert.deepEqual(
      [r.afterClear.faces, r.afterClear.words],
      [0, 0],
      'storage-clear.removes-app-records',
    );
    assert.ok(r.slider !== null && r.cache, 'storage-clear.keeps-model-cache-and-prefs');
  } finally {
    await l.browser.close();
  }
});

test('faces-store: at the cap nothing goes; over it the oldest by last use goes; never the current session or a file being prepared', () => {
  const faces = [
    { key: 'a', bytes: 10, lastUsed: 1 },
    { key: 'b', bytes: 10, lastUsed: 2 },
    { key: 'c', bytes: 10, lastUsed: 3 },
  ];
  assert.deepEqual(planEviction(faces, 30, new Set()).evict, [], 'faces-store.ceiling-at-cap');
  assert.deepEqual(
    planEviction(faces, 29, new Set()).evict,
    ['a'],
    'faces-store.ceiling-over-cap-evicts-oldest',
  );
  assert.deepEqual(planEviction(faces, 15, new Set()).evict, ['a', 'b']);
  const p = planEviction(faces, 15, new Set(['a', 'b']));
  assert.deepEqual(
    [p.evict, p.overByProtected],
    [['c'], true],
    'faces-store.never-evicts-current-session (nor a file being prepared)',
  );
  assert.deepEqual(
    planEviction(faces, null, new Set()).evict,
    [],
    'no ceiling measured yet: measured, no threshold',
  );
});

test('the rejected IndexedDB durability tuning does not return', () => {
  for (const f of [
    'shell/session/app-storage.ts',
    'src/Next/browser/originals.mjs',
    'src/Next/last-result.mjs',
  ])
    assert.doesNotMatch(
      readFileSync(web(f), 'utf8').replace(/\/\/.*$/gm, ''),
      /durability\s*:\s*['"]relaxed/,
      f,
    );
});
