// Check actual responses against the production policy and pinned file identity.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headersFor } from './headers.mjs';
import { options } from '../inventory/lib.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function responseFindings(path, headers, bytes, expected) {
  const actual = new Headers(headers),
    findings = [];
  for (const [name, value] of Object.entries(headersFor(path)))
    if (actual.get(name) !== value)
      findings.push({ path, problem: name, expected: value, got: actual.get(name) });
  const kind = actual.get('content-type') ?? '';
  if (
    (expected.kind === 'html' && !kind.startsWith('text/html')) ||
    (expected.kind === 'worker' && !/^(text|application)\/javascript\b/.test(kind)) ||
    (expected.kind === 'wasm' && !kind.startsWith('application/wasm'))
  )
    findings.push({ path, problem: 'Content-Type', expected: expected.kind, got: kind });
  if (expected.sha256 && digest(bytes) !== expected.sha256)
    findings.push({ path, problem: 'digest', expected: expected.sha256, got: digest(bytes) });
  return findings;
}

export async function checkResponses(origin, assets) {
  const results = [];
  for (let at = 0; at < assets.length; at += 8)
    await Promise.all(
      assets.slice(at, at + 8).map(async (asset) => {
        const response = await fetch(new URL(asset.path, origin), {
          headers: { Accept: asset.kind === 'html' ? 'text/html' : '*/*' },
          signal: AbortSignal.timeout(60000),
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        const findings = responseFindings(asset.path, response.headers, bytes, asset);
        if (!response.ok)
          findings.push({ path: asset.path, problem: 'HTTP', got: response.status });
        results.push({
          path: asset.path,
          kind: asset.kind,
          bytes: bytes.length,
          headers: Object.fromEntries(response.headers),
          findings,
        });
      }),
    );
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = options(process.argv.slice(2));
  if (!args.url) throw Error('Required: --url <preview origin> [--artifact <site directory>]');
  const artifact = args.artifact ?? 'deploy-next';
  const index = readFileSync(`${artifact}/index.html`);
  const inventory = JSON.parse(readFileSync(`${artifact}/worker-inventory.json`));
  const runtime = JSON.parse(
    readFileSync(new URL('../../import/build-inputs.json', import.meta.url)),
  ).runtime;
  const assets = [
    { path: '/', kind: 'html', sha256: digest(index) },
    { path: '/a-static-route', kind: 'html', sha256: digest(index) },
    ...inventory.emitted.map((f) => ({ path: '/' + f.file, kind: 'worker', sha256: f.sha256 })),
    ...runtime.assets.map((f) => ({
      path: '/runtime/' + f.path,
      sha256: f.sha256,
      kind: f.path.endsWith('.wasm') ? 'wasm' : /\.m?js$/.test(f.path) ? 'worker' : 'runtime',
    })),
  ];
  if (!assets.some((a) => a.path === '/runtime/manifest.json'))
    assets.push({
      path: '/runtime/manifest.json',
      kind: 'runtime',
      sha256: runtime.manifest.sha256,
    });
  const results = await checkResponses(args.url, [
    ...new Map(assets.map((a) => [a.path, a])).values(),
  ]);
  for (const result of results) console.log(JSON.stringify(result));
  const failures = results.flatMap((r) => r.findings);
  console.log(JSON.stringify({ checked: results.length, failures: failures.length }));
  process.exitCode = failures.length ? 1 : 0;
}
