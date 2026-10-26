import { checkCeiling, MORPH_FRAME_BUDGET } from '../contracts/ceilings.ts';
import type { OperationFailure, OperationRequest } from './service.ts';

/** Product morphs are closed: every selected face owns one segment, including the return segment. */
export function morphFrameFailure(request: OperationRequest): OperationFailure | undefined {
  if (request.kind !== 'morph') return;
  if (request.sources.length < 2) {
    return {
      kind: 'morph-frames',
      reason: 'invalid-settings',
      recovery: 'select-faces',
      message: 'Choose at least two faces to create a morph.',
    };
  }
  const frames = request.settings.frames;
  if (!Number.isSafeInteger(frames) || frames < 2) {
    return {
      kind: 'morph-frames',
      reason: 'invalid-settings',
      message: 'Choose at least 2 frames per face.',
      recovery: 'adjust-frames',
    };
  }
  // Every product shape is a closed loop, so the estimate is the same for all five shapes.
  const estimate = request.sources.length * frames;
  const budget = checkCeiling('MORPH_FRAME_BUDGET', { kind: 'all-routes' }, estimate);
  if (!budget.ok) {
    return {
      kind: 'morph-frames',
      reason: 'over-budget',
      message: overBudgetMessage(
        estimate,
        budget.reason === 'over-ceiling' ? budget.limit : MORPH_FRAME_BUDGET.maxFrames,
      ),
      recovery: 'shorten-morph',
    };
  }
}

const count = (n: number) => n.toLocaleString('en-US');
/** Names the limit reached and the estimate, and the recovery: a shorter Length in More options. */
export function overBudgetMessage(estimate: number, limit: number): string {
  return `This morph would need ${count(estimate)} frames, over the ${count(limit)}-frame limit for one morph. Choose a shorter Length under More options to reduce it. Your selected faces are kept.`;
}
