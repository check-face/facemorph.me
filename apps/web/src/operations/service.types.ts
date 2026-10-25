// Compiled with the operation tests. These calls are deliberately unreachable at runtime.
import type { InputRevision } from '../contracts/inputs.ts';
import type { AttemptId, OperationRequest, OperationService, RequestId } from './service.ts';
export function checkTypes(
  service: OperationService,
  request: Extract<OperationRequest, { kind: 'face' }>,
  requestId: RequestId,
  attemptId: AttemptId,
) {
  service.requestFace(request);
  // @ts-expect-error Opaque request IDs cannot be interchanged with attempts.
  service.cancel({ requestId: attemptId });
  // @ts-expect-error Raw numbers cannot masquerade as validated input revisions.
  const revision: InputRevision = 1;
  // @ts-expect-error Mutable UI state cannot revise a captured route.
  request.route.requested = 'cpu';
  // @ts-expect-error Callbacks cannot be carried in cloneable operation payloads.
  service.requestFace({ ...request, onProgress() {} });
  // @ts-expect-error Face requests cannot enter the morph boundary.
  service.requestMorph(request);
  // @ts-expect-error A single-slot request cannot masquerade as the tester bulk operation.
  service.requestFaces(request);
  void requestId;
  void revision;
}
