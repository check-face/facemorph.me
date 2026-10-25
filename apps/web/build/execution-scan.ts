// Built-artifact scan (fm-fy2.19): a destination-labelled deploy-next/ carries no WebGL execution path and no native
// install/availability recommendation. The control-labelled artifact is skipped with a logged reason: WebGL and the
// Tauri bridge there are control facts, not regressions. An unidentified or inconsistent artifact fails closed.
// Source-level scans stay in test/build/webgl-removal.test.ts and native-retirement.test.ts. Script usage:
// node apps/web/build/execution-scan.ts [artifact-dir, default repository root] -> exit 1 on any finding.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- build-next.mjs has no declarations; readIdentity's result is typed where it is used
import { readIdentity } from '../../../scripts/import/build-next.mjs';

const Q = '[`\'"]';
export const WEBGL_EXECUTION: readonly RegExp[] = [
  new RegExp(`getContext\\(${Q}(experimental-)?webgl2?${Q}`),
  /createHybridSession/,
  new RegExp(`executionProviders:\\[[^\\]]{0,80}${Q}webgl${Q}`),
  /\bort\.webgl\b/,
];
export const NATIVE_RECOMMENDATION: readonly RegExp[] = [
  /__TAURI__/,
  /native (install|cpu processing|app)\b/i,
  /desktop (app|package|preview|install|shell|version)\b/i,
  /\binstaller\b/i,
];

export type Decision =
  | { readonly action: 'scan' }
  | { readonly action: 'skip'; readonly reason: string }
  | { readonly action: 'fail'; readonly reason: string };

/** What to do with an artifact, from its identity as readIdentity reports it. */
export function decide(
  identity: { label?: string } | null,
  findings: readonly unknown[],
): Decision {
  if (!identity || findings.length)
    return {
      action: 'fail',
      reason: `artifact identity has findings: ${JSON.stringify(findings)}`,
    };
  const label = identity.label ?? '';
  if (label === 'destination') return { action: 'scan' };
  if (label.startsWith('control'))
    return {
      action: 'skip',
      reason: `skipped: control-labelled artifact (${label}); WebGL there is a control fact`,
    };
  return { action: 'fail', reason: `unknown artifact label: ${JSON.stringify(label)}` };
}

function texts(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) texts(path, out);
    else if (/\.(m?js|html)$/.test(name)) out.push(path);
  }
  return out;
}

/** Findings in an artifact's executable text (JS, MJS, HTML), one per file and pattern. */
export function scanFiles(dir: string): string[] {
  const findings: string[] = [];
  for (const file of texts(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const [kind, patterns] of [
      ['WebGL execution', WEBGL_EXECUTION],
      ['native recommendation', NATIVE_RECOMMENDATION],
    ] as const)
      for (const p of patterns) {
        const m = p.exec(text);
        if (m)
          findings.push(
            `${relative(dir, file)}: ${kind} /${p.source}/ at ${JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30))}`,
          );
      }
  }
  return findings;
}

/** The artifact directory holds next-site-identity.json and deploy-next/. */
export function scanArtifact(dir: string): { decision: Decision; findings: string[] } {
  const { identity, findings: identityFindings } = readIdentity(dir) as {
    identity: { label?: string } | null;
    findings: unknown[];
  };
  const decision = decide(identity, identityFindings);
  if (decision.action === 'fail') return { decision, findings: [decision.reason] };
  if (decision.action === 'skip') return { decision, findings: [] };
  return { decision, findings: scanFiles(join(dir, 'deploy-next')) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../../../', import.meta.url));
  const { decision, findings } = scanArtifact(dir);
  if (decision.action === 'skip') console.log(JSON.stringify({ skipped: decision.reason }));
  for (const f of findings) console.log(JSON.stringify({ finding: f }));
  console.log(
    JSON.stringify({ summary: { decision: decision.action, findings: findings.length } }),
  );
  process.exitCode = findings.length ? 1 : 0;
}
