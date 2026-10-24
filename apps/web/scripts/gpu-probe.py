# Executed by browser-harness (js/cdp/new_tab helpers), like next-e2e-browser.py.
# GPU-lane probe: records what graphics path this browser ACTUALLY exposes and which
# route the product admits, without forcing anything. Output: JSON on stdout, one row.
# The product site must already resolve (host-resolver-rules / adb reverse / tunnel).
import json

Served = 'https://next.facemorph.me/'

info = {'lane': __import__('os').environ.get('LANE_NAME', 'unnamed')}
agent = js('navigator.userAgent')
info['userAgent'] = agent
info['webgpuExposed'] = js("!!navigator.gpu")
adapter_json = js("""
(async () => {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) return {adapter: null};
    const i = adapter.info || {};
    let maxBuffer = null;
    try { maxBuffer = adapter.limits.maxBufferSize; } catch (e) {}
    return {adapter: {vendor: i.vendor || null, architecture: i.architecture || null,
                       device: i.device || null, description: i.description || null},
            isFallbackAdapter: !!adapter.isFallbackAdapter, maxBufferSize: maxBuffer};
  } catch (error) { return {error: String(error)}; }
})()
""")
info['gpu'] = adapter_json
# Real page: open the product and read the route the product itself admits after a
# generation, plus its processing-mode options. Do not force anything.
new_tab(Served)
wait_for_load()
try:
    js("document.querySelector('input.next-face-input') || document.querySelector('.next-face input')")
except Exception:
    pass
route = js("(document.querySelector('[data-next-route]')?.textContent || '')")
info['routeCaption'] = route
errors = js("(document.querySelector('.next-error')?.textContent || '').slice(0,200)")
info['errorText'] = errors
print(json.dumps(info))
