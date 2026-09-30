import diagnostics from '../next-cloudflare/worker.mjs';
import {record} from './analytics.mjs';
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/diagnostics/')) return diagnostics.fetch(request, env);
    return record(env, request, await env.ASSETS.fetch(request));
  }
};
