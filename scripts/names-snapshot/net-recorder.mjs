// Records every outbound TCP connection of the process it is preloaded into (`node --import
// ./net-recorder.mjs`), for request interception by host class and bytes (bead fm-old). Observation only:
// the connection itself is unchanged. Each connection is appended to $NET_RECORD as one JSON line
// { host, port, bytesWritten, bytesRead } when it closes, or at process exit if still open.
// HTTP, HTTPS, fetch and the S3 SDK all connect through net.Socket.prototype.connect.
import net from 'node:net';
import { appendFileSync } from 'node:fs';

// Hosts the snapshot exists to stop depending on.
export const RETIRED_HOSTS = ['api.facemorph.me', 'checkface.facemorph.me'];
export const SOURCE_HOSTS = ['facemorph-seed-gallery.cdilga.workers.dev', 'facemorph-name-catalogue.cdilga.workers.dev'];

// Host class of one connection { host, port }: a retired API host, a source Worker, the store, or other.
// `store` and `sources` entries are a host (any port) or host:port.
export function classify({ host, port }, { store, sources = [] } = {}) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  const is = (entry) => entry === h || entry === `${h}:${port}`;
  if (RETIRED_HOSTS.some((r) => h === r || h.endsWith(`.${r}`))) return 'retired-api';
  if ([...SOURCE_HOSTS, ...sources].some(is)) return 'source-worker';
  if (store && is(store)) return 'store';
  return 'other';
}

export function tally(connections, classOf) {
  const out = { store: { connections: 0, bytes: 0 }, 'retired-api': { connections: 0, bytes: 0 }, 'source-worker': { connections: 0, bytes: 0 }, other: { connections: 0, bytes: 0 } };
  for (const c of connections) {
    const t = out[classOf(c)];
    t.connections++;
    t.bytes += c.bytesWritten + c.bytesRead;
  }
  return out;
}

const file = process.env.NET_RECORD;
if (file) {
  const open = new Set();
  const write = (s) => {
    if (!open.delete(s)) return;
    appendFileSync(file, `${JSON.stringify({ host: s.__fmHost, port: s.__fmPort, bytesWritten: s.bytesWritten ?? 0, bytesRead: s.bytesRead ?? 0 })}\n`);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const o = args[0] !== null && typeof args[0] === 'object' ? (Array.isArray(args[0]) ? args[0][0] : args[0]) : { port: args[0], host: args[1] };
    if (!o.path && !this.__fmHost) {
      this.__fmHost = o.servername || o.host || 'localhost';
      this.__fmPort = Number(o.port);
      open.add(this);
      this.once('close', () => write(this));
    }
    return connect.apply(this, args);
  };
  process.on('exit', () => {
    for (const s of Array.from(open)) write(s); // a copy: write() deletes from the set
  });
}
