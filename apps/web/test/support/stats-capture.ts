// A real local HTTPS server standing in front of the app at https://next.facemorph.me for the changeover statistics
// tests (fm-5yqq). It records every request to /stats/v1, with the headers the Worker checks, and answers 204 as
// the Worker does; everything else is proxied to the app server (or answered from `files`). A page-hide beacon is
// sent by the browser after the document is gone, where page interception cannot see it, so only a server can.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpsRequest, createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Captured {
  step: string;
  method: string;
  path: string;
  origin: string | undefined;
  fetchSite: string | undefined;
  contentType: string | undefined;
  at: number;
  bytes: number;
  body: { v: number; app?: string; events: Record<string, unknown>[] };
}

export interface Capture {
  readonly port: number;
  readonly beacons: Captured[];
  /** Label for what the test is doing; each beacon records the step it arrived in. */
  step: string;
  /** Chromium arguments sending the production host here. */
  readonly args: string[];
  stop(): Promise<void>;
}

export async function startCapture({
  host,
  upstream,
  files = {},
}: {
  host: string;
  upstream?: number;
  files?: Record<string, { type: string; body: string }>;
}): Promise<Capture> {
  const dir = mkdtempSync(join(tmpdir(), 'stats-capture-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'k'),
      '-out',
      join(dir, 'c'),
      '-days',
      '1',
      '-subj',
      `/CN=${host}`,
    ],
    { stdio: 'ignore' },
  );
  const capture = { beacons: [] as Captured[], step: 'start' };
  const server = createServer(
    { key: readFileSync(join(dir, 'k')), cert: readFileSync(join(dir, 'c')) },
    (req, res) => {
      const path = new URL(req.url ?? '/', 'https://x').pathname;
      if (path === '/stats/v1') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: Captured['body'];
          try {
            body = JSON.parse(text);
          } catch {
            body = { v: 0, events: [] };
          }
          capture.beacons.push({
            step: capture.step,
            method: req.method ?? '',
            path,
            origin: req.headers.origin,
            fetchSite: req.headers['sec-fetch-site'] as string | undefined,
            contentType: req.headers['content-type'],
            at: Date.now(),
            bytes: Buffer.byteLength(text),
            body,
          });
          res.writeHead(204, { 'cache-control': 'no-store' }).end();
        });
        return;
      }
      const file = files[path];
      if (file) {
        res.writeHead(200, { 'content-type': file.type }).end(file.body);
        return;
      }
      if (upstream === undefined) {
        res.writeHead(404).end();
        return;
      }
      const forward = httpsRequest(
        {
          host: '127.0.0.1',
          port: upstream,
          method: req.method,
          path: req.url,
          headers: req.headers,
          servername: host,
          rejectUnauthorized: false,
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      forward.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(forward);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return Object.assign(capture, {
    port,
    args: [
      `--host-resolver-rules=MAP ${host}:443 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
    ],
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  });
}
