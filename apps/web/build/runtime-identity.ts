// The shell admission pin and hosted workers share the runtime acquisition/verification projection.
import { loadCandidateRuntime } from '../../../scripts/ci/candidate-runtime.ts';
import type { HostedWorker } from './worker-inventory.ts';

/** No environment pin or fetched manifest can override the reviewed control and overlay. */
export function runtimeIdentity(repo: string): {
  runtimeSha256: string;
  modelSha256: string;
  hosted: HostedWorker[];
} {
  const runtime = loadCandidateRuntime(repo);
  return {
    runtimeSha256: runtime.manifestSha256,
    modelSha256: runtime.modelSha256,
    hosted: [...runtime.hosted],
  };
}
