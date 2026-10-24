// The candidate bridge's view of project-json.ts (fm-stth): the same decode/encode in the Result shape the bridge was
// written against (Fable's Ok = tag 0 with the value in fields[0], Error = tag 1 with the messages), so swapping its
// Fable import is a one-line change and the bridge's own tests run unchanged. The typed facade (fm-pia9) reads
// project-json.ts directly.
import { decode as decodeProject, encode as encodeProject, type Project } from './project-json.ts';

export type FableResult<T> =
  | { readonly tag: 0; readonly fields: readonly [T] }
  | { readonly tag: 1; readonly fields: readonly [readonly string[]] };

const fable = <T>(
  r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly messages: readonly string[] } },
): FableResult<T> => (r.ok ? { tag: 0, fields: [r.value] } : { tag: 1, fields: [r.error.messages] });

export const decode = (input: string): FableResult<Project> => fable(decodeProject(input));
export const encode = (project: Project): FableResult<string> => fable(encodeProject(project));
