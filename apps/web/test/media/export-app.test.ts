// The app's Save/Share wired onto the computational media core (fm-eeki). Two parts:
// - A scripted import scan: Save/Share, gesture and object-URL code live only in the app, the computational
//   modules carry none, and no app file keeps its own copy of an export-policy figure.
// - The app's prepared export files (src/Next/export-files.mjs) over real WebP, PNG and MP4 bytes from this
//   repository: repeated Save/Share of one result reuses one file and one name with no second encode, a
//   replaced result gets its own, the PNG fallback is named and typed PNG, and a superseded completion is
//   discarded. The encode callbacks are plain counters around real bytes, not test doubles of the store.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { typeMatchesBytes } from '../../src/media/export-policy.ts';
// @ts-expect-error the app module is plain JavaScript
import { createExportFiles } from '../../src/Next/export-files.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const web = join(root, 'apps/web');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'test' || name === 'tests') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const source = (dir: string) =>
  walk(join(root, dir)).filter(
    (f) => /\.(m?js|tsx?)$/.test(f) && !/\.(test|e2e|spec)\.|\.d\.ts$/.test(f),
  );
const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const rel = (f: string) => relative(root, f);

test('import scan: Save/Share, gesture and object-URL code live only in the app', () => {
  const computational = [
    ...source('apps/web/src/media'),
    ...source('apps/web/src/contracts'),
    ...source('packages/stylegan-js/src/media'),
  ];
  assert.ok(computational.length >= 8, 'the computational modules were found');
  const gestures =
    /\b(document|window|navigator|createObjectURL|revokeObjectURL|showSaveFilePicker|showOpenFilePicker|addEventListener)\b|\.(click|share|canShare)\(|\.download\s*=/;
  for (const f of computational) assert.doesNotMatch(code(f), gestures, rel(f));
  // The Save and Share gestures themselves: one place, the app's media module.
  const app = [...source('apps/web/src'), ...source('apps/web/shell'), ...source('packages')];
  const save = /\.download\s*=|navigator\.share\(|showSaveFilePicker\(/;
  const holders = app.filter((f) => save.test(code(f))).map(rel);
  assert.deepEqual(holders, ['apps/web/src/Next/media.mjs']);
  // The bridge hands every Save/Share file through the prepared export files, named by identity.
  const bridge = code(join(web, 'src/Next/product-bridge.mjs'));
  assert.match(bridge, /import \{createExportFiles\} from '\.\/export-files\.mjs';/);
  assert.match(bridge, /saveFile\(file\.blob,file\.filename\)/);
  assert.match(bridge, /shareFile\(file\.blob,file\.filename\)/);
  assert.doesNotMatch(bridge, /'facemorph\.(webp|png|mp4)'/, 'no fixed export filename is left');
});

test('import scan: no app file holds a second copy of the export policy settings', () => {
  const policy = join(web, 'src/media/export-policy.ts');
  const app = [...source('apps/web/src'), ...source('apps/web/shell')].filter((f) => f !== policy);
  const figures: [string, RegExp][] = [
    ['H.264 codec string', /avc1\.42002A/],
    ['WebP quality 0.8', /quality\s*[:=]\s*0?\.8(?![\d])/],
    ['scrub JPEG quality 0.85', /quality\s*[:=]\s*0?\.85\b|'image\/jpeg'\s*,\s*0?\.85\b/],
    ['0.25 bits per pixel bitrate', /\*\s*0?\.25\s*\/\s*1000/],
    ['VideoEncoder config literal', /isConfigSupported\(\{/],
  ];
  for (const f of app)
    for (const [what, pattern] of figures)
      assert.doesNotMatch(code(f), pattern, `${rel(f)}: ${what}`);
  // Each place that encodes takes its figures from the policy module.
  for (const f of [
    'src/Next/media.mjs',
    'src/Next/image-encoder-worker.mjs',
    'src/Next/recovery-metadata.mjs',
    'src/Next/browser/admission.mjs',
    'src/Next/export-files.mjs',
  ])
    assert.match(code(join(web, f)), /from '(\.\.\/)+media\/export-policy\.ts'/, f);
});

// ---- The app's prepared export files.
const bytes = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const WEBP = bytes('apps/web/src/public/preview/hello-1024.webp');
const PNG = bytes('packages/stylegan-js/test/vectors/plain.png');
const MP4 = bytes('apps/web/test/fixtures/morph/morph.mp4');
const SUFFIX = '[bcdfghjkmnpqrstvwxz2-9]{6}';
type Face = {
  source?: { mode: string; value: string; file: Blob | null };
  latent: { values: Float32Array };
  provenance?: { modelSha256: string };
};
const face = (mode: string, value: string, fill = 0, file: Blob | null = null): Face => ({
  source: { mode, value, file },
  latent: { values: new Float32Array(9216).fill(fill) },
  provenance: { modelSha256: 'a'.repeat(64) },
});
const encoder = (data: Uint8Array<ArrayBuffer>, type: string) => {
  const counter = {
    calls: 0,
    encode: async () => (counter.calls++, new Blob([data], { type })),
  };
  return counter;
};
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

test('prepared export: repeat Save/Share of one face reuses its file and name with no second encode', async () => {
  const files = createExportFiles();
  const emma = face('text', 'Emma'),
    webp = encoder(WEBP, 'image/webp');
  const first = await files.face('a', emma, { encode: webp.encode });
  const again = await files.face('a', emma, { encode: webp.encode });
  const share = await files.face('a', emma, { encode: webp.encode });
  assert.equal(webp.calls, 1, 'one encode for three hand-overs');
  assert.equal(files.stats().encodes, 1);
  assert.equal(again.blob, first.blob, 'the very same prepared file');
  assert.equal(share.filename, first.filename);
  assert.match(first.filename, new RegExp(`^emma-${SUFFIX}\\.webp$`));
  assert.equal(first.mime, 'image/webp');
  assert.ok(
    typeMatchesBytes(await bytesOf(first.blob), {
      mime: first.blob.type,
      filename: first.filename,
    }),
  );
  assert.deepEqual(await bytesOf(first.blob), WEBP);
});

test('prepared export: a replaced result is encoded and named afresh; same label, different identity, different name', async () => {
  const files = createExportFiles();
  const webp = encoder(WEBP, 'image/webp');
  const one = await files.face('a', face('text', 'Emma', 0), { encode: webp.encode });
  const two = await files.face('a', face('text', 'Emma', 1), { encode: webp.encode });
  assert.equal(webp.calls, 2);
  assert.notEqual(one.filename, two.filename, 'two Emma results never share a name');
  for (const f of [one, two]) assert.match(f.filename, new RegExp(`^emma-${SUFFIX}\\.webp$`));
  // Labels by source: seed, photo basename, and none after a restore.
  const seed = await files.face('b', face('seed', '42'), { encode: webp.encode });
  assert.match(seed.filename, new RegExp(`^seed-42-${SUFFIX}\\.webp$`));
  const photo = new File([PNG], 'Holiday face2.JPG', { type: 'image/jpeg' });
  const crop = await files.face('c', face('photo', '', 2, photo), { encode: webp.encode });
  assert.match(crop.filename, new RegExp(`^holiday-face2-${SUFFIX}\\.webp$`));
  const restored = await files.face(
    'd',
    { latent: { values: new Float32Array(9216).fill(3) } },
    { encode: webp.encode },
  );
  assert.match(restored.filename, new RegExp(`^face-${SUFFIX}\\.webp$`));
  const legacy = await files.face('e', face('text', 'C:\\photos\\CON'), { encode: webp.encode });
  assert.match(
    legacy.filename,
    new RegExp(`^face-${SUFFIX}\\.webp$`),
    'reserved names and paths never reach a filename',
  );
});

test('prepared export: where WebP does not encode, the PNG fallback is named and typed PNG', async () => {
  const files = createExportFiles();
  const png = encoder(PNG, 'image/png');
  const first = await files.face('a', face('seed', '7'), { encode: png.encode });
  assert.equal(png.calls, 1, 'the fallback bytes are used, not encoded twice');
  assert.match(first.filename, new RegExp(`^seed-7-${SUFFIX}\\.png$`));
  assert.equal(first.mime, 'image/png');
  assert.ok(
    typeMatchesBytes(await bytesOf(first.blob), {
      mime: first.blob.type,
      filename: first.filename,
    }),
  );
  assert.equal(files.stats().webpEncodes, false);
  const again = await files.face('a', face('seed', '7'), { encode: png.encode });
  assert.equal(png.calls, 2, 'a replaced result is a new revision');
  assert.equal(again.filename, first.filename, 'the same identity keeps its name');
  // Bytes that are not the declared container are never offered.
  const broken = encoder(new Uint8Array([1, 2, 3]), 'image/webp');
  await assert.rejects(
    createExportFiles().face('a', face('seed', '1'), { encode: broken.encode }),
    /could not be prepared/,
  );
});

test('prepared export: a completion for a replaced result is discarded; a failed encode can be retried', async () => {
  const files = createExportFiles();
  let current = true;
  const late = encoder(WEBP, 'image/webp');
  const pending = files.face('a', face('seed', '1'), {
    encode: async () => {
      current = false; // the person replaced the face while it encoded
      return late.encode();
    },
    current: () => current,
  });
  await assert.rejects(pending, (e: Error) => e.name === 'AbortError');
  let fail = true;
  const flaky = {
    encode: async () => {
      if (fail) throw Error('encode failed');
      return new Blob([WEBP], { type: 'image/webp' });
    },
  };
  const f = face('seed', '2');
  await assert.rejects(files.face('b', f, flaky), /encode failed/);
  fail = false;
  assert.match((await files.face('b', f, flaky)).filename, new RegExp(`^seed-2-${SUFFIX}\\.webp$`));
});

test('prepared export: the morph video is named from its faces and mode and prepared once', async () => {
  const files = createExportFiles();
  const mp4 = encoder(MP4, 'video/mp4');
  const video = new Blob([MP4], { type: 'video/mp4' });
  const settings = { width: 0, pinchCenter: null, framesPerSegment: 16, framesPerSecond: 16 };
  const two = [face('text', 'Emma', 1), face('text', 'Noah', 2)];
  const linear = await files.video(video, {
    encode: mp4.encode,
    faces: two,
    morph: { mode: 'linear', settings },
  });
  const again = await files.video(video, {
    encode: mp4.encode,
    faces: two,
    morph: { mode: 'linear', settings },
  });
  assert.equal(mp4.calls, 1);
  assert.equal(again.blob, linear.blob);
  assert.match(linear.filename, new RegExp(`^emma-noah-linear-${SUFFIX}\\.mp4$`));
  assert.ok(
    typeMatchesBytes(await bytesOf(linear.blob), { mime: linear.mime, filename: linear.filename }),
  );
  const other = new Blob([MP4], { type: 'video/mp4' });
  const figure8 = await files.video(other, {
    encode: mp4.encode,
    faces: [...two, face('seed', '9', 3)],
    morph: { mode: 'figure8', settings },
  });
  assert.equal(mp4.calls, 2, 'a new video is a new revision');
  assert.match(figure8.filename, new RegExp(`^emma-seed-9-3-faces-figure8-${SUFFIX}\\.mp4$`));
  const reversed = await files.video(new Blob([MP4], { type: 'video/mp4' }), {
    encode: mp4.encode,
    faces: [...two].reverse(),
    morph: { mode: 'linear', settings },
  });
  assert.match(reversed.filename, new RegExp(`^noah-emma-linear-${SUFFIX}\\.mp4$`));
  const restored = await files.video(new Blob([MP4], { type: 'video/mp4' }), {
    encode: mp4.encode,
    faces: [
      { latent: { values: new Float32Array(9216) } },
      { latent: { values: new Float32Array(9216).fill(1) } },
    ],
    morph: { mode: 'linear', settings },
  });
  assert.match(restored.filename, new RegExp(`^morph-${SUFFIX}\\.mp4$`));
});
