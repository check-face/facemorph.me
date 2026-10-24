// The candidate's view records (classic src/Next/Product.fs lines 15-27), as the rendering port reads them.
// The controller that produces them is ported separately (fm-qkke, fm-j16n); until then the bridge supplies them.

export type FaceMode = 'text' | 'seed' | 'photo' | 'project';

export interface Input {
  readonly id: string;
  readonly mode: FaceMode;
  readonly value: string;
  /** The chosen photo for a photo face (a File), or null. */
  readonly file: File | null;
}

export interface Face {
  readonly id: string;
  /** Raw pixels are painted onto a canvas by `drawFace` instead of shown from `url`. */
  readonly raw: boolean;
  readonly url: string;
  readonly label: string;
  readonly sourceMode: string;
  readonly sourceFile: File | null;
}

export interface PublicPreview {
  readonly id: string;
  readonly mode: FaceMode;
  readonly value: string;
  readonly url: string;
}
