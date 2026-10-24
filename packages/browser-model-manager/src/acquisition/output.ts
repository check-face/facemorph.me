// Output-cache first (fm-fr9s): an action whose result the app already holds (a prepared names-picker face, a
// cached still) is satisfied from that output and acquires nothing. Model-cached and output-cached stay distinct
// cases: only a miss in the output cache reaches the model cache, and only then under the action's grant.

export type ActionSource<O, M> =
  | { readonly from: 'output-cache'; readonly output: O }
  | { readonly from: 'model'; readonly model: M };

/**
 * Looks the action up in the app's output cache first; acquires (and so may download) only on a miss. A lookup
 * that fails is a miss, never a reason to skip the grant.
 */
export async function satisfyAction<O, M>(
  lookup: () => Promise<O | null | undefined>,
  acquire: () => Promise<M>,
): Promise<ActionSource<O, M>> {
  let output: O | null | undefined;
  try {
    output = await lookup();
  } catch {
    output = null;
  }
  if (output !== null && output !== undefined) return { from: 'output-cache', output };
  return { from: 'model', model: await acquire() };
}
