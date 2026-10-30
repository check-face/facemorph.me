# Experiments

## E1: direct WGSL engine on ARM phones

- Mechanism: the direct engine is ~1.7x faster than ORT on desktop GPUs; the P30 adapter's limits already fit its
  134,480,000-byte phase grid, so admitting it on `arm` phones (iPhones and other GPUs off) might beat ORT JSEP.
- Control: main (ORT JSEP 1.22 on WebGPU). Refuting observation: warm face not faster beyond control spread.
- Gates: product canaries at route qualification (unchanged tolerances).
- Outcome: discard (log E1-OBSERVED).

## E2: Mali phones default to the CPU route

- Mechanism: on this phone the CPU route is faster than any WebGPU engine measured; add a prior to stylegan-js
  ROUTE_PRIORS (the existing Android / iOS / desktop table) that orders CPU first for `android && gpuVendor==='arm'`.
  An explicit WebGPU choice still overrides; Adreno, iPhones, unnamed GPUs and desktops are unchanged.
- Control: main. Refuting observation: warm face on the phone-webgpu cell not faster than control.
- Gates: CPU route canaries (unchanged); stylegan-js routes tests.
