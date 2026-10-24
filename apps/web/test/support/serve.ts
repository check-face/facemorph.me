// A real local HTTP server over a built site directory (the control's deploy-next/ or this build's dist/).
// /runtime/ answers 404: the shell needs no model bytes, and nothing may reach the hosted runtime from a test.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.map': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};

export interface Served { readonly origin: string; readonly requests: string[]; close(): Promise<void> }

export async function serve(dir: string): Promise<Served> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    requests.push(path);
    const file = normalize(join(dir, path.endsWith('/') ? `${path}index.html` : path));
    if (path.startsWith('/runtime/') || !file.startsWith(normalize(dir)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { origin: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
