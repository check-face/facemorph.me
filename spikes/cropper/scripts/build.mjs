import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'fixtures'), { recursive: true });
cpSync(join(root, 'fixtures'), join(dist, 'fixtures'), { recursive: true });

const entries = { hand: 'src/hand.jsx', rac: 'src/rac.jsx', base: 'src/base.jsx' };
const sizes = {};
for (const [name, entry] of Object.entries(entries)) {
  const res = await build({
    entryPoints: { [name]: join(root, entry) }, outdir: dist, bundle: true, minify: true, format: 'iife', target: 'es2020',
    jsx: 'automatic', metafile: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
    loader: { '.css': 'css' },
  });
  const outputs = Object.keys(res.metafile.outputs);
  const js = readFileSync(join(dist, `${name}.js`));
  let css = Buffer.alloc(0);
  try { css = readFileSync(join(dist, `${name}.css`)); } catch {}
  sizes[name] = {
    jsMinBytes: js.length, jsGzipBytes: gzipSync(js, { level: 9 }).length,
    cssMinBytes: css.length, cssGzipBytes: gzipSync(css, { level: 9 }).length,
  };
  writeFileSync(join(dist, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>cropper spike: ${name}</title><link rel="stylesheet" href="${name}.css"></head><body><div id="root"></div><script src="${name}.js"></script></body></html>`);
  void outputs;
}
const total = (s) => s.jsGzipBytes + s.cssGzipBytes;
const report = { note: 'minified + gzip level 9, JS + CSS of the prototype entry (includes React 18.3.1 + shared chrome)', entries: sizes,
  deltaVsBaselineGzip: { hand: total(sizes.hand) - total(sizes.base), rac: total(sizes.rac) - total(sizes.base) } };
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'bundle-sizes.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
