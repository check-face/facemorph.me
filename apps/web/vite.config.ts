// Vite builds the app shell and every bundler-emitted worker. Targets come only from the declared browser matrix
// (build/targets.ts); Vite's defaults are not a support policy. The imported closure stays byte-identical, so
// what it needs from a bundler is supplied here: SVGs as React components (svgr, as classic's @svgr/webpack),
// Sass `~package` imports (sass-loader's convention) and classic's public directory.
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';
import { loadMatrix } from './build/browser-matrix.ts';
import { deriveTargets } from './build/targets.ts';
import { runtimeIdentity } from './build/runtime-identity.ts';
import {
  emittedFromBundle,
  workerInventory,
  type EmittedWorker,
} from './build/worker-inventory.ts';

const targets = deriveTargets(loadMatrix());
const require = createRequire(import.meta.url);

// `@import "~bulma/bulma"` (webpack sass-loader style) resolves to bulma/bulma(.sass|.scss|.css) wherever Node finds
// the package (hoisted to the workspace root's node_modules).
// Bulma 1 (fm-bxwv): classic's Bulma 0.9 imports resolve to the port's shims in shell/style/, so src/style.scss
// keeps its bytes. bulma-prefers-dark was a Bulma 0.9 add-on; Bulma 1 has the dark scheme built in.
const SHIMS: Record<string, string> = {
  '~bulma/bulma': 'shell/style/bulma.scss',
  '~bulma-prefers-dark/bulma-prefers-dark': 'shell/style/bulma-prefers-dark.scss',
};
const tildeImporter = {
  findFileUrl(url: string): URL | null {
    const shim = SHIMS[url];
    if (shim) return new URL(shim, import.meta.url);
    if (!url.startsWith('~')) return null;
    const [scopeOrName = '', ...rest] = url.slice(1).split('/');
    const name = scopeOrName.startsWith('@') ? `${scopeOrName}/${rest.shift() ?? ''}` : scopeOrName;
    const base = new URL(
      rest.join('/'),
      pathToFileURL(dirname(require.resolve(`${name}/package.json`)) + '/'),
    );
    for (const candidate of ['', '.scss', '.sass', '.css']) {
      const path = fileURLToPath(base) + candidate;
      if (existsSync(path) && !path.endsWith('/')) return pathToFileURL(path);
    }
    return base;
  },
};

// Each worker build reports its entry chunk; the app build then writes dist/worker-inventory.json with the
// emitted workers beside the hosted (manifest-pinned) ones, both hashed into one identity.
const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = runtimeIdentity(fileURLToPath(new URL('../../', import.meta.url)));
const emitted: EmittedWorker[] = [];
const collectWorker = (): Plugin => ({
  name: 'facemorph-collect-worker',
  generateBundle(_options, bundle) {
    emitted.push(
      ...emittedFromBundle(
        root,
        Object.values(bundle).flatMap((o) => (o.type === 'chunk' && o.isEntry ? [o] : [])),
      ),
    );
  },
});
const writeInventory = (): Plugin => ({
  name: 'facemorph-worker-inventory',
  apply: 'build',
  writeBundle({ dir }) {
    writeFileSync(
      `${dir}/worker-inventory.json`,
      JSON.stringify(workerInventory(emitted, runtime.hosted), null, 1) + '\n',
    );
  },
});

export default defineConfig({
  root,
  publicDir: 'src/public',
  plugins: [react(), svgr({ include: '**/*.svg?react' }), writeInventory()],
  // Sass leaves `@import "~pkg/x.css"` as a CSS import; the CSS layer resolves the same `~` convention.
  resolve: { alias: [{ find: /^~(.+)/, replacement: '$1' }] },
  define: {
    'import.meta.env.FACEMORPH_RUNTIME_SHA256': JSON.stringify(runtime.runtimeSha256),
    'import.meta.env.FACEMORPH_MODEL_SHA256': JSON.stringify(runtime.modelSha256),
    // The shell's version line, as classic's build passes FACEMORPH_SOURCE_SHA (commit, '-dirty' when dirty).
    'import.meta.env.FACEMORPH_SOURCE_SHA': JSON.stringify(
      process.env['FACEMORPH_SOURCE_SHA'] ?? 'unknown',
    ),
    // A test build only (fm-5yqq): lets the changeover statistics run under automation. Never set for a release.
    'import.meta.env.FACEMORPH_STATS_ALLOW_AUTOMATION': JSON.stringify(
      process.env['FACEMORPH_STATS_ALLOW_AUTOMATION'] === '1' ? '1' : '',
    ),
    // A test build only (fm-szbf): lets product analytics load under automation. Never set for a release.
    'import.meta.env.FACEMORPH_ANALYTICS_ALLOW_AUTOMATION': JSON.stringify(
      process.env['FACEMORPH_ANALYTICS_ALLOW_AUTOMATION'] === '1' ? '1' : '',
    ),
  },
  css: {
    preprocessorOptions: {
      scss: {
        importers: [tildeImporter],
        silenceDeprecations: [
          'import',
          'global-builtin',
          'color-functions',
          'slash-div',
          'if-function',
        ],
      },
    },
  },
  build: {
    target: [...targets.build],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    manifest: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'worker-check': fileURLToPath(new URL('./worker-check.html', import.meta.url)),
        'render-check': fileURLToPath(new URL('./render-check.html', import.meta.url)),
        'preflight-check': fileURLToPath(new URL('./preflight-check.html', import.meta.url)),
      },
    },
  },
  worker: { format: targets.workerFormat, plugins: () => [collectWorker()] },
});
