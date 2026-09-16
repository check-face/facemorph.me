import diagnostics from '../next-cloudflare/worker.mjs';
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/diagnostics/')) return diagnostics.fetch(request, env);
    return env.ASSETS.fetch(request);
  }
};
