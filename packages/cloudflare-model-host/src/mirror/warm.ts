// Warming a mirror (fm-fy2.14), with classic's semantics: every immutable path of a staged root under the mirrored
// prefixes is requested with HEAD from the mirror origin, 8 at a time, each retried up to 3 times on a network error
// or a transient status (408, 429, 5xx), and the run fails on any final non-200, naming each path. A mirror copies a
// file it does not hold on HEAD, so a HEAD is a write: without `publish` nothing is requested and the plan lists the
// paths. Classic: curl -s -o /dev/null -I --retry 3 --retry-all-errors in xargs -P 8.
import { listFiles } from '../verify.ts';
import { mirrored, prefixes } from './worker.ts';

export interface WarmOptions {
  /** The staged root whose files are the runtime paths. */
  readonly root: string;
  /** The mirror origin, e.g. https://mirror.example.org/ */
  readonly origin: string;
  /** Comma-separated mirrored prefixes (the Worker's PREFIXES). */
  readonly prefixes: string;
  readonly publish?: boolean;
  readonly parallel?: number;
  readonly retries?: number;
}

export interface WarmReport {
  readonly origin: string;
  readonly published: boolean;
  /** Immutable paths under the prefixes. */
  readonly paths: number;
  /** Paths the mirror answered 200 for (0 when not published). */
  readonly held: number;
  readonly failed: readonly { readonly path: string; readonly status: number | string }[];
  readonly requests: number;
}

const TRANSIENT = new Set([408, 429]);
const transient = (status: number) => TRANSIENT.has(status) || status >= 500;

/** The staged root's paths a warm requests. Reads only. */
export function warmPaths(root: string, config: string): string[] {
  const allowed = prefixes(config);
  return listFiles(root)
    .map((f) => f.path)
    .filter((p) => mirrored(p, allowed));
}

export async function warm(options: WarmOptions): Promise<WarmReport> {
  const paths = warmPaths(options.root, options.prefixes);
  const base = new URL(options.origin.endsWith('/') ? options.origin : `${options.origin}/`);
  if (!options.publish)
    return {
      origin: base.href,
      published: false,
      paths: paths.length,
      held: 0,
      failed: [],
      requests: 0,
    };
  const retries = options.retries ?? 3;
  let requests = 0;
  const failed: { path: string; status: number | string }[] = [];
  let held = 0;
  const one = async (path: string): Promise<void> => {
    let last: number | string = 'no answer';
    for (let attempt = 0; attempt <= retries; attempt++) {
      requests++;
      try {
        const r = await fetch(new URL(path.split('/').map(encodeURIComponent).join('/'), base), {
          method: 'HEAD',
        });
        last = r.status;
        if (r.status === 200) return void held++;
        if (!transient(r.status)) break;
      } catch (e) {
        last = (e as Error).message;
      }
    }
    failed.push({ path, status: last });
  };
  const queue = [...paths];
  const workers = Array.from(
    { length: Math.min(options.parallel ?? 8, queue.length) },
    async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) await one(path);
    },
  );
  await Promise.all(workers);
  failed.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { origin: base.href, published: true, paths: paths.length, held, failed, requests };
}
