// Staging (fm-3osh), from classic hosting/next/prepare-runtime.py's publish/rewrite core: every asset a
// manifest names is checked against its declared digest and size, copied to the same relative path under the
// output root (or cut into chunks when it exceeds the static file limit), and the manifest is rewritten to
// hosted URLs under `base`. Application policy (phone admission, promotion, the photo sub-bundle) stays in the
// app's hosting. Nothing private is copied: the source inventory and any local path stay behind.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import {
  fileDigest,
  freeze,
  needsChunks,
  reconstruct,
  writeChunks,
  type ChunkDescriptor,
} from './chunks.ts';
import { assets, checkContract, provenanceFindings, type AssetNode } from './manifest.ts';

export interface StageOptions {
  /** Directory holding the manifest and the files it names. */
  readonly source: string;
  /** Manifest file name inside `source`. */
  readonly manifest?: string;
  /** Output root: `manifest.json`, the assets at their relative paths and `chunks/`. */
  readonly out: string;
  /** Hosted origin and prefix every published URL starts with, https only, no trailing slash needed. */
  readonly base: string;
  /**
   * For an already hosted manifest being restaged: the old URL prefix. A URL under it maps to the same relative
   * path inside `source`. Unpublished manifests name `file` paths instead and need no prefix.
   */
  readonly fromBase?: string;
  /** Report what would be written without writing anything. */
  readonly dryRun?: boolean;
}

export interface StagedFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface StageResult {
  readonly manifest: unknown;
  /** Every file the output root holds (or would hold) besides manifest.json, sorted by path. */
  readonly files: readonly StagedFile[];
  readonly assets: number;
  readonly chunked: number;
}

export type StageErrorCode =
  | 'not-https'
  | 'unsafe-path'
  | 'integrity'
  | 'unmapped-url'
  | 'contract'
  | 'private-provenance'
  | 'descriptor-conflict';

