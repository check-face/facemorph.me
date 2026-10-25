import { checkCeiling } from '../contracts/ceilings.ts';
import type { OperationFailure, OperationRequest } from './service.ts';

/** Product morphs are closed: every selected face owns one segment, including the return segment. */
export function morphFrameFailure(request: OperationRequest): OperationFailure | undefined {
  if (request.kind !== 'morph') return;
  const frames = request.settings.frames;
  if (!Number.isSafeInteger(frames) || frames < 2 || frames % 2) {
    return {
      kind: 'morph-frames',
      reason: 'invalid-settings',
      message: 'Choose an even number of frames per segment, at least 2.',
      recovery: 'adjust-frames',
    };
  }
  const budget = checkCeiling(
    'MORPH_FRAME_BUDGET',
    { kind: 'all-routes' },
    request.sources.length * frames,
  );
  if (!budget.ok) {
    return {
      kind: 'morph-frames',
      reason: 'over-budget',
      message:
        'Choose fewer frames per segment to shorten this morph. Your selected faces are kept.',
      recovery: 'shorten-morph',
    };
  }
}
