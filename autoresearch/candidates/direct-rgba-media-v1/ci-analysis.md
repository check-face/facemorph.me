# Paired codec screen — 10 October 2026

[CI run38031453811](https://github.com/check-face/facemorph.me/actions/runs/38031453811) tested source `afb20d9c9aae0ac5e99e9c2ee6309927a0490efc` on Ubuntu24.04 / headless Chrome155. Load was0.27→0.58; visibility visible. Public API hello1024 fixture only, unchanged image/video parameters, fixed warmup and ABBA×3. Each side has6 measured samples per question. [Raw samples and source hashes](ci-paired-codec.json) · [correctness](ci-correctness.json) · [grouped analysis](ci-analysis.json).

| Question / boundary | Control median | Candidate median | Decision |
| --- | --- | --- | --- |
| PNG delivery vs direct RGBA; draw + next RAF |65.31ms|5.02ms|Keep the component transport; qualify actual canvas UI separately |
| PNG vs WebP q0.8; downloadable file ready including worker startup and metadata |55.36ms|113.17ms|WebP is slower; use only out of band for smaller downloads, keep exact PNG persistence |
| PNG round trip vs direct RGBA; 32-frame1024/16FPS H.264 decoded playable |1,316.24ms|186.07ms|Keep direct video transport; synthesis and compiled UI are excluded |
| Quality vs realtime + queue2; raw-input decoded playable |153.36ms|158.22ms|Discard realtime: no repeatable benefit; retain quality + queue8 |

PNG+metadata:4,245,531B; WebP+metadata:129,932B. Both decoded1024 and recovered exact float32 W+;32-frame videos decoded2s. Visual review of the public fixture showed no obvious corruption. This supports a file-size tradeoff, not universal WebP quality or faster encoding.

The samples use a new image worker per request and video worker per clip. They do not measure persistent image-worker throughput, GPU synthesis, warm model hydration, full product timing, compositor paint or OS sharing. Earlier combined medians mixed two independent questions; the table above splits sample groups by the recorded sequence. Do not merge the two raw/PNG control groups when estimating either paired effect.

The application candidate preserves PNG originals and existing cache keys, paints raw faces immediately, prepares canonical PNGs independently, and converts requested downloads in a worker with compact v2 metadata. It streams ordered video after four sparse anchors, avoiding an all-frame raw array. It retains existing video quality settings. Exact built-UI/recovery/resource/device qualification remains a separate gate.
