# Native accelerator feasibility

Hypothesis: the pinned spatial synthesis graph and actual e4e encoder can execute
through a native accelerator with the existing numerical gates. This candidate
does not modify desktop product admission. Start with one synthetic synthesis
case and actual e4e from an independently prepared aligned tensor. Only then run
all31; separately qualify real alignment, reconstruction, cache, video and recovery.

Run `probe.py` under the workspace `autoresearch/run.py --lane native-gpu --device
local-mac` lease with a 600-second limit. Supply `--manifest`, `--cache`, `--report`
and `--provider coreml|directml|cuda`. Stage reports survive later errors/timeouts.
Profile files record CPU versus provider nodes; CoreML compute-plan logs must also
prove hardware placement. A registered provider is not proof of GPU execution.
Neither screening timing nor mixed CPU/provider placement is a speedup claim.

CoreML uses CPUAndGPU, float32 accumulation and a model-hash-addressed compile
cache. DirectML disables unsupported memory patterns/parallel execution. CUDA
disables TF32. Dependency availability remains separately qualified per target.

Official references: [CoreML](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html),
[DirectML](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html),
[CUDA](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).
