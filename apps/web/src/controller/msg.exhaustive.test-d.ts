import type { Msg, Payloads } from './msg.ts';
import type { CASES } from './reducers/index.ts';
import type { Effect } from './effects.ts';
type Assert<T extends true> = T;
export type AllCases = Assert<
  Exclude<Msg['type'], keyof typeof CASES> extends never ? true : false
>;
export type NoExtraCases = Assert<
  Exclude<keyof typeof CASES, keyof Payloads> extends never ? true : false
>;
// @ts-expect-error Every payload is a tuple with its own signature.
export const wrongPayload: Msg = { type: 'Edit', args: ['face-1'] };
// Effect descriptions carry slot references and allowlisted control values, never user content.
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type EffectKeys = 'type' | 'id' | 'file' | 'message' | 'enabled' | 'basis' | 'frame';
export type EffectPrivacy = Assert<
  Exclude<KeysOfUnion<Effect>, EffectKeys> extends never ? true : false
>;
export type DispatchPrivacy = Assert<
  Extract<Effect, { type: 'dispatch' }>['message']['type'] extends 'RunFace' | 'BrowseNames'
    ? true
    : false
>;
// @ts-expect-error Preview acquisition resolves the slot at dispatch; text is never an effect payload.
export const privatePreview: Effect = { type: 'publicPreview', id: 'face-1', text: 'private' };
// @ts-expect-error Error objects and raw errors are never reporting payloads.
export const privateReport: Effect = { type: 'sendReportOnce', error: new Error('private') };
// @ts-expect-error Photos remain in the model/bridge, never in these effect descriptions.
export const privatePhoto: Effect = { type: 'rememberSourcePhoto', id: 'face-1', file: new Blob() };
