// Restored words in the field (fm-5hww, defect 9). After a reload in the same tab the faces return from the session
// record and their typed words from this tab's sessionStorage (session-words.ts), keyed by the record's face
// identity. A face restored with its name or seed shows them in an editable field; until the person changes them,
// the bridge still sees the face as restored ('project'), so nothing is generated again. A restored photo face keeps
// its 'Restored face' mode and only gains its sanitized file name as its label. Any edit drops the mapping and the
// edited words are generated as usual. Without words (new tab, private mode, failing storage) the accepted
// "Restored face" label stands.
import type { Input, Output } from '../facade/records.ts';
import { restoreWords, RESTORED_FACE_LABEL } from './session-words.ts';
import { restoredWordsKey } from './retention.ts';

type Typed = { readonly mode: 'text' | 'seed'; readonly value: string };
const restored = new Map<string, Typed>();
let edits = 0;

/** Any edit made while a restore is in flight abandons the restore's words (the edit stands). */
export const noteEdit = (): void => void edits++;
export const editRevision = (): number => edits;
/** A face that is invalidated (edited, removed, replaced) is no longer the restored face. */
export const forgetRestored = (id: string): void => void restored.delete(id);
export const forgetAllRestored = (): void => restored.clear();

/** True while `input` is still exactly the words a restored face came back with. */
export function isRestored(input: Input): boolean {
  const words = restored.get(input.id);
  return !!words && input.mode === words.mode && input.value === words.value && !input.file;
}

/** What the bridge is given for an input: an unchanged restored face stays a restored face. */
export function toBridge(input: Input): Input {
  if (!restored.has(input.id)) return input;
  if (isRestored(input)) return { ...input, mode: 'project' };
  restored.delete(input.id);
  return input;
}
export const inputsToBridge = (inputs: readonly Input[]): Input[] => inputs.map(toBridge);

/**
 * Puts tab-scoped words into a restore's inputs. `since` is editRevision() when the restore began: a restore that
 * lands after an edit keeps the "Restored face" label everywhere.
 */
export function withRestoredWords(output: Output, since: number): Output {
  restored.clear();
  if (!output.restored) return output;
  const inputs = output.inputs.map((input): Input => {
    if (input.mode !== 'project') return input;
    const key = restoredWordsKey(input.id);
    if (!key) return input;
    const { words, reason } = restoreWords(key, input.id, () => edits === since);
    if (reason !== 'restored' || !words) return input;
    if (words.mode === 'photo')
      return { ...input, mode: 'project', value: words.value || RESTORED_FACE_LABEL };
    restored.set(input.id, { mode: words.mode, value: words.value });
    return { ...input, mode: words.mode, value: words.value, file: null };
  });
  return { ...output, inputs };
}
