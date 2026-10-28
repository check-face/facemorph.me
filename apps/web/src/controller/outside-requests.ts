// Every request this application itself sends to a host other than the page's own origin: host,
// purpose and trigger (fm-96if). The privacy text (fm-szbf) reads this list; keep it complete. The
// names e2e (test/e2e/names.e2e.ts) asserts that every outside host a full journey contacts is
// listed here. Same-origin requests (the app, /runtime/ model files, /catalogue.json, /stats/v1)
// are not outside requests and are not listed. Typing never sends any request (see
// controller/reducers/names.ts for the request rule).

export interface OutsideRequest {
  /** Exact hostname, or `*.` followed by a domain suffix. */
  readonly host: string;
  readonly purpose: string;
  readonly trigger: string;
}

export const OUTSIDE_REQUESTS: readonly OutsideRequest[] = [
  {
    host: 'facemorph-seed-gallery.cdilga.workers.dev',
    purpose:
      'Historic preview pictures: the names grid faces and the instant picture for a catalogue name or a seed from 0 to 999.',
    trigger:
      'Opening Browse names (only the faces in view), picking a name, or switching a face to a mode whose current value has a published picture. Never while typing.',
  },
  {
    host: 'facemorph-name-catalogue.cdilga.workers.dev',
    purpose:
      "A picked name's published result: one recovery-bearing WebP, checked against its digest before use.",
    trigger: 'Picking a name in Browse names. Never while typing, and never for typed text.',
  },
  {
    host: 'www.googletagmanager.com',
    purpose: 'Google Analytics script (gtag).',
    trigger:
      'Page idle on https://next.facemorph.me only; never under automation, Do Not Track, Global Privacy Control or Save-Data.',
  },
  {
    host: '*.google-analytics.com',
    purpose: 'Google Analytics page and event measurements, with advertising storage denied.',
    trigger: 'After the analytics script above has loaded.',
  },
  {
    host: 'next.facemorph.me',
    purpose:
      'Diagnostics collector (/diagnostics/events). Same-origin on next.facemorph.me; outside only when the app is served from another host.',
    trigger: 'Only after the person turns on debug reporting or sends one report.',
  },
  {
    host: 'facemorph.me',
    purpose:
      'Diagnostics collector (/diagnostics/events) for the production host. Same-origin there.',
    trigger: 'Only after the person turns on debug reporting or sends one report.',
  },
];

/** The listed entry covering `url`, null when it is same-origin, or undefined when unlisted. */
export function outsideRequest(url: string, pageOrigin: string): OutsideRequest | null | undefined {
  const target = new URL(url);
  if (target.origin === new URL(pageOrigin).origin) return null;
  if (target.protocol === 'data:' || target.protocol === 'blob:') return null;
  return OUTSIDE_REQUESTS.find((entry) =>
    entry.host.startsWith('*.')
      ? target.hostname.endsWith(entry.host.slice(1))
      : target.hostname === entry.host,
  );
}
