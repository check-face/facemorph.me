// The retained bridge result protocol: tag 0 carries the value and tag 1 carries errors.
// The typed facade reads project-json.ts directly.
import { decode as decodeProject, encode as encodeProject, type Project } from './project-json.ts';

export type BridgeResult<T> =
  | { readonly tag: 0; readonly fields: readonly [T] }
  | { readonly tag: 1; readonly fields: readonly [readonly string[]] };

const bridgeResult = <T>(
  r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly messages: readonly string[] } },
): BridgeResult<T> => (r.ok ? { tag: 0, fields: [r.value] } : { tag: 1, fields: [r.error.messages] });

export const decode = (input: string): BridgeResult<Project> => bridgeResult(decodeProject(input));
export const encode = (project: Project): BridgeResult<string> => bridgeResult(encodeProject(project));
