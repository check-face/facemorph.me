// Pure stage-outcome logic of the cross-engine matrix (next-matrix.mjs): which stages a row has, how one
// stage's result is classified, and when a row may be called passed. No I/O, so the tests call it with plain values.

/** Classic's stage IDs (facemorph.me-classic a42829b, scripts/next-matrix.mjs); none may be dropped or renamed. */
export const STAGES = ['nameSeed', 'repeatOriginal', 'photoE4e', 'localCrop', 'projectSaveReopen', 'morphExport', 'morphPlayback'];

export const OUTCOMES = ['passed', 'failed', 'unsupported', 'buildLimitation', 'incomplete-not-shipped'];

const UNSUPPORTED = /not supported|unsupported|no decoder|NotSupportedError|is not a function|undefined is not an object/i;

/**
 * One stage's outcome. A thrown error is `failed`, or `unsupported` when the stage is optional and the message says
 * the engine lacks the feature. A returned result is `passed` unless it says the test build could not check it
 * (`buildLimitation`) or the artifact does not ship the control (`notShipped`); those are never passes.
 * `notShipped` wins over `buildLimitation`: with no control there is nothing for a build to be limited on.
 */
export function classifyStage({error = null, optional = false, data = null} = {}) {
 if (error!==null&&error!==undefined){
  return optional&&UNSUPPORTED.test(String(error?.message??error))?'unsupported':'failed';
 }
 if (data&&data.notShipped)return 'incomplete-not-shipped';
 if (data&&data.buildLimitation)return 'buildLimitation';
 return 'passed';
}

/** The report record of a stage: `passed` is true for the `passed` outcome only. `notShipped` is kept for next-matrix-summary.py. */
export function stageRecord(outcome, fields = {}) {
 if (!OUTCOMES.includes(outcome))throw Error(`Unknown stage outcome ${outcome}`);
 return {...fields, outcome, passed: outcome==='passed', ...(outcome==='incomplete-not-shipped'?{notShipped:true}:{}), ...(outcome==='buildLimitation'?{buildLimitation:true}:{}), ...(outcome==='unsupported'?{unsupported:true}:{})};
}

/**
 * The row verdict over a report's `stages`. `passed` only when every stage in STAGES really passed. A stage with no
 * record is `missing`, which also stops a pass. `incomplete-not-shipped` and `buildLimitation` stages are listed and
 * are not passes. `status` is `failed` when a stage failed or is unsupported or missing (the run did not do its job),
 * `incomplete` when nothing failed but a control is absent or a build could not check a stage (not a failure, not a pass), else `passed`.
 */
export function rowVerdict(stages = {}) {
 const by = outcome => STAGES.filter(name => stages[name]?.outcome === outcome);
 const missing = STAGES.filter(name => !stages[name]);
 const failed = by('failed');
 const unsupported = by('unsupported');
 const incompleteNotShipped = by('incomplete-not-shipped');
 const buildLimited = by('buildLimitation');
 const passed = STAGES.every(name => stages[name]?.outcome === 'passed' && stages[name]?.passed === true);
 const status = failed.length || unsupported.length || missing.length ? 'failed' : passed ? 'passed' : 'incomplete';
 return {passed, ok: status !== 'failed' && buildLimited.length === 0, status, failed, unsupported, missing, incompleteNotShipped, buildLimited};
}

/** True when the file carries FaceMorph recovery metadata (a WebP `FMRP` chunk or PNG `FaceMorph` text), which would let the app skip the encoder. */
export function hasRecoveryMetadata(bytes) {
 const text = Buffer.from(bytes).toString('latin1');
 return text.includes('FMRP') || text.includes('FaceMorph') || text.includes('facemorph-image-v2');
}

/**
 * Whether the worker events a photo produced show the encoder actually ran: the encode request was posted and the
 * encoder reported completion. A recovery-bearing or cached photo posts no `encode-aligned`, so it cannot satisfy this.
 */
export function encoderRan(events = []) {
 return events.some(e => e.posted === 'encode-aligned') && events.some(e => e.stage === 'encoding-complete');
}
