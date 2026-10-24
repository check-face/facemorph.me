// Vite builds the app shell and every bundler-emitted worker. Targets come only from the declared browser matrix
// (build/targets.ts); Vite's defaults are not a support policy. The imported closure stays byte-identical, so
// what it needs from a bundler is supplied here: SVGs as React components (svgr, as classic's @svgr/webpack),
// Sass `~package` imports (sass-loader's convention) and classic's public directory.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';
import { loadMatrix } from './build/browser-matrix.ts';
import { deriveTargets } from './build/targets.ts';

const targets = deriveTargets(loadMatrix());
const modules = new URL('./node_modules/', import.meta.url);

// `@import "~bulma/bulma"` (webpack sass-loader style) resolves to node_modules/bulma/bulma(.sass|.scss|.css).
const tildeImporter = {
  findFileUrl(url: string): URL | null {
    if (!url.startsWith('~')) return null;
    const base = new URL(url.slice(1), modules);
    for (const candidate of ['', '.scss', '.sass', '.css']) {
      const path = fileURLToPath(base) + candidate;
      if (existsSync(path) && !path.endsWith('/')) return pathToFileURL(path);
    }
    return base;
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'src/public',
  plugins: [react(), svgr({ include: '**/*.svg?react' })],
  // Sass leaves `@import "~pkg/x.css"` as a CSS import; the CSS layer resolves the same `~` convention.
  resolve: { alias: [{ find: /^~(.+)/, replacement: '$1' }] },
  define: {
    // The shell's version line, as classic's build passes FACEMORPH_SOURCE_SHA (commit, '-dirty' when dirty).
    'import.meta.env.FACEMORPH_SOURCE_SHA': JSON.stringify(process.env['FACEMORPH_SOURCE_SHA'] ?? 'unknown'),
  },
  css: {
    preprocessorOptions: {
      scss: { importers: [tildeImporter], silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'slash-div', 'mixed-decls', 'if-function'] },
    },
  },
  build: {
    target: [...targets.build],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    rolldownOptions: {
      input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), 'worker-check': fileURLToPath(new URL('./worker-check.html', import.meta.url)) },
    },
  },
  worker: { format: targets.workerFormat },
});
