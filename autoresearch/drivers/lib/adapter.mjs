// WebGPU adapter admission for research lanes (fm-qqh). A hardware-GPU claim needs a hardware adapter: a software
// rasteriser (SwiftShader, llvmpipe/lavapipe, WARP) or a fallback adapter is rejected, as is no adapter at all.
// CPU lanes make no adapter claim. Pure: takes the adapter facts the browser reported.
const SOFTWARE = /swiftshader|llvmpipe|lavapipe|softpipe|software|microsoft basic render|warp/i;

/** info: {vendor, architecture, device, description, isFallbackAdapter} or null when requestAdapter() gave none. */
export function adapterVerdict(info, lane) {
  if (lane !== 'browser-gpu') return { ok: true, reason: `${lane} makes no GPU adapter claim` };
  if (!info) return { ok: false, reason: 'no WebGPU adapter' };
  if (info.isFallbackAdapter) return { ok: false, reason: 'fallback (software) adapter' };
  const text = [info.vendor, info.architecture, info.device, info.description]
    .filter(Boolean)
    .join(' ');
  if (SOFTWARE.test(text)) return { ok: false, reason: `software adapter: ${text}` };
  if (!text.trim()) return { ok: false, reason: 'adapter reports no vendor or architecture' };
  return { ok: true, reason: `hardware adapter: ${text}` };
}
