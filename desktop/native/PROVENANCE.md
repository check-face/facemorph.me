# Native product pipeline

`alignment.py` is copied unchanged from `checkface/self-host/e4e/utils/alignment.py`,
the retained CheckFace e4e alignment implementation. Its upstream e4e license is
included as `ALIGNMENT-LICENSE`. The source tree's full provenance remains in
`checkface/self-host/e4e/PROVENANCE.md`.

`product_worker.py` uses the pinned product ONNX graph assets, with native ONNX
Runtime CPU, NumPy RandomState seed/text identity and original truncation. Photo
processing uses native dlib and the retained FFHQ alignment, Pillow RGB/preprocessing,
then the exported e4e ONNX encoder (latent average already included). Orientation is
applied before alignment. Encoder and synthesis sessions have sequential lifetimes.

No weights are bundled by `build-native-runtime.py`. Assets are acquired to a
persistent content-addressed cache from the trusted packaged manifest, with sizes,
SHA-256 checks and HTTP range recovery. User setup still requires the applicable
model terms to permit acquisition/use; this code grants no redistribution rights.
Native GPU provider qualification, installed photo evidence and signed updater
release qualification are independent outstanding gates.
