// Types for the imported candidate modules the shell calls (byte-identical .mjs, no declarations of their own).
declare module '*/src/Next/photo-selection.mjs' {
  /** Files from a drop or a file input, in order; clears the input so the same file can be chosen again. */
  export function photoFiles(event: Event): File[];
}
