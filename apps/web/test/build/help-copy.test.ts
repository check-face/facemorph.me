// Help and refusal copy (fm-gbdt, provider.copy). Every refusal reason key has one short plain sentence and a Help
// anchor that a rendered Help topic carries; a runtime exception's text never becomes the shown reason; Help covers
// each required topic and recommends no native download; the licence page states where the codec is served from.
// The built-artifact checks read deploy-next/ when it is this repository's build (npm run build:next).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REASON_KEYS,
  reason,
  reasonFromError,
  refusalForText,
} from '../../src/admission/route-admission.ts';
import { FORMATS_HREF, NOTICES_HREF, helpTopics } from '../../shell/render/help.ts';

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const REPO = join(WEB, '../..');
const DEPLOY = join(REPO, 'deploy-next');
const topics = helpTopics('https://next.facemorph.me/');
const ids = new Set(topics.map((t) => t.id));
const helpText = topics
  .map((t) =>
    [
      t.title,
      ...t.paragraphs.map((p) => p.map((r) => (typeof r === 'string' ? r : r.text)).join('')),
    ].join('\n'),
  )
  .join('\n');
/** Text that only an exception, a stack or a code identifier would put in a sentence. */
const RAW =
  /\b(?:Error|Exception|TypeError|RangeError|undefined|null|NaN|stack)\b|\bat \S+:\d+|[{}<>[\]`]|::|=>|\bAdmissionRefused\b/;

test('every refusal reason key has one short plain sentence and a Help anchor Help renders', () => {
  assert.equal(REASON_KEYS.length, 14);
  for (const key of REASON_KEYS) {
    const r = reason(key);
    assert.equal(r.reasonKey, key);
    assert.equal(typeof r.text, 'string', `${key} has no copy`);
    assert.ok(r.text.length > 20 && r.text.length <= 130, `${key}: ${r.text.length} characters`);
    assert.match(r.text, /^[A-Z].*\.$/, `${key} is one sentence ending in a full stop`);
    assert.equal(r.text.split(/[.!?](?:\s|$)/).filter(Boolean).length, 1, `${key} is one sentence`);
    assert.doesNotMatch(r.text, RAW, `${key} reads like an exception`);
    assert.doesNotMatch(r.text, new RegExp(key), `${key} shows its key`);
    assert.match(r.helpAnchor, /^#help-[a-z-]+$/);
    assert.ok(ids.has(r.helpAnchor.slice(1)), `${key}: no Help topic ${r.helpAnchor}`);
    assert.deepEqual(refusalForText(r.text), r, `${key} round-trips from its sentence`);
  }
  // Distinct sentences, so the shown sentence identifies its reason and Help topic.
  assert.equal(new Set(REASON_KEYS.map((k) => reason(k).text)).size, REASON_KEYS.length);
});

test('a runtime exception never becomes the reason, and raw text gets no Help link', () => {
  const known = new Set(REASON_KEYS.map((k) => reason(k).text));
  const raw = [
    new TypeError("Cannot read properties of undefined (reading 'run')"),
    new Error('GPUDevice device lost: reason=destroyed at webgpu-engine.mjs:312'),
    new RangeError('WebAssembly.Memory(): could not allocate memory'),
    new Error('needs 128 MiB maxStorageBufferBindingSize'),
    new Error('canary mismatch 0.0123 > 0.0001'),
    'plain string thrown',
  ];
  for (const error of raw) {
    const r = reasonFromError(error);
    assert.ok(known.has(r.text), `${String(error)} -> ${r.text}`);
    const message = error instanceof Error ? error.message : error;
    assert.ok(!r.text.includes(message), 'the message is not shown');
    assert.equal(refusalForText(String(error)), null);
    assert.equal(refusalForText(message), null);
  }
  assert.equal(refusalForText(null), null);
  assert.equal(refusalForText(''), null);
});

const REQUIRED: [string, RegExp][] = [
  ['no phone-session transfer', /no way to hand a phone session over to a computer/i],
  [
    'moving PNG/WebP to a computer',
    /Save the faces you want as PNG or WebP, move the files across/,
  ],
  ['switching apps may pause work', /Switching to another app can pause work/],
  ['reload loses unfinished photo retries', /reloading the page loses unfinished photo retries/],
  ['best-effort cache', /as a convenience, not a promise/],
  ['keep an original PNG/WebP', /Keep the original file to reopen or edit a still later/],
  ['PNG/WebP recovery', /without encoding the photo again/],
  ['MP4 512 px fallback', /512 px/],
  ['MP4 project reopening deferred', /Reopening a morph project from its MP4 is not available yet/],
  [
    'social apps strip metadata',
    /Social and messaging apps often recompress shared images and strip that data/,
  ],
  ['retired GUID links', /old face ID \(GUID\)/],
  ['retired native apps', /desktop apps are retired and not offered for download/],
  ['retired API', /classic API server is retired/],
  ['device check guarantees', /does not guarantee the model fits[^.]*nor that work keeps going/],
  ['CPU/WebGPU support', /WebGPU/],
  ['separate photo and video support', /Photos and video are checked separately/],
  [
    'first-use costs',
    /first face downloads the face model[\s\S]*download notice shows each size before anything downloads/,
  ],
];

test('Help covers each required topic, links the licences, and names the selector anchors', () => {
  for (const [name, pattern] of REQUIRED) assert.match(helpText, pattern, name);
  assert.ok(ids.has('computer-requirements') && ids.has('supported-browsers'));
  const computer = topics.find((t) => t.id === 'computer-requirements')!;
  const links = computer.paragraphs.flat().filter((r) => typeof r !== 'string');
  assert.deepEqual(
    links.map((l) => l.href),
    ['https://next.facemorph.me/'],
    'computer guidance links to the site entry URL only',
  );
  const licences = topics.find((t) => t.id === 'help-licences')!;
  assert.ok(
    licences.paragraphs.flat().some((r) => typeof r !== 'string' && r.href === NOTICES_HREF),
  );
  assert.equal(NOTICES_HREF, '/runtime/notices/index.html');
  const shell = readFileSync(join(WEB, 'shell/Shell.tsx'), 'utf8');
  assert.match(
    shell,
    new RegExp(`className="next-footer-notices"\\s+href="${NOTICES_HREF}"`),
    'the footer links the licences page',
  );
});

test('Help links the saved-file format reference from Keep your originals (fm-fy2.7)', () => {
  const originals = topics.find((t) => t.id === 'help-keep-originals')!;
  const links = originals.paragraphs.flat().filter((r) => typeof r !== 'string');
  assert.deepEqual(
    links.map((l) => l.href),
    [FORMATS_HREF],
  );
  const path = FORMATS_HREF.replace('https://github.com/facemorph-me/facemorph.me/blob/main/', '');
  assert.notEqual(path, FORMATS_HREF, 'the link names this repository on main');
  const doc = readFileSync(join(REPO, path), 'utf8');
  for (const topic of [
    /## Formats/,
    /## Still schemas/,
    /limit/i,
    /damage/i,
    /strip/i,
    /WebP, quality 0\.8/,
  ])
    assert.match(doc, topic);
});

/** Phrases that recommend a native download or installer (defect: retired desktop packages). */
const NATIVE = [
  /download (?:the|our) (?:desktop |native )?app/i,
  /install (?:the|our) (?:desktop|native) app/i,
  /Desktop app capabilities and availability/i,
  /desktop (?:package|installer|download)s? (?:is|are) available/i,
  /\.(?:dmg|msi|AppImage|deb)\b(?!-)/,
  /releases\/(?:latest\/)?download\/[^"'\s]*(?:desktop|tauri|native)/i,
  /__TAURI__/,
];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(?:html|js|mjs|css|json|txt|md)$/.test(name)) out.push(p);
  }
  return out;
}

const built = (() => {
  try {
    const identity = JSON.parse(readFileSync(join(REPO, 'next-site-identity.json'), 'utf8'));
    return existsSync(join(DEPLOY, 'index.html')) && identity.kind === 'destination';
  } catch {
    return false;
  }
})();
const UNBUILT = built
  ? false
  : 'untested: no destination build at deploy-next/ (npm run build:next)';
// CI's site-artifact job sets this: there a missing build is a failure, not a skip.
if (UNBUILT && process.env['FACEMORPH_REQUIRE_BUILT'] === '1') throw Error(UNBUILT);

test('the built app recommends no native download', { skip: UNBUILT }, () => {
  const hits: string[] = [];
  for (const file of files(DEPLOY)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of NATIVE)
      for (const m of text.matchAll(
        new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'),
      ))
        hits.push(`${relative(DEPLOY, file)}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
  // The scan has teeth: the retired candidate's own link text would be found.
  assert.ok(NATIVE.some((p) => p.test('Desktop app capabilities and availability')));
});

