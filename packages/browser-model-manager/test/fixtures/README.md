Planted inputs for the manifest contract tests (fm-hwh):

- `candidate-runtime-manifest.json`: the candidate's runtime manifest exactly as served by
  https://next.facemorph.me/runtime/manifest.json on 2026-10-24, SHA-256
  `d9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c` (the runtime SHA the device lab
  and qualification pin). No weights; it names assets by URL and digest.
- `newer-major-manifest.json`: the same manifest with `schemaVersion` 2, which must be rejected.
- `model-conv-build-manifest.json`: what `packages/model-conv/model_conv/manifest.py` `build()` writes for the
  FFHQ declaration (from its test helper's inputs; unpublished `file` assets). A real conversion's manifest is
  validated against the schema by `packages/model-conv/tests/acceptance.sh`.
