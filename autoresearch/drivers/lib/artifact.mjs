// Artifact identity, run labels and durable run directories for the maintained research drivers (fm-qqh).
// An artifact is a deploy-next/-shaped directory named by the SHA-256 of its file listing (scripts/hosting/stage.mjs
// treeDigest: one "<sha256>  <path>\n" line per file, paths sorted). A driver verifies every artifact it was given
// against its digest before anything runs, and the default control is the pinned control artifact (control.json).
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestTree, treeDigest } from '../../../scripts/hosting/stage.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CONTROL = JSON.parse(
  readFileSync(join(REPO, 'autoresearch/drivers/control.json'), 'utf8'),
);
const DIGEST = /^[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9_-]{1,80}$/;

/** The artifact's identity: its tree digest, file count and bytes. */
export function artifactDigest(dir) {
  const files = digestTree(dir, [realpathSync(dir), realpathSync(REPO)]);
  return {
    treeSha256: treeDigest(files),
    files: files.length,
    bytes: files.reduce((s, f) => s + f.size, 0),
  };
}

/** Throws unless dir is a servable artifact whose bytes match expected. */
export function verifyArtifact(dir, expected) {
  if (!DIGEST.test(expected ?? ''))
    throw new Error(`artifact digest must be 64 lowercase hex characters, got ${expected}`);
  if (!existsSync(join(dir, 'index.html')))
    throw new Error(`${dir} has no index.html: not a deploy-next artifact`);
  const id = artifactDigest(dir);
  if (id.treeSha256 !== expected)
    throw new Error(
      `artifact ${dir} is ${id.treeSha256}, not the expected ${expected}: refused before the run`,
    );
  return { dir: resolve(dir), ...id };
}

/** A run label is a fresh simple name: letters, digits, '_' and '-'. Pure. */
export const labelProblem = (label) =>
  LABEL.test(label ?? '') ? null : `run label ${JSON.stringify(label)} is not [A-Za-z0-9_-]{1,80}`;

/** Where a machine keeps research outputs that outlive CI: the recipe names it. */
export const outRoot = (given) =>
  resolve(
    given ?? process.env.FACEMORPH_RESEARCH_RUNS ?? join(homedir(), 'Work/runs/facemorph-research'),
  );

/** Creates <root>/<label>/; a label that already has outputs is refused, so nothing is overwritten. */
export function freshRunDir(root, label) {
  const problem = labelProblem(label);
  if (problem) throw new Error(problem);
  mkdirSync(root, { recursive: true });
  const dir = join(root, label);
  try {
    mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `${dir} already exists: use a fresh run label (outputs are never overwritten)`,
      );
    throw error;
  }
  return dir;
}

/** The CPUs this process may run on (Linux /proc), as a canonical list like `0-3`; null where unknown. */
export function allowedCpus(status = () => readFileSync('/proc/self/status', 'utf8')) {
  try {
    return /^Cpus_allowed_list:\s*(\S+)$/m.exec(status())?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * A timing run measures alone among timing runs: run.py --exclusive gpu-timing sets these for its command. A CPU
 * timing run may instead hold the lock of its own fixed core set, `cpu-timing-<cpus>` (run.py --exclusive
 * cpu-timing-4-7 under taskset -c 4-7), so several run side by side on one machine, each alone on its cores
 * (operator, 28 October 2026); the process's actual affinity must be exactly that set.
 */
export function requireTimingLock(env = process.env, { cpuSet = false, cpus = allowedCpus } = {}) {
  const lock = env.FACEMORPH_EXCLUSIVE ?? '';
  const set = /^cpu-timing-(\d+(?:-\d+)?)$/.exec(lock)?.[1];
  if (env.FACEMORPH_RUN && lock === 'gpu-timing') return { lock, run: env.FACEMORPH_RUN };
  if (env.FACEMORPH_RUN && cpuSet && set && cpus() === set)
    return { lock, run: env.FACEMORPH_RUN, cpus: set };
  throw new Error(
    cpuSet && set
      ? `the ${lock} lock needs the process pinned to exactly those cores (taskset -c ${set}); it runs on ${cpus()}`
      : 'not running under the gpu-timing lock: python3 autoresearch/run.py --exclusive gpu-timing -- <this command>',
  );
}
