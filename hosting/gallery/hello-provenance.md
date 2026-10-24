# Historic `hello` preview

The classic FaceMorph API has always accepted `value=hello`. Its text identity is
`sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`.
The September static gallery selection was limited to the 5,055 catalogue names
and numeric seeds 0–999, so it omitted `hello`; that omission did not mean the
classic image was unavailable.

On 10 October 2026, the 1024 WebP response from
`https://api.facemorph.me/api/face/?value=hello&dim=1024&format=webp` was saved
as `src/public/preview/hello-1024.webp`. It is 92,624 bytes, decodes to
1024×1024, and has SHA-256
`0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615`.
The candidate site copies that exact asset into its built static artifact.

This historic lossy WebP is a display preview. It is never written as a
canonical lossless original or used as a morph input; local generation still
produces those when requested.

The next deployment includes this asset and the published-name/seed preview
lookup. CI compares the built and deployed `hello` bytes with this source file,
and the compiled-UI check waits for the 1024×1024 image to decode. The shipping
regression suite also verifies that `hello` needs no catalogue or model fetch.
