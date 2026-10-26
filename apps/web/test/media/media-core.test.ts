// Computational media core (fm-l6mq): the export policy against the candidate's own code, export names and
// identities, MIME and extension against real bytes, no-clobber naming, and the prepared-file cache. Plain values
// in and out; the WebP, PNG and MP4 bytes are real files from this repository; the inference counter is a plain
// number the test's own encode callback increments.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  decideWrite,
  exportIdentity,
  suggestFilename,
  withEditedName,
  type ExportIdentityInput,
  type KnownExport,
} from '../../src/contracts/export-identity.ts';
import { preparedFileCacheMaxBytes } from '../../src/contracts/prepared-file-cache.ts';
import {
  CONTAINER_TYPE,
  CORRECTNESS_ENCODE,
  FFMPEG_WIDTH,
  SCRUB_JPEG_QUALITY,
  WEBP_QUALITY,
  chooseVideoEncoder,
  sniffContainer,
  stillSettings,
  typeMatchesBytes,
  videoEncoderCandidates,
  videoEncoderSettings,
} from '../../src/media/export-policy.ts';
import { preparedFiles } from '../../src/media/prepared-files.ts';

const web = (p: string) => new URL(`../../${p}`, import.meta.url);
const text = (p: string) => readFileSync(web(p), 'utf8');

// ---- export-policy.unchanged: the figures and formulas are the candidate's, evaluated from its own source text.
// fm-eeki moved them out of the app onto this policy, so the candidate's expressions are frozen here as they
// stood in apps/web/src/Next/media.mjs, recovery-metadata.mjs and image-encoder-worker.mjs at c0a65fb (the
// candidate, before the move), and the app sources must now take every figure from the policy instead.
const CANDIDATE = {
  probe:
    "export async function probeVideoEncoder({width=1024,fallbackWidth=512,fps=16,bundle=''}={}){",
  config:
    "const config={codec:'avc1.42002A',width:size,height:size,bitrate:Math.round(size*size*fps*.25/1000)*1000,framerate:fps};",
  correctness: 'const surface=Canvas?new Canvas(64,64):null;',
  ffmpeg:
    "result={kind:'ffmpeg',width:fallbackWidth,height:fallbackWidth,reason:'webcodecs-unavailable'}",
  scrub: "convertToBlob({type:'image/jpeg',quality:.85})",
  download: "format:'webp',quality:.8,",
  worker: "format='png',quality=.8,",
};
test('export-policy.unchanged: WebCodecs config for 1024/512 at fps 8, 16, 32 and 120 equals the candidate probeVideoEncoder', () => {
  const probe = /\{width=(\d+),fallbackWidth=(\d+),fps=\d+[^}]*\}=\{\}\)/.exec(CANDIDATE.probe);
  assert.ok(probe, 'probeVideoEncoder signature found');
  const sizes = [Number(probe[1]), Number(probe[2])];
  const expr =
    /^const config=(\{codec:'[^']+',width:size,height:size,bitrate:[^}]+,framerate:fps\});$/.exec(
      CANDIDATE.config,
    );
  assert.ok(expr, 'candidate config expression found');
  for (const fps of [8, 16, 32, 120]) {
    const candidate: unknown[] = sizes.map((size) =>
      JSON.parse(JSON.stringify(runInNewContext(`(${expr[1]})`, { size, fps, Math }))),
    );
    assert.deepEqual(videoEncoderCandidates(fps), candidate, `fps ${fps}`);
    for (const [i, size] of sizes.entries())
      assert.deepEqual(videoEncoderSettings(size, fps), candidate[i]);
  }
  assert.match(CANDIDATE.correctness, /new Canvas\(64,64\)/, 'the correctness encode is 64 x 64');
  assert.deepEqual(CORRECTNESS_ENCODE, { width: 64, height: 64 });
  assert.match(CANDIDATE.ffmpeg, /width:fallbackWidth,height:fallbackWidth/);
  assert.equal(FFMPEG_WIDTH, sizes[1]);
  assert.match(CANDIDATE.scrub, /quality:\.85\}/, 'scrub JPEG 0.85');
  assert.equal(SCRUB_JPEG_QUALITY, 0.85);
  assert.match(CANDIDATE.download, /quality:\.8,/);
  assert.match(CANDIDATE.worker, /quality=\.8,/);
  assert.equal(WEBP_QUALITY, 0.8);
  // The app now reads each of these from the policy.
  const media = text('src/Next/media.mjs');
  assert.match(media, /const config=videoEncoderSettings\(size,fps\);/);
  assert.match(media, /probeVideoEncoder\(\{width=VIDEO_WIDTH,fallbackWidth=VIDEO_FALLBACK_WIDTH,/);
  assert.match(media, /new Canvas\(side,side\)/);
  assert.match(media, /quality:SCRUB_JPEG_QUALITY\}/);
  assert.match(text('src/Next/recovery-metadata.mjs'), /format:'webp',quality:WEBP_QUALITY,/);
  assert.match(text('src/Next/image-encoder-worker.mjs'), /format='png',quality=WEBP_QUALITY,/);
});

