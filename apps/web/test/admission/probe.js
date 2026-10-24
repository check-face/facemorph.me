// The capability probe (fm-4umi), shared by capture-capabilities.mjs (desktop browsers) and capture-phone.py
// (the lab phone over CDP): an async function expression evaluated in the page; it loads no model.
export default async () => {
  const simd = WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
      15, 253, 98, 11,
    ]),
  );
  let threads = false;
  try {
    threads =
      typeof SharedArrayBuffer === 'function' &&
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
        SharedArrayBuffer;
  } catch {}
  // How far one WebAssembly memory can grow (64 KiB pages), probed up to the e4e limit and released.
  let maxMemoryBytes = 0;
  try {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 4096 });
    for (const step of [255, 768, 1024, 2048]) {
      try {
        m.grow(step);
      } catch {
        break;
      }
    }
    maxMemoryBytes = m.buffer.byteLength;
  } catch {}
  let webgpu = 'absent';
  if (navigator.gpu) {
    let adapter = null;
    for (let i = 0; i < 5 && !adapter; i++) {
      adapter = await navigator.gpu.requestAdapter().catch(() => null);
      if (!adapter) await new Promise((r) => setTimeout(r, 1000));
    }
    webgpu = adapter
      ? {
          adapter: {
            limits: {
              maxBufferSize: adapter.limits.maxBufferSize,
              maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
              maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
            },
            features: [...adapter.features].sort(),
            fallback: adapter.info?.isFallbackAdapter ?? null,
            architecture: adapter.info?.architecture ?? null,
            vendor: adapter.info?.vendor ?? null,
          },
        }
      : { adapter: null };
  }
  const avc = async (size) => {
    try {
      return (
        (
          await VideoEncoder.isConfigSupported({
            codec: 'avc1.42002A',
            width: size,
            height: size,
            bitrate: Math.round((size * size * 16 * 0.25) / 1000) * 1000,
            framerate: 16,
          })
        ).supported === true
      );
    } catch {
      return false;
    }
  };
  const videoEncoder =
    typeof VideoEncoder === 'function'
      ? { avc1024: await avc(1024), avc512: await avc(512) }
      : 'absent';
  return {
    webgpu,
    wasm: { simd, threads, maxMemoryBytes },
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: navigator.deviceMemory ?? null,
    videoEncoder,
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    userAgent: navigator.userAgent,
  };
};
