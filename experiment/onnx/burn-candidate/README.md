# Focused Burn/CubeCL browser candidate

**Round 6 update:** Disabling autotuning gives the first correct complete layer and full 1024px synthesis result. The full warm calls take 3.15–3.23 s; only 182 RGB channels differ by one against the ONNX fixture. This is not a speed win or all-fixture qualification. See `review-artifacts/browser-onnx-round6/` and the research log. Earlier failure descriptions below remain historical evidence.

Build with `--no-default-features --features full-model` for direct kernels. Default features retain autotuning; add `exclusive-memory` to test separate GPU allocations. Regenerate wasm-bindgen output and adapt fresh packs after each build as below. `block.html?only=burn&smoke&debug&repeat` tests execution order; `burn-full.html?smoke` checks three synchronized calls and saves the complete raw output without a long 26-frame benchmark.

Local experiment, not a production runtime. Burn 0.21.0 / CubeCL 0.10.0, Rust 1.97.1, wasm-bindgen 0.2.128. Original FP32 weights, W+ and noise. Generated models and WASM packages are ignored by Git.

The profile-selected unit is the complete `b256.conv0` layer: affine, modulation/demodulation, upsampling convolution, filtering, noise, bias and activation. It is not the entire `b256` synthesis block. The full candidate imports the profile-guided polyphase synthesis model.

```sh
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/block_export.py
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/remove_dead_spatial_ops.py
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/polyphase_model.py
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/block_diagnostics.py
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/burn-candidate/validate_filter_rewrite.py
cargo build --release --target wasm32-unknown-unknown --features full-model --manifest-path facemorph.me/experiment/onnx/burn-candidate/Cargo.toml
wasm-bindgen --target web --out-dir facemorph.me/experiment/onnx/burn-candidate/pkg facemorph.me/experiment/onnx/burn-candidate/target/wasm32-unknown-unknown/release/facemorph_burn_candidate.wasm
hf-trial/.venv/bin/python facemorph.me/experiment/onnx/burn-candidate/fix_burnpack.py
```

The Python environment needs `cbor2` to adapt Burnpack storage. The earlier ONNX exports and fixture assets are prerequisites; see the main experiment README and saved manifests. Model generation uses `build.rs`; generated Rust is postprocessed only inside this experiment. Registry sources are not modified.

Serve the workspace with `phase1_server.py` using a dedicated output directory/port. Open `web/block.html?only=burn&smoke=1&debug=1` for batch-one intermediate diagnostics; omit `smoke` for batches 1/2/4. Open `web/burn-full.html` for the full model, currently batch one. Full batch 2/4 timing is gated on batch-one numerical correctness. Do not run two GPU experiments concurrently.

The Rust runner awaits the actual CubeCL runtime GPU client after submitting work. The direct backend is used to isolate fusion; the historical fused run is preserved separately. Outputs are retained until GPU completion so lazy graphs cannot be discarded. Input fixture buffers persist; kernel/runtime allocations remain under Burn's pool. Startup, warm-up and readback are outside timed throughput. First and last output checks gate reported timings.

Observed import/runtime problems:

- `LinearLayout::Col` load mappers call blocking `Backend::sync`, which panics on browser WASM. Row layout plus an exact transpose of ONNX Gemm weight storage avoids that wait. Rank-two singleton bias storage is reshaped to rank one. `fix_burnpack.py` always reads fresh generated packs; it does not repeatedly transpose adapted files.
- Both fused and unfused original layer candidates failed the output check. Stage diagnostics locate the large divergence at filtering after ConvTranspose; no upstream bug attribution is established yet.
- The unmodified full unfused polyphase candidate also failed final numerical correctness. Its warm-up timings are not a speed-win result.
- `patch_filters.py` routes the repeated depthwise resampling filters through `checked_conv`: identical per-channel kernels allow channels to be treated as independent images. The coefficient premise and padding/batch geometry are independently checked. This is a diagnostic workaround for the divergent path, not a claim that a particular CubeCL kernel bug has been proven.

The channel-as-batch workaround was subsequently browser-tested and failed (max final error 16.2862). Nine-stage diagnostics expose a large discrepancy around reshape/materialization; removing the identity reshape pair also failed unchanged. Diagnostic flattening is itself a possible contributor, so the root cause is not established. See the workspace [research log](../../../../browser_onnx_research_log.md) and `review-artifacts/browser-onnx-block/burn-identity-removed.json`. No Burn performance result is valid until correctness passes.

See `review-artifacts/browser-onnx-block/` and `review-artifacts/browser-onnx-burn-full/` for timestamped raw results, failed stages and the final workaround outcome. Do not quote a fast layer result as full-network throughput or accept timing from a failed numerical check.

Round 7 tested `--no-default-features --features full-model,fused-backend`: complete output remained close to ONNX, but fusion regressed synchronized latency from 3.232 to 4.147 s. The feature drains lazy fusion work before asynchronously waiting for the GPU. Keep this as a rejected local performance experiment; see `review-artifacts/browser-onnx-round7/` and the root research log.
