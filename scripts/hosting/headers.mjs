// One policy for local preview, verification and Cloudflare asset staging.
import { readFileSync } from 'node:fs';
export const POLICY = JSON.parse(
  readFileSync(new URL('../../hosting/next-static/headers.json', import.meta.url), 'utf8'),
);
export function headersFor(path, policy = POLICY) {
  return Object.assign(
    {},
    ...Object.entries(policy)
      .filter(([pattern]) =>
        pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
      )
      .map(([, headers]) => headers),
  );
}
export const headersText = (policy = POLICY) =>
  Object.entries(policy)
    .map(
      ([pattern, headers]) =>
        pattern +
        '\n' +
        Object.entries(headers)
          .map(([name, value]) => `  ${name}: ${value}\n`)
          .join(''),
    )
    .join('');
