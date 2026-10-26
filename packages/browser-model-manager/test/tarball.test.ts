// The packed tarball (fm-eulc): what `npm pack` would publish holds the build output, the schema, the manifest and
// the licence, notices and build provenance (fm-oagi), and nothing else: no weights or model-like blobs, no test
// fixtures, and no runtime import that reaches outside the package (a repository-only path) or into a package it
// does not declare.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const PKG = new URL('..', import.meta.url).pathname;
const REPO = new URL('../../..', import.meta.url).pathname;
execFileSync(process.execPath, [
  join(REPO, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(PKG, 'tsconfig.build.json'),
]);
const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8' }),
) as {
  files: { path: string; size: number }[];
}[];
const files = packed[0]!.files.map((f) => f.path).sort();
const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

test('the tarball holds dist/, the schema, package.json, the licence, notices and provenance only', () => {
  const stray = files.filter(
    (f) =>
      !(
        ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES', 'PROVENANCE.json'].includes(f) ||
        /^dist\/.+\.(js|d\.ts)$/.test(f) ||
        /^schema\/[\w.-]+\.json$/.test(f)
      ),
  );
  assert.deepEqual(stray, []);
  assert.ok(
    files.includes('dist/cache/model-cache.js') && files.includes('dist/cache/model-cache.d.ts'),
  );
  assert.ok(
    files.includes('LICENSE') && files.includes('THIRD_PARTY_NOTICES'),
    'MIT licence and notices',
  );
});

test('no weights or model-like files', () => {
  const weights = files.filter((f) =>
    /\.(onnx|bin|f32|f16|pt|pth|pkl|ckpt|safetensors|tflite|wasm)$/i.test(f),
  );
  assert.deepEqual(weights, []);
});

test('runtime imports stay inside the package or name a declared dependency', () => {
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const problems: string[] = [];
  for (const f of files.filter((p) => p.endsWith('.js'))) {
    const text = readFileSync(join(PKG, f), 'utf8');
    for (const m of text.matchAll(
      /(?:^|\s)(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm,
    )) {
      const spec = m[1] ?? m[2] ?? '';
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = join(PKG, f, '..', spec);
        if (!target.startsWith(join(PKG, 'dist')))
          problems.push(`${f}: ${spec} leaves the package`);
      } else if (!spec.startsWith('node:')) {
        const name = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0]!;
        if (!declared.has(name)) problems.push(`${f}: ${spec} is not a declared dependency`);
      }
    }
    if (/apps\/web|scripts\/|packages\//.test(text.replace(/\/\/.*$/gm, '')))
      problems.push(`${f}: names a repository path`);
  }
  assert.deepEqual(problems, []);
});
