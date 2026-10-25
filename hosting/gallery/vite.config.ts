import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
const root = process.env['CATALOGUE_PUBLIC'];
if (!root) throw Error('Use scripts/names-publish/publish.mjs with a validated catalogue tree');
export default defineConfig({ publicDir: root, plugins: [cloudflare()] });
