// Chunking and reconstruction (fm-3osh), from classic hosting/next/prepare-runtime.py: an input above the static
// file limit is cut into CHUNK_BYTES pieces named by their own SHA-256 (chunks/<sha>.bin), written once and
// never changed; reconstruction reads them in order and must reproduce the asset's declared digest and size.
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { CHUNK_BYTES, STATIC_ASSET_FILE_LIMIT_BYTES } from './limits.ts';

export interface ChunkDescriptor {
  /** Path of the chunk relative to the published root, `chunks/<sha256>.bin`. */
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** A file's digest and size, read in CHUNK_BYTES pieces so a gigabyte input never sits in memory at once. */
export function fileDigest(path: string): { readonly sha256: string; readonly size: number } {
  const hash = createHash('sha256');
  let size = 0;
  forEachPiece(path, CHUNK_BYTES, (piece) => {
    hash.update(piece);
    size += piece.length;
  });
  return { sha256: hash.digest('hex'), size };
}

/** Whether an input of this size is published as chunks. */
export const needsChunks = (size: number): boolean => size > STATIC_ASSET_FILE_LIMIT_BYTES;

/** The chunk sizes for an input: full CHUNK_BYTES pieces, then the remainder. */
export function chunkSizes(size: number, chunkBytes: number = CHUNK_BYTES): number[] {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError(`invalid size ${size}`);
  const out: number[] = [];
  for (let at = 0; at < size; at += chunkBytes) out.push(Math.min(chunkBytes, size - at));
  return out;
}

/**
 * Cuts `source` into chunks under `root`, freezing each one: an existing chunk must hold the same bytes, or this
 * throws (`Immutable destination changed`). Returns the chunk descriptors in order. Writes nothing when `dryRun`.
 */
export function writeChunks(
  source: string,
  root: string,
  options: { readonly dryRun?: boolean } = {},
): ChunkDescriptor[] {
  const out: ChunkDescriptor[] = [];
  forEachPiece(source, CHUNK_BYTES, (piece) => {
    const sha256 = sha256Hex(piece);
    const path = `chunks/${sha256}.bin`;
    if (!options.dryRun) freeze(join(root, path), piece);
    out.push({ path, sha256, size: piece.length });
  });
  return out;
}

export interface Reconstruction {
  readonly sha256: string;
  readonly size: number;
  readonly problems: readonly { readonly path: string; readonly problem: string }[];
}

/** Reads the chunks in order from `root`, checking each against its own digest, and digests the whole. */
export function reconstruct(chunks: readonly ChunkDescriptor[], root: string): Reconstruction {
  const hash = createHash('sha256');
  const problems: { path: string; problem: string }[] = [];
  let size = 0;
  for (const c of chunks) {
    const path = join(root, c.path);
    if (!existsSync(path)) {
      problems.push({ path: c.path, problem: 'missing' });
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== c.size || sha256Hex(bytes) !== c.sha256)
      problems.push({ path: c.path, problem: 'chunk digest differs' });
    hash.update(bytes);
    size += bytes.length;
  }
  return { sha256: hash.digest('hex'), size, problems };
}

/** Writes `bytes` at `path` once; a later write must be byte-identical. */
export function freeze(path: string, bytes: Uint8Array): void {
  if (existsSync(path)) {
    const have = readFileSync(path);
    if (have.length !== bytes.length || !have.equals(bytes))
      throw new Error(`Immutable destination changed: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: 'wx' });
}

function forEachPiece(path: string, pieceBytes: number, each: (piece: Buffer) => void): void {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(pieceBytes);
    for (;;) {
      let filled = 0;
      while (filled < pieceBytes) {
        const n = readSync(fd, buffer, filled, pieceBytes - filled, null);
        if (n === 0) break;
        filled += n;
      }
      if (filled === 0) break;
      each(Buffer.from(buffer.subarray(0, filled)));
      if (filled < pieceBytes) break;
    }
  } finally {
    closeSync(fd);
  }
}
