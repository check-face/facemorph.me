# @facemorph/browser-model-manager

Consented acquisition, verification, storage and eviction of browser model assets, and the model manifest schema
(`schema/`).

## Licence and model weights

The code is MIT licensed (`LICENSE`; bundled third-party code in `THIRD_PARTY_NOTICES`). **No model weights are
included.** The manager downloads them from a model host only after consent, and they come under their own terms,
separate from this package's licence and limited to non-commercial use:

<!-- model-terms:start -->
- NVIDIA StyleGAN2 licence: [upstream text](https://github.com/NVlabs/stylegan2/blob/master/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-NC.txt`
- NVIDIA StyleGAN2-ADA licence: [upstream text](https://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt); served beside the weights as `notices/NVIDIA-StyleGAN2-ADA.txt`
- FFHQ dataset terms: [upstream text](https://github.com/NVlabs/ffhq-dataset#licenses); served beside the weights as `notices/FFHQ-terms.txt`
- e4e MIT licence: [upstream text](https://github.com/omertov/encoder4editing/blob/main/LICENSE); served beside the weights as `notices/e4e-MIT.txt`
- dlib landmark model notice: [upstream text](https://www.dlib.net/face_landmark_detection_ex.cpp.html); served beside the weights as `notices/index.html#dlib-landmarks`
<!-- model-terms:end -->

A host publishes these texts beside the weights, under `notices/` next to the runtime manifest, and the manifest's
`distribution.notices` points at their index. Show that link where you ask for download consent.
