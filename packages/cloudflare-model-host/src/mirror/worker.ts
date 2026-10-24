// The mirror Worker (fm-fy2.14): a second copy of an upstream site's immutable, content-addressed runtime files,
// held in an R2 bucket and served with CORS and CORP so another origin's page can fetch them. Ported from classic
// hosting/next-mirror/worker.mjs (see ../../mirror/provenance.json): the upstream origin and the mirrored prefixes are
// configuration, so the Worker names no host of its own. On 20 October one Cloudflare edge answered HTTP 500 from
// static-asset storage for single encoder chunks for ten minutes at a time; a page retries such a file here, on
// separate storage.
//
// A file not yet held is copied from the upstream on first request (a deploy warms every runtime path with HEAD), and
// only under the configured prefixes: those paths are immutable and the page checks every byte against its pin, so a
// stale or wrong copy can only fail. Anything else is refused without a fetch.
//
// Configuration (Worker vars and bindings):
//   UPSTREAM  the origin copied from, e.g. https://example.org/ (required; a trailing slash is added if missing)
//   PREFIXES  comma-separated immutable path prefixes, e.g. runtime/chunks/,runtime/assets/ (required)
//   MIRROR    the R2 bucket binding
//   SITE      optional service binding to the upstream Worker; fetches go through it when bound

/** The R2 object fields the Worker reads (a subset of the Workers runtime's R2Object). */
export interface HeldObject {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}
export interface HeldObjectBody extends HeldObject {
  body: ReadableStream;
}
/** The R2 bucket methods the Worker calls. */
export interface MirrorBucket {
  head(key: string): Promise<HeldObject | null>;
  get(key: string): Promise<HeldObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<HeldObject>;
}
export interface MirrorEnv {
  UPSTREAM?: string;
  PREFIXES?: string;
  MIRROR: MirrorBucket;
  SITE?: { fetch(request: Request): Promise<Response> };
}

const SHARED = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';

const empty = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { ...SHARED, 'Cache-Control': 'no-store', ...extra } });

function reply(object: HeldObject, body: BodyInit | null): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...SHARED,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      ETag: object.httpEtag,
      'Cache-Control': IMMUTABLE,
    },
  });
}

/** The configured prefixes; an empty or missing list mirrors nothing. Pure. */
export function prefixes(config: string | undefined): string[] {
  return (config ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.endsWith('/') ? p : `${p}/`));
}

/** Whether `key` is a mirrored path: under a configured prefix, with no empty or `..` segment. Pure. */
export function mirrored(key: string, allowed: readonly string[]): boolean {
  return (
    allowed.some((prefix) => key.startsWith(prefix)) &&
    !key.split('/').some((part) => part === '..' || part === '')
  );
}

export default {
  async fetch(request: Request, env: MirrorEnv): Promise<Response> {
    if (request.method === 'OPTIONS')
      return empty(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Max-Age': '86400',
      });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return empty(405, { Allow: 'GET, HEAD' });
    const upstream = env.UPSTREAM?.trim();
    if (!upstream) return empty(503);
    let key: string;
    try {
      key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    } catch {
      return empty(404);
    }
    if (!mirrored(key, prefixes(env.PREFIXES))) return empty(404);
    const head = request.method === 'HEAD';
    const held = head ? await env.MIRROR.head(key) : await env.MIRROR.get(key);
    if (held) return reply(held, head ? null : (held as HeldObjectBody).body);
    const base = new URL(upstream.endsWith('/') ? upstream : `${upstream}/`);
    const url = new URL(key, base);
    // The configured upstream is the only origin fetched.
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return empty(404);
    const source = new Request(url);
    const origin = await (env.SITE ? env.SITE.fetch(source) : fetch(source));
    if (origin.status !== 200) {
      void origin.body?.cancel();
      return empty(origin.status === 404 ? 404 : 502);
    }
    // Runtime files are at most 25 MiB (the static-asset limit), so buffering one is cheap.
    const bytes = await origin.arrayBuffer();
    const saved = await env.MIRROR.put(key, bytes, {
      httpMetadata: {
        contentType: origin.headers.get('Content-Type') || 'application/octet-stream',
      },
    });
    return reply(saved, head ? null : bytes);
  },
};
