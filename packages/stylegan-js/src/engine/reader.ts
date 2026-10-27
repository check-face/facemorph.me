// The engine's only way to bytes (fm-3h3w): the manager's verified local reader, structurally (the manager
// depends on this package, not the reverse). It reads exact-length bytes whose SHA-256 matched on this
// read, from local storage only; a miss or a corrupt unit is a typed error, never a fetch or a repair.

/** An asset as the runtime manifest describes it; the engine reads only `sha256` and `size`. */
export interface EngineAsset {
  readonly sha256: string;
  readonly size: number;
  readonly url?: string;
  readonly file?: string;
  readonly chunks?: readonly {
    readonly sha256: string;
    readonly size: number;
    readonly url?: string;
  }[];
}

export interface LocalReadError {
  readonly code: string;
  readonly message: string;
  readonly sha256?: string;
}

export interface LocalAssetReader {
  readonly allowRepair: false;
  /** Runs heavyweight work separately from local reads/acquisition when the host supplies a gate. */
  compute?<T>(work: () => T | Promise<T>): Promise<T>;
  read(
    asset: EngineAsset,
  ): Promise<
    | { readonly ok: true; readonly value: Uint8Array }
    | { readonly ok: false; readonly error: LocalReadError }
  >;
}

/** Raised by an adapter when the reader refuses an asset; `error` is the reader's typed error. */
export class LocalAssetUnavailable extends Error {
  readonly error: LocalReadError;
  constructor(error: LocalReadError) {
    super(error.message);
    this.name = 'LocalAssetUnavailable';
    this.error = error;
  }
}

/** Reads one asset or throws LocalAssetUnavailable. */
export async function readLocal(reader: LocalAssetReader, asset: EngineAsset): Promise<Uint8Array> {
  const r = await reader.read(asset);
  if (!r.ok) throw new LocalAssetUnavailable(r.error);
  return r.value;
}

/** Runs compute under the host's optional permit; callbacks must not read from the reader. */
export async function runCompute<T>(
  reader: LocalAssetReader,
  work: () => T | Promise<T>,
): Promise<T> {
  return reader.compute ? reader.compute(work) : work();
}

/** A little-endian float32 view of verified bytes (copied when unaligned). */
export function floats(bytes: Uint8Array): Float32Array {
  if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0)
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (bytes.byteLength % 4) throw Error('Float asset length is not a multiple of 4');
  return new Float32Array(bytes.slice().buffer);
}
