// A real local HTTP server over a built site directory (the control's deploy-next/ or this build's dist/).
// /runtime/ answers 404: the shell needs no model bytes, and nothing may reach the hosted runtime from a test.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { headersFor } from '../../../../scripts/hosting/headers.mjs';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

export interface Served {
  readonly origin: string;
  readonly requests: string[];
  close(): Promise<void>;
}

/** `mounts` serves further directories under URL prefixes, e.g. { '/fixtures/': dir }. */
export async function serve(dir: string, mounts: Record<string, string> = {}): Promise<Served> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    requests.push(path);
    const mount = Object.keys(mounts).find((prefix) => path.startsWith(prefix));
    const base = mount ? (mounts[mount] as string) : dir;
    const rel = mount ? path.slice(mount.length) : path;
    let file = normalize(join(base, rel.endsWith('/') || rel === '' ? `${rel}index.html` : rel));
    // The staged site's SPA fallback; missing file assets still fail as missing assets.
    if (!mount && !existsSync(file) && !extname(path) && req.headers.accept?.includes('text/html'))
      file = join(dir, 'index.html');
    if (
      (path.startsWith('/runtime/') && !mount) ||
      !(file === normalize(base) || file.startsWith(normalize(base) + '/')) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    // Content-Length, as a static host sends it: the interception helper counts bytes from it.
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': String(statSync(file).size),
      ...headersFor(path),
    });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    // A page still holding a connection open (keep-alive, a request in flight) would hold close() until it times
    // out; the run is over, so drop them.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
