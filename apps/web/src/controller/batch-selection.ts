// The batch view's selection rules come from the contract (contracts/batch.ts): one global click order across
// files, deselect removes and reselect appends, allocation only while the revisions match. Re-exported here so the
// pure reducers keep importing controller code only.
export { allocateKeypoints, applyClick } from '../contracts/batch.ts';
export type { BatchSelection, CandidateId } from '../contracts/batch.ts';
export type { InputRevision } from '../contracts/inputs.ts';
export type { CropOffer, DetectedFace, DetectedFaces } from '../../shell/facade/records.ts';
