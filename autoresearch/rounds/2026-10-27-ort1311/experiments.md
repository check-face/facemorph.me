# ORT1311-CLASSIC-CPU-SCREEN-V1

This correctness screen executes the existing frozen protocol in
`tools/ort-qualify/qualify.mjs`, whose exact digest and harness digest are in the
raw result. It tests whether the new release's WASM synthesis preserves the
seven product canaries at unchanged RGB <=1 and sampled float <=0.002 limits.
Any failed canary or unexpected provider refutes this screen. The command budget is
600 seconds; no performance comparison is evaluated.

The same fixed classic source, model inputs and references are retained.
`--ort <verified 1.31.1 package> --routes cpu --gpu-build webgpu` replaces only
the selected release runtime entries. A fresh browser profile executes the CPU
route; requests use real local HTTP/HTTPS servers. The native EP files are
identified by the runtime-set digest but are not executed by this CPU screen.

Synthesis success does not establish the separate 108-shard encoder's latent
error or unshared heap contract. A later timing experiment must first qualify
its complete same-release candidate and freeze same-cell control/control noise;
no latency hypothesis or margin is inferred from this single correctness run.
