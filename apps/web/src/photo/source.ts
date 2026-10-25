export type ClipboardSource =
  | { readonly kind: 'image' }
  | { readonly kind: 'invalid'; readonly message: string };

/** Plain clipboard descriptors keep classification independent of browser I/O. Image wins over text. */
export function classifyClipboard(items: readonly { kind: string; type: string }[]): ClipboardSource {
  const files = items.filter((item) => item.kind === 'file');
  if (files.length > 1)
    return { kind: 'invalid', message: 'Paste one image at a time.' };
  if (files.length === 1)
    return /^image\/(png|jpeg|webp)$/.test(files[0]!.type)
      ? { kind: 'image' }
      : { kind: 'invalid', message: 'Paste a PNG, JPEG or WebP image.' };
  return {
    kind: 'invalid',
    message: items.some((item) => item.kind === 'string')
      ? 'Paste an actual image, not text.'
      : 'The clipboard has no image. Copy an image and try again.',
  };
}