test('the built app carries every Help topic and the licence link', { skip: UNBUILT }, () => {
  const bundle = files(join(DEPLOY, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  for (const topic of topics) {
    assert.ok(bundle.includes(topic.title), `built bundle lacks Help topic ${topic.title}`);
    assert.ok(bundle.includes(topic.id), `built bundle lacks anchor ${topic.id}`);
  }
  assert.ok(bundle.includes(NOTICES_HREF));
  for (const key of REASON_KEYS) assert.ok(bundle.includes(reason(key).text), key);
});

test('the licence page states that the codec is served from this site, not the publisher CDN', () => {
  const page = readFileSync(join(REPO, 'hosting/next/notices/index.html'), 'utf8');
  assert.match(page, /@ffmpeg\/core 0\.12\.10<\/a> from this site's own runtime files/);
  assert.match(page, /it is not fetched from the publisher's CDN/);
  assert.doesNotMatch(page, /directly from its publisher's CDN/);
  // The runtime manifest the page describes pins the codec on the site's own /runtime/ path.
  const fixture = JSON.parse(
    readFileSync(
      join(REPO, 'packages/browser-model-manager/test/fixtures/candidate-runtime-manifest.json'),
      'utf8',
    ),
  );
  if (fixture.codec)
    for (const url of [fixture.codec.module.url, fixture.codec.wasm.url])
      assert.match(url, /^https:\/\/next\.facemorph\.me\/runtime\/assets\//);
});
