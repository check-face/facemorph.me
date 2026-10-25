// The candidate's view records (classic src/Next/Product.fs lines 15-27), as the rendering port reads them.
// The controller that produces them is ported separately (fm-qkke, fm-j16n); until then the bridge supplies them.

export type FaceMode = 'text' | 'seed' | 'photo' | 'project';

export type { Input, Face, PublicPreview } from '../facade/records.ts';
