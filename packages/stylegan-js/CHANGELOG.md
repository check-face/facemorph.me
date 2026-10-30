# Changelog

All notable changes to `stylegan-js` are recorded here. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor release may break the API and a patch release does not. A published version
is never changed: a fix is a new version. Each tarball carries `PROVENANCE.json`, naming the commit and the digest
of the `dist/` it was built from ([releasing](../../docs/packages/RELEASING.md)).

## 0.1.0 (not yet published)

First release.

- StyleGAN2 mapping and synthesis on the CPU (ONNX Runtime WASM) and WebGPU (ONNX Runtime WebGPU and direct WGSL kernels), admitted only after the model's own canaries pass.
- The e4e photo encoder for the FFHQ generator.
- Morph paths, frame ordering and `renderMorph`; blends with clamped weights.
- PNG and lossless WebP stills that carry the exact W+ latent and generator identity (recovery schema 3), and readers for schemas 1 to 3.
- Model descriptors for FFHQ config-F 1024 and AFHQ cat 512.
