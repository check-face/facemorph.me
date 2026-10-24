// Types for the imported candidate modules the shell calls (byte-identical .mjs, no declarations of their own).
declare module '*/src/Next/photo-selection.mjs' {
  /** Files from a drop or a file input, in order; clears the input so the same file can be chosen again. */
  export function photoFiles(event: { dataTransfer?: DataTransfer | null; target?: EventTarget | null }): File[];
}
declare module '*/src/Next/photo-selection.mjs' {
  /** Marks a drop target while a photo is dragged over it (`next-photo-over`) and sets the drop effect. It reads
   * `currentTarget`, so it takes React's event (the handler's element), as classic's Feliz handlers passed it. */
  export function dragPhoto(event: { preventDefault(): void; stopPropagation(): void; currentTarget: Element; dataTransfer: DataTransfer | null }, busy: boolean, leaving?: boolean): void;
  /** Opens the hidden file input `#photo-<id>`. */
  export function openPhotoPicker(id: string): void;
}
