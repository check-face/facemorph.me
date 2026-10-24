// Serving headers for a staged model root (fm-fy2.14). A page with Cross-Origin-Embedder-Policy: require-corp can
// load model files from this origin or another only when each answers with CORS and Cross-Origin-Resource-Policy;
// immutable, content-addressed files are cached for a year, and the mutable manifest pointer is revalidated every
// time. Workers Static Assets applies a `_headers` file at the root without running any Worker code, so serving a
// model file never invokes a Worker. The rules are classic hosting/next-static/stage.py's runtime rules, plus a
// Content-Type for each extension the asset upload leaves untyped: on 25 October the staging origin served .f32,
// .i32 and .onnx files with no Content-Type at all.

/** What a staged root serves, relative to its base path. */
export interface HeaderPlan {
  /** The URL path the root is served under, e.g. /runtime/ (default /). */
  readonly basePath?: string;
  /** Immutable, content-addressed prefixes, e.g. assets/, chunks/. */
  readonly immutable: readonly string[];
  /** Mutable files revalidated on every use, e.g. manifest.json. */
  readonly mutable: readonly string[];
  /** The file extensions the root holds (without the dot); those the upload does not type get one. */
  readonly extensions?: readonly string[];
}

/** Content types by extension; the upload attaches these itself (seen on the staging origin, 25 October). */
const TYPES: Readonly<Record<string, string>> = {
  json: 'application/json',
  js: 'text/javascript',
  mjs: 'text/javascript',
  wasm: 'application/wasm',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  bin: 'application/octet-stream',
};
const extensionOf = (path: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const MUTABLE_CACHE = 'no-cache';

const base = (plan: HeaderPlan) => {
  const b = plan.basePath ?? '/';
  return `${b.startsWith('/') ? '' : '/'}${b}${b.endsWith('/') ? '' : '/'}`;
};

/** The `_headers` file for a staged root. Pure. */
export function modelHeaders(plan: HeaderPlan): string {
  const b = base(plan);
  const lines = [
    `${b}*`,
    '  Access-Control-Allow-Origin: *',
    '  Cross-Origin-Resource-Policy: cross-origin',
    '  X-Content-Type-Options: nosniff',
  ];
  for (const prefix of plan.immutable)
    lines.push(`${b}${prefix.replace(/\/?$/, '/')}*`, `  Cache-Control: ${IMMUTABLE_CACHE}`);
  for (const file of plan.mutable) lines.push(`${b}${file}`, `  Cache-Control: ${MUTABLE_CACHE}`);
  for (const ext of [...new Set(plan.extensions ?? [])].sort())
    if (!TYPES[ext.toLowerCase()])
      lines.push(`${b}*.${ext}`, '  Content-Type: application/octet-stream');
  return `${lines.join('\n')}\n`;
}

/** The Content-Type a model file must be served with, by extension (application/octet-stream when unknown). */
export function expectedType(path: string): string {
  return TYPES[extensionOf(path) ?? ''] ?? 'application/octet-stream';
}

/** The extensions of `paths`, for HeaderPlan.extensions. Pure. */
export function extensionsOf(paths: readonly string[]): string[] {
  return [...new Set(paths.map(extensionOf).filter((e): e is string => Boolean(e)))].sort();
}

export interface HeaderFinding {
  readonly path: string;
  readonly header: string;
  readonly expected: string;
  readonly actual: string | null;
}

/** Every required header `headers` lacks for `path` under `plan`. Pure. */
export function judgeHeaders(
  plan: HeaderPlan,
  path: string,
  status: number,
  headers: { get(name: string): string | null },
): HeaderFinding[] {
  const rel = path.slice(base(plan).length);
  const cache = plan.mutable.includes(rel)
    ? MUTABLE_CACHE
    : plan.immutable.some((p) => rel.startsWith(p.replace(/\/?$/, '/')))
      ? IMMUTABLE_CACHE
      : null;
  const want: [string, string, (v: string) => boolean][] = [
    ['status', '200', () => status === 200],
    ['access-control-allow-origin', '*', (v) => v === '*'],
    ['cross-origin-resource-policy', 'cross-origin', (v) => v === 'cross-origin'],
    ['x-content-type-options', 'nosniff', (v) => v === 'nosniff'],
    [
      'content-type',
      expectedType(path),
      (v) => v.split(';')[0]!.trim().toLowerCase() === expectedType(path),
    ],
  ];
  if (cache) want.push(['cache-control', cache, (v) => v === cache]);
  const out: HeaderFinding[] = [];
  for (const [header, expected, ok] of want) {
    const actual = header === 'status' ? String(status) : headers.get(header);
    if (actual === null || !ok(actual)) out.push({ path, header, expected, actual });
  }
  return out;
}

/** Fetches each path from `origin` (GET, body discarded) and judges its headers. */
export async function checkHeaders(
  origin: string,
  plan: HeaderPlan,
  paths: readonly string[],
): Promise<{ readonly checked: number; readonly findings: readonly HeaderFinding[] }> {
  const findings: HeaderFinding[] = [];
  for (const path of paths) {
    const r = await fetch(new URL(path, origin));
    void r.body?.cancel().catch(() => {});
    findings.push(...judgeHeaders(plan, path, r.status, r.headers));
  }
  return { checked: paths.length, findings };
}
