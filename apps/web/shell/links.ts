/// <reference types="vite/client" />
// The shell's version line and issue link, ported from classic src/Next/product-bridge.mjs (sourceVersion,
// issueUrl). The diagnostics reference comes in as a value: the shell has no diagnostics of its own.

export const SITE_NAME = 'facemorph.me';
export const CONTACT_EMAIL = 'checkfaceml@gmail.com';
export const GITHUB_REPO = 'facemorph-me/facemorph.me';
const ISSUE_REPO = 'https://github.com/facemorph-me/facemorph.me/issues/new';

/** Short commit ('+' when built from a dirty tree), or 'local' for anything that is not a commit. */
export function sourceVersion(
  sha: string = import.meta.env?.['FACEMORPH_SOURCE_SHA'] ?? 'unknown',
): string {
  const [commit = '', dirty] = String(sha).split('-');
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) + (dirty ? '+' : '') : 'local';
}

export interface IssueContext {
  readonly route?: string;
  readonly reference?: string;
  readonly version?: string;
  readonly userAgent?: string;
}

/** A prefilled issue carries only coarse browser/device facts and validated public identifiers. */
export function issueUrl({
  route = '',
  reference = '',
  version = sourceVersion(),
  userAgent = globalThis.navigator?.userAgent ?? '',
}: IssueContext = {}): string {
  const deviceClass = /iPad|Tablet/i.test(userAgent)
    ? 'tablet'
    : /Mobile|Android|iPhone/i.test(userAgent)
      ? 'phone'
      : 'computer';
  const browser = /Firefox\//i.test(userAgent)
    ? 'Firefox'
    : /Edg\//i.test(userAgent)
      ? 'Edge'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : 'unknown browser';
  const device = `${deviceClass} / ${browser}`;
  const processing = ['cpu', 'webgpu'].includes(route) ? route : 'not started yet';
  version = /^(?:[a-f0-9]{7}|[a-f0-9]{40})\+?$/.test(version) ? version : 'local';
  reference = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference)
    ? reference
    : 'none';
  const summary = [
    'Site: next.facemorph.me',
    `Version: ${version}`,
    `Device: ${device}`,
    `Processing: ${processing}`,
    `Report reference: ${reference || 'none'}`,
  ].join('\n');
  const params = new URLSearchParams({
    template: 'bug-report.yml', // .github/ISSUE_TEMPLATE/bug-report.yml (classic's next-facemorph.yml)
    labels: 'next.facemorph.me',
    title: '[next] ',
    version,
    device,
    route: processing,
    reference: reference || 'none',
    body: '**What happened?**\n\n\n**What did you expect?**\n\n\n---\n' + summary,
  });
  return `${ISSUE_REPO}?${params.toString()}`;
}