test('export-policy: WebP 0.8 by default, PNG when lossless is asked for or WebP does not encode; no quality option', () => {
  assert.deepEqual(stillSettings({ webpEncodes: true }), {
    format: 'webp',
    type: CONTAINER_TYPE.webp,
    quality: 0.8,
    lossless: false,
    reason: 'default',
  });
  assert.deepEqual(stillSettings({ webpEncodes: true, lossless: true }).format, 'png');
  assert.deepEqual(stillSettings({ webpEncodes: false }), {
    format: 'png',
    type: CONTAINER_TYPE.png,
    lossless: true,
    reason: 'webp-unavailable',
  });
  // @ts-expect-error there is no quality option for a person to change
  stillSettings({ webpEncodes: true, quality: 0.5 });
  assert.deepEqual(chooseVideoEncoder(16, null), {
    kind: 'ffmpeg',
    width: 512,
    height: 512,
    reason: 'webcodecs-unavailable',
  });
  assert.equal(chooseVideoEncoder(16, (s) => s.width === 512).width, 512);
  assert.deepEqual(chooseVideoEncoder(16, () => false).kind, 'ffmpeg');
  const policy = text('src/media/export-policy.ts');
  assert.doesNotMatch(
    policy.replace(/^\s*\/\/.*$/gm, ''),
    /filter|subFilter/i,
    'no PNG re-filtering pass (eris-it1-png-sub-filter was rejected)',
  );
});

