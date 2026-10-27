// The release's paired-timing commands in one place, so release.yml's timing jobs and npm run release:local run the
// same thing (fm-fy2.11). Segments and the stop rule are scripts/verify/not-worse (run.ts, median-check.mjs).
export const TIMING_SEGMENTS = ['face', 'morph', 'photo'];

const CONTROL = '.cache/control/tree/deploy-next';
const controlDigest = `"$(node -p 'require("./autoresearch/drivers/control.json").treeSha256')"`;
const treeDigest = (dir) =>
  `"$(node --input-type=module -e "import {treeDigest} from './scripts/ci/fetch-artifact.ts'; console.log(treeDigest('${dir}'))")"`;

/**
 * Shell commands (run from the repository root) for one segment. Local: three pairs, then more one at a time until
 * the stop rule decides, then the verdict. CI: one pair at `pair` with the given digest; the merge runs elsewhere.
 */
export function timingCommands({
  segment,
  build,
  runtimeDir,
  out,
  local = false,
  pair = 0,
  digest,
  source,
  label,
  wait = 3600,
}) {
  if (!TIMING_SEGMENTS.includes(segment)) throw new Error(`unknown timing segment ${segment}`);
  // pair null: the whole segment in one job, three pairs then the stop rule, with its verdict.
  const whole = local || pair == null;
  const name = label ?? (whole ? `release-local-${segment}` : `release-${segment}-p${pair}`);
  const run = [
    // The machine-wide timing lock is how a machine runs one timing job at a time (operator, 28 October 2026): a
    // second job waits for it rather than failing.
    `python3 autoresearch/run.py --exclusive gpu-timing --wait ${wait} --timeout 3600 --`,
    `node scripts/verify/not-worse/run.ts --control ${CONTROL} --control-digest ${controlDigest}`,
    `--build ${build} --build-digest ${digest ?? treeDigest(build)} --build-source ${source ?? 'local'}`,
    `--segment ${segment}`,
    whole ? '--pairs 3 --max-pairs 7' : `--pairs 1 --pair-index ${pair}`,
    `--provider cpu --browser chromium --runtime ${runtimeDir} --label ${name} --out ${out}`,
  ].join(' ');
  const cmds = ['node scripts/import/fetch-control.mjs --dest .cache/control', run];
  if (whole)
    cmds.push(`node scripts/verify/not-worse/median-check.mjs ${out}/${name} --expect ${segment}`);
  return cmds;
}
