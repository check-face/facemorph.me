// The two worker graphs of a build, inventoried separately and both hashed into one identity (fm-svg):
// - emitted: the app workers Vite bundles from source (their bytes change with the source and the bundler);
// - hosted: the workers and modules the runtime manifest pins and the app loads by URL at runtime
//   (import/build-inputs.json worker_graphs.pinned), whose bytes never come from this build.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EmittedWorker {
  readonly source: string;
  readonly file: string;
  readonly sha256: string;
}
export interface HostedWorker {
  readonly path: string;
  readonly sha256: string;
}
export interface WorkerInventory {
  readonly emitted: readonly EmittedWorker[];
  readonly hosted: readonly HostedWorker[];
  /** sha256 over both lists, one line per entry, emitted first, each list sorted. */
  readonly identity: string;
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

export function workerInventory(
  emitted: readonly EmittedWorker[],
  hosted: readonly HostedWorker[],
): WorkerInventory {
  const e = [...emitted].sort((a, b) => (a.source < b.source ? -1 : 1));
  const h = [...hosted].sort((a, b) => (a.path < b.path ? -1 : 1));
  const lines = [
    ...e.map((w) => `emitted ${w.source} ${w.file} ${w.sha256}`),
    ...h.map((w) => `hosted ${w.path} ${w.sha256}`),
  ];
  return { emitted: e, hosted: h, identity: sha256(lines.join('\n') + '\n') };
}

/** The hosted (manifest-pinned) workers and modules from import/build-inputs.json. */
export function hostedWorkers(buildInputs: {
  worker_graphs: { pinned: readonly { path: string; sha256: string }[] };
}): HostedWorker[] {
  return buildInputs.worker_graphs.pinned.map(({ path, sha256: digest }) => ({
    path,
    sha256: digest,
  }));
}

/** Differences between a recorded inventory and the built files: every emitted file must hash as recorded and
 * the identity must follow from the lists. */
export function inventoryFindings(inventory: WorkerInventory, dist: string): string[] {
  const out: string[] = [];
  for (const w of inventory.emitted) {
    let actual: string | null = null;
    try {
      actual = sha256(readFileSync(join(dist, w.file)));
    } catch {
      /* missing */
    }
    if (actual !== w.sha256)
      out.push(`${w.source}: ${w.file} hashes ${actual ?? 'missing'}, inventory says ${w.sha256}`);
  }
  const again = workerInventory(inventory.emitted, inventory.hosted).identity;
  if (again !== inventory.identity)
    out.push(`identity ${inventory.identity} does not follow from the lists (${again})`);
  return out;
}

/** Hashes emitted worker chunks as Vite writes them: `facadeModuleId` (an absolute source path) to file. */
export function emittedFromBundle(
  root: string,
  chunks: readonly { facadeModuleId: string | null; fileName: string; code: string }[],
): EmittedWorker[] {
  return chunks
    .filter((c): c is typeof c & { facadeModuleId: string } => c.facadeModuleId !== null)
    .map((c) => ({
      source: c.facadeModuleId.startsWith(root)
        ? c.facadeModuleId.slice(root.length).replace(/^\//, '')
        : c.facadeModuleId,
      file: c.fileName,
      sha256: sha256(c.code),
    }));
}