export class StageError extends Error {
  readonly code: StageErrorCode;
  constructor(code: StageErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const trim = (s: string) => s.replace(/\/+$/u, '');

/** Resolves a manifest-relative path inside `root`, refusing absolute paths and `..` escapes. */
export function inside(root: string, rel: string): string {
  const clean = normalize(rel);
  if (isAbsolute(rel) || clean === '..' || clean.startsWith(`..${sep}`) || rel.includes('\0'))
    throw new StageError('unsafe-path', `unsafe asset path: ${rel}`);
  const full = resolve(root, clean);
  if (relative(resolve(root), full).startsWith('..'))
    throw new StageError('unsafe-path', `unsafe asset path: ${rel}`);
  return full;
}

function relativeOf(asset: AssetNode, fromBase: string | undefined, where: string): string {
  if (typeof asset.file === 'string') return asset.file;
  if (fromBase && typeof asset.url === 'string' && asset.url.startsWith(`${trim(fromBase)}/`))
    return asset.url.slice(trim(fromBase).length + 1);
  throw new StageError(
    'unmapped-url',
    `${where}: ${asset.url ?? '(no url)'} is not under --from-base`,
  );
}

/** Stages a manifest's assets; see StageOptions. Throws StageError on the first refusal. */
export function stage(options: StageOptions): StageResult {
  const base = trim(options.base);
  if (!/^https:\/\/[^/@\s]+(\/\S*)?$/u.test(base))
    throw new StageError('not-https', `base must be an https origin: ${base}`);
  const source = resolve(options.source);
  const manifest = JSON.parse(
    readFileSync(join(source, options.manifest ?? 'manifest.json'), 'utf8'),
  ) as unknown;
  const unpublished = assets(manifest).some(({ asset }) => typeof asset.file === 'string');
  const before = checkContract(manifest, { unpublished });
  if (!before.ok)
    throw new StageError(
      'contract',
      `${before.error.code} at ${before.error.path}: ${before.error.message}`,
    );

  const files = new Map<string, StagedFile>();
  const published = new Map<string, { sha256: string; size: number; chunks?: ChunkDescriptor[] }>();
  let chunked = 0;
  const found = assets(manifest);
  for (const { path, asset } of found) {
    const rel = relativeOf(asset, options.fromBase, path).split('\\').join('/');
    const prior = published.get(rel);
    if (prior) {
      if (prior.sha256 !== asset.sha256 || prior.size !== asset.size)
        throw new StageError(
          'descriptor-conflict',
          `${path}: ${rel} is declared twice with different digests`,
        );
    } else {
      const src = inside(source, rel);
      if (!existsSync(src) && asset.chunks && needsChunks(asset.size)) {
        // A hosted tree keeps large assets only as chunks: verify them and the whole, then carry them over.
        const chunks = asset.chunks.map((c, i) => ({
          path: relativeOf(c as AssetNode, options.fromBase, `${path}.chunks[${i}]`),
          sha256: c.sha256,
          size: c.size,
        }));
        const whole = reconstruct(chunks, source);
        if (whole.problems.length || whole.sha256 !== asset.sha256 || whole.size !== asset.size)
          throw new StageError(
            'integrity',
            `${path}: the chunks of ${rel} do not reconstruct its declared digest`,
          );
        for (const c of chunks) {
          if (!options.dryRun)
            freeze(inside(options.out, c.path), readFileSync(inside(source, c.path)));
          files.set(c.path, { path: c.path, sha256: c.sha256, bytes: c.size });
        }
        published.set(rel, { sha256: asset.sha256, size: asset.size, chunks });
        chunked++;
        const entry = published.get(rel)!;
        delete asset.file;
        asset.url = `${base}/${rel}`;
        asset.chunks = entry.chunks!.map((c) => ({
          url: `${base}/${c.path}`,
          size: c.size,
          sha256: c.sha256,
        }));
        continue;
      }
      const got = existsSync(src) ? fileDigest(src) : undefined;
      if (!got || got.sha256 !== asset.sha256 || got.size !== asset.size)
        throw new StageError(
          'integrity',
          `${path}: ${rel} does not match its declared digest and size`,
        );
      if (needsChunks(asset.size)) {
        const chunks = writeChunks(src, options.out, { dryRun: options.dryRun === true });
        for (const c of chunks)
          files.set(c.path, { path: c.path, sha256: c.sha256, bytes: c.size });
        published.set(rel, { sha256: asset.sha256, size: asset.size, chunks });
        chunked++;
      } else {
        if (!options.dryRun) {
          const dest = inside(options.out, rel);
          if (existsSync(dest)) {
            const have = fileDigest(dest);
            if (have.sha256 !== asset.sha256 || have.size !== asset.size)
              throw new Error(`Immutable destination changed: ${rel}`);
          } else {
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
          }
        }
        files.set(rel, { path: rel, sha256: asset.sha256, bytes: asset.size });
        published.set(rel, { sha256: asset.sha256, size: asset.size });
      }
    }
    const entry = published.get(rel)!;
    delete asset.file;
    asset.url = `${base}/${rel}`;
    if (entry.chunks)
      asset.chunks = entry.chunks.map((c) => ({
        url: `${base}/${c.path}`,
        size: c.size,
        sha256: c.sha256,
      }));
    else delete asset.chunks;
  }
  // Strings elsewhere that still point at the old prefix (wasmPaths, asset bases) move with the assets.
  const rewritten = rebase(manifest, options.fromBase ? trim(options.fromBase) : undefined, base);

  const after = checkContract(rewritten);
  if (!after.ok)
    throw new StageError('contract', `staged manifest: ${after.error.code} at ${after.error.path}`);
  const leaks = provenanceFindings(rewritten);
  if (leaks.length)
    throw new StageError(
      'private-provenance',
      `staged manifest leaks ${leaks.map((l) => `${l.rule} at ${l.path}`).join(', ')}`,
    );
  if (!options.dryRun)
    freeze(
      join(options.out, 'manifest.json'),
      new TextEncoder().encode(`${JSON.stringify(rewritten, null, 2)}\n`),
    );
  return {
    manifest: rewritten,
    files: [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    assets: found.length,
    chunked,
  };
}

function rebase(v: unknown, from: string | undefined, to: string): unknown {
  if (typeof v === 'string')
    return from && (v === from || v.startsWith(`${from}/`)) ? to + v.slice(from.length) : v;
  if (Array.isArray(v)) return v.map((x) => rebase(x, from, to));
  if (typeof v === 'object' && v !== null)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rebase(x, from, to)]));
  return v;
}
