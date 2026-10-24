# next-matrix fixtures

- `photo-no-metadata.webp`: the public preview face `apps/web/src/public/preview/hello-1024.webp`
  (also `preview/hello-1024.webp` in the pinned control artifact), sha256
  `0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615`. One lossy VP8 chunk, no RIFF
  `FMRP` chunk and no `FaceMorph` text, so the app cannot recover a latent from it and the photo
  encoder has to run. It is not a file the app produced.
- `classic-stage-ids.txt`: the `stage('...')` lines of classic's `scripts/next-matrix.mjs` at
  `facemorph.me-classic` commit `a42829b` (`git show a42829b:scripts/next-matrix.mjs`), the stage-ID
  list that `next-matrix-stages.mjs` must keep.
