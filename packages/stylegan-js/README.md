# @facemorph/stylegan-js

StyleGAN2 mapping, synthesis and e4e photo encoding in the browser: the engine contracts (`.`) and the engine core
(`./engine`). See [capabilities](docs/capabilities.md) and [saved file formats](docs/formats.md).

## Licence and model weights

The code is MIT licensed (`LICENSE`; bundled third-party code in `THIRD_PARTY_NOTICES`). **The model weights are
not included.** A model host supplies them, and they come under their own terms, separate from this package's
licence and limited to non-commercial use:

<!-- model-terms:start -->
- NVIDIA Source Code License-NC (StyleGAN2 model): [upstream text](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-NC.txt`
- NVIDIA Source Code License (StyleGAN2-ADA conversion code): [upstream text](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-ADA.txt`
- FFHQ dataset terms (CC BY-NC-SA 4.0): [upstream text](https://github.com/NVlabs/ffhq-dataset#licenses); served beside the weights as `notices/FFHQ-terms.txt`
- e4e MIT licence: [upstream text](https://github.com/omertov/encoder4editing/blob/main/LICENSE); served beside the weights as `notices/e4e-MIT.txt`
- dlib landmark model notice: [upstream text](https://www.dlib.net/face_landmark_detection_ex.cpp.html); served beside the weights as `notices/index.html#dlib-landmarks`
<!-- model-terms:end -->

A host publishes these texts beside the weights, under `notices/` next to the runtime manifest, and the manifest's
`distribution.notices` points at their index.
