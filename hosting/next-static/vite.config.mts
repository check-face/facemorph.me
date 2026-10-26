// cf builds the site's cf project (cloudflare.config.ts) through the Cloudflare Vite plugin (fm-6fx6). The staged
// public/ tree is hard-linked into the build's assets directory by scripts/hosting/deploy.mjs site-deploy afterwards,
// so a deploy never copies the gigabytes of runtime.
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  plugins: [cloudflare()],
});
