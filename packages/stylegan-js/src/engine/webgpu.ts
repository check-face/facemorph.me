// @facemorph/stylegan-js/engine/webgpu (fm-s0vi): the two WebGPU generator loaders on an entry of their own, so a
// worker that reaches them through a dynamic import() bundles and fetches the WGSL engine and the ORT WebGPU glue only
// when it takes a WebGPU route; a CPU-only worker never does. ./engine keeps exporting the same names.
export {
  GpuUnsupported,
  loadOrtWebGpuGenerator,
  type OrtWebGpuBundle,
} from './adapters/ort-webgpu.ts';
export { loadDirectWebGpuGenerator, type DirectBundle } from './adapters/direct-webgpu.ts';
