// cf builds the package's cf project (cloudflare.config.ts) through the Cloudflare Vite plugin (fm-fy2.14). In the
// model-origin mode the prepared public directory (the staged root at its base path, with `_headers`) is the assets.
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  publicDir: mode === 'model-origin' ? process.env['MODEL_ORIGIN_PUBLIC'] : false,
  plugins: [cloudflare()],
}));
