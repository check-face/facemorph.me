// Edge-side page-view counts for next.facemorph.me.
//
// Cookieless and identifier-free by construction: no IP, user agent, cookie, visitor id or full
// URL is read into the record. It counts document loads of the two product routes, with a coarse
// referrer host, country and device class. That answers "how many people arrive, from where, and
// does the page load" without a client script, so nothing here runs in the visitor's browser and
// the no-third-party-runtime and no-pre-consent-upload rules are untouched. Client-side errors and
// debug detail stay in the consented diagnostics collector; this file never sees them.
//
// Fails open: a missing binding, a write error or an unexpected request never changes the response.
export const ROUTES = new Map([['/', 'home'], ['/names', 'names'], ['/names/', 'names']]);
const HOSTS = new Set(['next.facemorph.me', 'facemorph.me', 'labs.facemorph.me', 'names.facemorph.me']);

export function referrerClass(header) {
  if (!header) return 'direct';
  let host;
  try { host = new URL(header).hostname.toLowerCase(); } catch { return 'unknown'; }
  if (HOSTS.has(host)) return host === 'next.facemorph.me' ? 'self' : host;
  return host.slice(0, 64);
}

export function pageView(request, status) {
  if (request.method !== 'GET') return null;
  // /names -> /names/ redirects would otherwise count one visit twice; the final load is counted.
  if (status >= 300 && status < 400) return null;
  // A document load, not an asset, fetch or prefetch. Older clients without Fetch Metadata are
  // left uncounted rather than guessed at.
  if (request.headers.get('sec-fetch-dest') !== 'document') return null;
  // Honour an explicit opt-out even though nothing identifying is stored.
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return null;
  const route = ROUTES.get(new URL(request.url).pathname);
  if (!route) return null;
  const mobile = request.headers.get('sec-ch-ua-mobile');
  return {
    indexes: [route],
    blobs: [
      route,
      referrerClass(request.headers.get('referer')),
      /^[A-Z]{2}$/.test(request.cf?.country || '') ? request.cf.country : 'XX',
      mobile === '?1' ? 'mobile' : mobile === '?0' ? 'desktop' : 'unknown',
      String(status)
    ],
    doubles: [1]
  };
}

export function record(env, request, response) {
  try {
    const point = env.PAGEVIEWS && pageView(request, response.status);
    if (point) env.PAGEVIEWS.writeDataPoint(point);
  } catch { /* analytics must never affect delivery */ }
  return response;
}