// ---- Import scan: the computational modules carry no Save/Share, gesture or DOM code.
test('the computational media modules have no Save/Share, gesture or DOM code', () => {
  const files = [
    ...readdirSync(web('src/media'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `src/media/${f}`),
    'src/contracts/export-identity.ts',
    'src/contracts/prepared-file-cache.ts',
  ];
  const forbidden =
    /\b(document|window|navigator|HTMLElement|OffscreenCanvas|createObjectURL|showSaveFilePicker|showOpenFilePicker|addEventListener|requestAnimationFrame|localStorage)\b|\.(click|share|focus)\(/;
  for (const f of files) {
    const code = text(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, forbidden, f);
    assert.doesNotMatch(
      code,
      /from ['"][^'"]*(Next\/|product-bridge|media\.mjs)/,
      `${f} imports no app/DOM module`,
    );
  }
});

// ---- Names and identities.
const still = (over: Partial<ExportIdentityInput> = {}): ExportIdentityInput => ({
  kind: 'webp',
  crops: [],
  orderedInputs: ['name:emma'],
  modelIdentity: 'ffhq-1024-v1',
  format: 'webp-q0.8',
  encodingOptions: { quality: 0.8 },
  ...over,
});
type Label = {
  readonly origin: 'result-name' | 'entered-text' | 'seed' | 'source-basename';
  readonly text: string;
};
const name = (input: ExportIdentityInput, label?: Label, known: KnownExport[] = []) =>
  suggestFilename(exportIdentity(input, label), known).filename;
const morph = (mode: string, settings: Record<string, number> = { frames: 64, fps: 16 }) => ({
  mode,
  settings,
});

test('export-name.examples: the operator example shapes', () => {
  assert.match(
    name(still(), { origin: 'result-name', text: 'Emma' }),
    /^emma-[b-df-hj-np-tv-z2-9]{6}\.webp$/,
  );
  assert.match(
    name(still({ kind: 'png', orderedInputs: ['seed:42'], format: 'png' }), {
      origin: 'seed',
      text: '42',
    }),
    /^seed-42-[b-df-hj-np-tv-z2-9]{6}\.png$/,
  );
  const m = still({
    kind: 'mp4',
    orderedInputs: ['name:emma', 'name:noah'],
    morph: morph('figure8'),
    format: 'h264-avc1.42002A',
  });
  assert.match(
    name(m, { origin: 'entered-text', text: 'emma noah figure8' }),
    /^emma-noah-figure8-[b-df-hj-np-tv-z2-9]{6}\.mp4$/,
  );
});

test('export-name.label-rules: extension, path, control and bidi characters, reserved names, whitespace, 64 characters, fallbacks', () => {
  const stem = (label: string) =>
    name(still(), { origin: 'source-basename', text: label }).replace(
      /-[b-df-hj-np-tv-z2-9]{6}\.webp$/,
      '',
    );
  assert.equal(stem('holiday face.JPG'), 'holiday-face');
  assert.equal(stem('C:\\Users\\x\\photo.png'), 'photo');
  assert.equal(stem('a\u0000b\u202Ec'), 'abc');
  assert.equal(stem('CON'), 'face');
  assert.equal(stem('NUL'), 'face');
  assert.equal(
    stem('nul.txt'),
    'nul-txt',
    'only the bare device name is reserved; nul-txt-<suffix> is a safe name',
  );
  assert.equal(stem('   lots   of   space   '), 'lots-of-space');
  assert.ok(
    name(still(), { origin: 'source-basename', text: 'x'.repeat(200) }).length - '.webp'.length <=
      64,
  );
  assert.match(name(still({ kind: 'mp4', morph: morph('linear') })), /^morph-/);
});

test('export-identity.matrix: each distinct export gets a distinct name; same bytes, same name', () => {
  const crop = (c: string) => c.repeat(64);
  const inputs: ExportIdentityInput[] = [
    still({ crops: [crop('1')], orderedInputs: ['crop:a'] }),
    still({ crops: [crop('2')], orderedInputs: ['crop:b'] }), // same source basename, different crop
    still({ crops: [crop('1'), crop('2')], orderedInputs: ['crop:a', 'crop:b'] }),
    still({ orderedInputs: ['text:emma'] }),
    still({ orderedInputs: ['seed:7'] }),
    still({ orderedInputs: ['name:emma'] }),
    still({ kind: 'mp4', orderedInputs: ['name:emma', 'name:noah'], morph: morph('linear') }),
    still({ kind: 'mp4', orderedInputs: ['name:noah', 'name:emma'], morph: morph('linear') }), // reversed
    still({ kind: 'mp4', orderedInputs: ['name:emma', 'name:noah'], morph: morph('figure8') }), // mode
    still({
      kind: 'mp4',
      orderedInputs: ['name:emma', 'name:noah'],
      morph: morph('linear', { frames: 128, fps: 32 }),
    }), // settings
    still({ kind: 'png', format: 'png' }),
  ];
  const known: KnownExport[] = [];
  for (const input of inputs) {
    const id = exportIdentity(input, { origin: 'source-basename', text: 'IMG_0001.jpg' });
    const n = suggestFilename(id, known);
    assert.ok(
      !known.some((k) => k.filename.toLowerCase() === n.filename.toLowerCase()),
      n.filename,
    );
    known.push({ digest: id.digest, filename: n.filename });
  }
  assert.equal(new Set(known.map((k) => k.digest)).size, inputs.length);
  const again = suggestFilename(
    exportIdentity(inputs[0]!, { origin: 'source-basename', text: 'IMG_0001.jpg' }),
    known,
  );
  assert.equal(again.filename, known[0]!.filename, 'same bytes, same name');
  // An invalid label falls back, and still never collides.
  const bad = suggestFilename(
    exportIdentity(still({ orderedInputs: ['x'] }), { origin: 'source-basename', text: '\u202E' }),
    known,
  );
  assert.match(bad.filename, /^face-/);
  // Editing the name keeps the suffix.
  const id = exportIdentity(inputs[3]!, { origin: 'source-basename', text: 'emma' });
  const edited = suggestFilename(withEditedName(id, 'my favourite'), []);
  assert.equal(edited.suffix, suggestFilename(id, []).suffix);
  assert.match(edited.filename, /^my-favourite-/);
});

// ---- MIME and extension against real bytes; no-clobber writes.
const bytesOf = (p: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../${p}`, import.meta.url)));

test('export-mime.matches-bytes for WebP, PNG fallback and MP4', () => {
  const webp = bytesOf('apps/web/src/public/preview/hello-1024.webp');
  const png = bytesOf('packages/stylegan-js/test/vectors/plain.png');
  const mp4 = bytesOf('apps/web/test/fixtures/morph/morph.mp4');
  assert.equal(sniffContainer(webp), 'webp');
  assert.equal(sniffContainer(png), 'png');
  assert.equal(sniffContainer(mp4), 'mp4');
  assert.ok(typeMatchesBytes(webp, { mime: 'image/webp', filename: 'emma-k4p7s2.webp' }));
  assert.ok(typeMatchesBytes(png, { mime: 'image/png', filename: 'seed-42-j8m3r6.png' }));
  assert.ok(typeMatchesBytes(mp4, { mime: 'video/mp4', filename: 'emma-noah-figure8-b7w4n2.mp4' }));
  assert.equal(
    typeMatchesBytes(png, { mime: 'image/webp', filename: 'x.webp' }),
    false,
    'a PNG fallback is never labelled WebP',
  );
  assert.equal(typeMatchesBytes(webp, { mime: 'image/webp', filename: 'x.png' }), false);
  assert.equal(sniffContainer(new Uint8Array([1, 2, 3])), null);
});

test('fs-access.no-clobber: an existing name is never overwritten without confirmation; the name is extended instead', () => {
  assert.equal(decideWrite('file-picker-no-clobber', true, false), 'extend-name');
  assert.equal(decideWrite('file-picker-no-clobber', false, false), 'write');
  assert.equal(decideWrite('file-picker-confirm-overwrite', true, false), 'ask-overwrite');
  assert.equal(decideWrite('file-picker-confirm-overwrite', true, true), 'overwrite');
  assert.equal(decideWrite('browser-download', true, false), 'download');
  const id = exportIdentity(still(), { origin: 'result-name', text: 'emma' });
  const first = suggestFilename(id, []);
  const other = exportIdentity(still({ orderedInputs: ['name:emma', 'v2'] }), {
    origin: 'result-name',
    text: 'emma',
  });
  const taken: KnownExport[] = [
    { digest: 'f'.repeat(64), filename: suggestFilename(other, []).filename },
  ];
  assert.notEqual(
    suggestFilename(other, [{ digest: id.digest, filename: first.filename }, ...taken]).filename,
    first.filename,
  );
});

// ---- Prepared-file cache.
const webpBytes = bytesOf('apps/web/src/public/preview/hello-1024.webp');
const pngBytes = bytesOf('packages/stylegan-js/test/vectors/plain.png');
function encoder() {
  const counter = { encodes: 0, inference: 0 };
  // Pixels are retained; encoding a format reads them and never runs inference.
  const encode = async (format: string) => {
    counter.encodes++;
    return format === 'webp' ? webpBytes : pngBytes;
  };
  return { counter, encode };
}

test('prepared-cache.revision-format: keyed by revision, format and options; a hit is not re-encoded', async () => {
  const cache = preparedFiles(preparedFileCacheMaxBytes(10 * 1024 * 1024), 1);
  const { counter, encode } = encoder();
  const a = await cache.prepare('webp', { quality: 0.8 }, encode);
  const b = await cache.prepare('webp', { quality: 0.8 }, encode);
  assert.equal(a.status === 'ready' && b.status === 'ready' && b.fromCache, true);
  assert.equal(counter.encodes, 1);
  await cache.prepare('png', {}, encode);
  assert.equal(counter.encodes, 2, 'another format is its own file');
  cache.setRevision(2);
  await cache.prepare('webp', { quality: 0.8 }, encode);
  assert.equal(counter.encodes, 3, 'a new revision never reuses the old file');
});

test('prepared-cache.cap: at the cap both stay; at cap + 1 the oldest goes first, never the pinned file', async () => {
  const cap = webpBytes.length + pngBytes.length;
  const cache = preparedFiles(preparedFileCacheMaxBytes(cap), 1);
  const { encode } = encoder();
  await cache.prepare('webp', {}, encode);
  await cache.prepare('png', {}, encode);
  assert.equal(cache.state().entries.length, 2, 'exactly at the cap');
  const over = preparedFiles(preparedFileCacheMaxBytes(cap - 1), 1);
  await over.prepare('webp', { n: 1 }, encode);
  await over.prepare('png', {}, encode);
  assert.deepEqual(
    over.state().entries.map((e) => e.key.includes('"png"')),
    [true],
    'cap + 1: the oldest (webp) was evicted',
  );
  const pinned = preparedFiles(preparedFileCacheMaxBytes(cap - 1), 1);
  await pinned.prepare('webp', {}, encode, { pin: true });
  const r = await pinned.prepare('png', {}, encode);
  assert.equal(
    r.status === 'ready' && r.retained,
    false,
    'the pinned file stays; the new one is handed off',
  );
});

test('prepared-cache.stale-rejected: a completion for a superseded revision is discarded', async () => {
  const cache = preparedFiles(preparedFileCacheMaxBytes(10 * 1024 * 1024), 1);
  const slow = async () => {
    cache.setRevision(2); // the person edits while the file is encoding
    return webpBytes;
  };
  const r = await cache.prepare('webp', {}, slow);
  assert.deepEqual(r, { status: 'stale', resultRevision: 1, currentRevision: 2 });
  assert.deepEqual(cache.state().entries, []);
});

test('prepared-cache.format-change-no-inference: switching format re-encodes retained pixels; inference count stays 0', async () => {
  const cache = preparedFiles(preparedFileCacheMaxBytes(10 * 1024 * 1024), 1);
  const { counter, encode } = encoder();
  for (const f of ['webp', 'png', 'webp', 'png'] as const) await cache.prepare(f, {}, encode);
  assert.equal(counter.inference, 0);
  assert.equal(counter.encodes, 2);
  const mislabelled = await cache.prepare('mp4', {}, encode);
  assert.deepEqual(
    mislabelled,
    { status: 'type-mismatch', format: 'mp4' },
    'bytes that are not MP4 are never offered as one',
  );
});
