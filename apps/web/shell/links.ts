// The shell's version line and issue link, ported from classic src/Next/product-bridge.mjs (sourceVersion,
// issueUrl). The diagnostics reference comes in as a value: the shell has no diagnostics of its own.

export const SITE_NAME = 'facemorph.me';
export const CONTACT_EMAIL = 'checkfaceml@gmail.com';
export const GITHUB_REPO = 'check-face/facemorph.me';
const ISSUE_REPO = 'https://github.com/check-face/facemorph.me/issues/new';

/** Short commit ('+' when built from a dirty tree), or 'local' for anything that is not a commit. */
export function sourceVersion(sha: string = import.meta.env['FACEMORPH_SOURCE_SHA'] ?? 'unknown'): string {
  const [commit = '', dirty] = String(sha).split('-');
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) + (dirty ? '+' : '') : 'local';
}

export interface IssueContext {
  readonly route?: string;
  readonly reference?: string;
  readonly version?: string;
  readonly userAgent?: string;
  readonly path?: string;
}

/** A prefilled GitHub issue for this page: site, version, device, processing route and report reference. */
export function issueUrl({ route = '', reference = '', version = sourceVersion(), userAgent = globalThis.navigator?.userAgent ?? '', path = globalThis.location?.pathname ?? '/' }: IssueContext = {}): string {
  const device = String(userAgent).slice(0, 300);
  const processing = route || 'not started yet';
  const summary = [`Site: next.facemorph.me${path}`, `Version: ${version}`, `Device: ${device}`, `Processing: ${processing}`, `Report reference: ${reference || 'none'}`].join('\n');
  const params = new URLSearchParams({
    template: 'next-facemorph.yml', labels: 'next.facemorph.me', title: '[next] ', version, device, route: processing, reference: reference || 'none',
    body: '**What happened?**\n\n\n**What did you expect?**\n\n\n---\n' + summary,
  });
  return `${ISSUE_REPO}?${params.toString()}`;
}
