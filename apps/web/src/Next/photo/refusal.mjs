/** An expected refusal: the photo or the browser cannot do what was asked, the message is
 * written for the visitor, and the error area is its one owner. Unexpected failures keep
 * the Off-state report ask (flow-matrix R45), so the controller must tell the two apart.
 * The tag rides in `name` because a worker's structured clone drops custom properties. */
export function refusal(message) {
  const error = Error(message);
  error.name = 'PhotoRefusal';
  return error;
}
/** AbortError is a cancelled crop or decode: expected, never a bug to report. */
export function isRefusal(error) {
  return error?.name === 'PhotoRefusal' || error?.name === 'AbortError';
}
