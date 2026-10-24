// The artifact fixture for integrated verification (fm-48bj): every run targets one release artifact by digest.
// serveArtifact verifies a deploy-next/-shaped artifact against its next-site-identity.json (every file, nothing
// missing or extra: scripts/import/build-next.mjs readIdentity) and against the digest the run asked for, then
// serves it on a local static server. A digest mismatch aborts the run before a browser starts. The run tag carries
// the digest, so every step log names the bytes it judged.
//
// The digest is SHA-256 over the identity's deploy-next/ files as `sha256sum` lines (`<sha256>  <path>\n`, sorted
// by path), the same digest the goldens record as deploy_next_sha256. The deployed staging URL is a target once a
// staging deploy serves its identity; none does yet, so that path is untested.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { serve, type Served } from '../support/serve.ts';

interface Identity {
  readonly kind: string;
  readonly deploySource: { readonly repository: string; readonly commit: string };
  readonly files: IdentityFile[];
}

// build-next.mjs is untyped JS; this is its one function used here, with the shape it returns.
const { readIdentity } = (await import(
  new URL('../../../../scripts/import/build-next.mjs', import.meta.url).href
)) as { readIdentity(dir: string): { identity: Identity | null; findings: unknown[] } };

export interface IdentityFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface RunTag {
  readonly digest: string;
  readonly kind: string;
  readonly source: string;
}

/** The artifact digest over its deploy-next/ files. */
export function artifactDigest(files: readonly IdentityFile[]): string {
  const lines = files
    .filter((f) => f.path.startsWith('deploy-next/'))
    .map((f) => `${f.sha256}  ${f.path}\n`)
    .sort();
  return createHash('sha256').update(lines.join('')).digest('hex');
}

export class DigestMismatch extends Error {}

export interface ServedArtifact extends Served {
  readonly tag: RunTag;
}

/** Verifies the artifact at `root` (deploy-next/ beside next-site-identity.json) and serves it; aborts on any
 * finding or when its digest is not `expectDigest`. */
export async function serveArtifact(
  root: string,
  expectDigest: string,
  mounts: Record<string, string> = {},
): Promise<ServedArtifact> {
  const { identity, findings } = readIdentity(root);
  if (!identity || findings.length)
    throw new DigestMismatch(
      `the artifact at ${root} is not what its identity says: ${JSON.stringify(findings)}`,
    );
  const digest = artifactDigest(identity.files);
  if (digest !== expectDigest)
    throw new DigestMismatch(
      `artifact digest ${digest} is not the run's ${expectDigest}: run aborted`,
    );
  const served = await serve(join(root, 'deploy-next'), mounts);
  return {
    ...served,
    tag: {
      digest,
      kind: identity.kind,
      source: `${identity.deploySource.repository}@${identity.deploySource.commit}`,
    },
  };
}

export type HostClass = 'app' | 'model-host' | 'names-host' | 'collector' | 'third-party' | 'local';
/** origin -> host class. The default map is the request-interception helper's (build.ci-site); this module only
 * binds the run's actual origins on top of it. */
export type HostMap = Readonly<Record<string, HostClass>>;

/** The per-run override: the artifact's served origins (local server, staging or preview URL) bound to their
 * classes on top of the default map. No new class. */
export function bindOrigins(
  defaults: HostMap,
  bound: Partial<Record<HostClass, readonly string[]>>,
): HostMap {
  const out: Record<string, HostClass> = { ...defaults };
  for (const [cls, origins] of Object.entries(bound) as [HostClass, readonly string[]][])
    for (const o of origins) out[new URL(o).origin] = cls;
  return out;
}

/** A request URL's host class: data: and blob: are local, a mapped origin its class, anything else third-party. */
export function classOf(map: HostMap, url: string): HostClass {
  const u = new URL(url);
  if (u.protocol === 'data:' || u.protocol === 'blob:') return 'local';
  return map[u.origin] ?? 'third-party';
}
