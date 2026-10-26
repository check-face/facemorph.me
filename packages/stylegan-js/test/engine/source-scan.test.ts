// No FFHQ geometry hardcoded in the package (fm-qjcs): a scripted scan of every source file under src/ for the
// 1024 px side (and its pixel counts) and the 18 x 512 W+, outside an allowlist. FFHQ's numbers belong only in its
// descriptor data (contracts/descriptor.ts). Everything else reads them from a descriptor. Comments are skipped
// (prose names FFHQ). Byte arithmetic (`16 * 1024 * 1024`, KiB/MiB sizes) is not geometry and is skipped too.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Each allowed hit, by file and the exact line text, and why it is not model geometry. */
const ALLOW: readonly { file: string; line: RegExp; why: string }[] = [
  {
    file: 'contracts/descriptor.ts',
    line: /latent: \{ zLength: 512, layers: 18, width: 512 \}|shape: \[1, 3, 1024, 1024\]|planes\(1024\)/,
    why: 'FFHQ descriptor data',
  },
  {
    file: 'contracts/crop-policy.ts',
    line: /^export const CROP_OUTPUT = 1024;$/,
    why: 'the locked confirmed-crop output size (a product design constant, not a model dimension)',
  },
  {
    file: 'contracts/operations.ts',
    line: /^export type VideoResolution = 1024 \| 512;$/,
    why: 'video export sizes offered by the product, not a model dimension',
  },
  {
    file: 'media/mp4-project.ts',
    line: /^export function videoFileResult\(choice: VideoChoiceLike, fullSize = 1024\): VideoFileResult \{$/,
    why: 'the full-size video export choice (VideoResolution), not a model dimension',
  },
  {
    file: 'media/recovery-v3.ts',
    line: /^export const BLEND_RECIPE_MAX_SLOTS = 1024;$/,
    why: 'a count of blend recipe slots',
  },
  {
    file: 'contracts/worker-messages.ts',
    line: /q\.resolution !== 1024 && q\.resolution !== 512/,
    why: 'validation of the VideoResolution contract above',
  },
];

const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: '1024', re: /(?<![\w.*] ?)\b1024(?:u\b|\b)(?! ?\*)/ },
  { name: '1024 squared', re: /\b1048576u?\b|\b1_048_576\b/ },
  { name: '18x512', re: /\b18\s*[,x*×]\s*512\b|\blayers:\s*18\b|\b9216\b|\b9_216\b/ },
  { name: '3 or 32 x 1024 x 1024', re: /\b3145728u?\b|\b33554432u?\b/ },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|mjs|js)$/.test(name) ? [path] : [];
  });
}

/** Source lines with comments removed (line and block comments; strings left as they are). */
function codeLines(text: string): string[] {
  let block = false;
  return text.split('\n').map((line) => {
    let out = line;
    if (block) {
      const end = out.indexOf('*/');
      if (end < 0) return '';
      out = out.slice(end + 2);
      block = false;
    }
    out = out.replace(/\/\*.*?\*\//g, '');
    const open = out.indexOf('/*');
    if (open >= 0) {
      out = out.slice(0, open);
      block = true;
    }
    const comment = out.search(/(^|[^:'"`\\])\/\//);
    return comment >= 0 ? out.slice(0, comment + 1) : out;
  });
}

export function scan(root = SRC): { file: string; line: number; text: string; pattern: string }[] {
  const hits: { file: string; line: number; text: string; pattern: string }[] = [];
  for (const path of files(root)) {
    const file = relative(root, path);
    const raw = readFileSync(path, 'utf8').split('\n');
    codeLines(raw.join('\n')).forEach((code, i) => {
      for (const p of PATTERNS)
        if (p.re.test(code)) {
          const text = (raw[i] as string).trim();
          if (!ALLOW.some((a) => a.file === file && a.line.test(text)))
            hits.push({ file, line: i + 1, text, pattern: p.name });
        }
    });
  }
  return hits;
}

test('no hardcoded 1024 or 18 x 512 in the package source outside the FFHQ descriptor allowlist', () => {
  const hits = scan();
  assert.deepEqual(
    hits,
    [],
    hits.map((h) => `${h.file}:${h.line} [${h.pattern}] ${h.text}`).join('\n'),
  );
});

test('the scan finds what it forbids (and skips byte arithmetic and comments)', () => {
  const probe = (code: string) => PATTERNS.some((p) => p.re.test(codeLines(code)[0] as string));
  for (const bad of [
    'const side = 1024;',
    'tensor([1, 18, 512])',
    'new Float32Array(18 * 512)',
    'if (x.length !== 9216) throw',
    'const p = 1048576;',
    'let i=33554432u;',
    'let y=p/1024u;',
    'width: 1024,',
    'latent: { layers: 18 }',
  ])
    assert.ok(probe(bad), bad);
  for (const fine of [
    'const MAX = 16 * 1024 * 1024;',
    'const BYTES = 1024 * 64;',
    '// a 1024 px face',
    'const x = 512; // 18 x 512 in prose',
  ])
    assert.ok(!probe(fine), fine);
  // Every allowlist entry still matches something, so a stale entry cannot hide a new hit.
  for (const a of ALLOW) {
    if (!existsSync(join(SRC, a.file))) continue;
    const text = readFileSync(join(SRC, a.file), 'utf8').split('\n');
    assert.ok(
      text.some((l) => a.line.test(l.trim())),
      `${a.file}: allowlist entry still in use (${a.why})`,
    );
  }
});
