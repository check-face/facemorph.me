// cf builds the mirror Worker (cloudflare.config.ts) through the Cloudflare Vite plugin (fm-fy2.14).
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [cloudflare()] });
