#!/usr/bin/env node
// npm name check (bead fm-tohj). For each published workspace package, checks the registry read-only, working name
// first: the unscoped working name when it is free (or already published from this project's repository), otherwise
// `@facemorph-me/<working name>` under the operator-controlled scope, never a confusingly similar unscoped name.
// The chosen name must equal the package.json `name`; the check re-runs immediately before publication and the
// publication step uses its current result. The name fields plus this check's CI output are the record.
//   node scripts/packages/npm-names.mjs [--json] [--registry <url>] [--timeout-ms <n>]
// Exit 0 every package.json name equals its chosen name, 1 a mismatch (the needed rename is named), 2 a registry or
// network error or an unusable fallback scope (an error is never read as "available"), or a usage error.
// Only anonymous HTTP GETs: `<registry>/<name>` (404 free, 200 taken) and `<registry>/-/org/<scope>/package`
// (200 the scope exists as an npm user or organization, 404 {"error":"Scope not found"} it is unclaimed).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org';
export const OPERATOR_SCOPE = 'facemorph-me';
// A registry entry whose repository URL names this organization is this project's own earlier publication.
export const OWN_REPOSITORY = /github\.com[/:]facemorph-me\//i;
// model-conv ships as a pinned container, not an npm package.
export const PACKAGES = ['stylegan-js', 'browser-model-manager', 'cloudflare-model-host'];
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_TIMEOUT_MS = 15_000;

const encodeName = (name) => name.replace('/', '%2f');

async function get(fetchImpl, url, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, error: String(error?.message ?? error) };
  }
}

// One candidate name: available (404), taken (200 by someone else), own (200 from this project's repository),
// or error (anything else, including timeouts). Only `available` and `own` may be chosen.
export async function checkName(name, { fetchImpl, registry, timeoutMs }) {
  const url = `${registry}/${encodeName(name)}`;
  const res = await get(fetchImpl, url, timeoutMs);
  if (res.status === 404) return { name, url, status: 'available' };
  if (res.status === 200) {
    const latest = res.body?.['dist-tags']?.latest;
    const repo = res.body?.versions?.[latest]?.repository ?? res.body?.repository;
    const repoUrl = typeof repo === 'string' ? repo : repo?.url;
    if (repoUrl && OWN_REPOSITORY.test(repoUrl))
      return { name, url, status: 'own', detail: `published from ${repoUrl}` };
    return { name, url, status: 'taken', detail: repoUrl ? `repository ${repoUrl}` : undefined };
  }
  return {
    name,
    url,
    status: 'error',
    detail: res.error ?? `unexpected HTTP ${res.status}`,
  };
}

export async function checkScope(scope, { fetchImpl, registry, timeoutMs }) {
  const url = `${registry}/-/org/${encodeURIComponent(scope)}/package`;
  const res = await get(fetchImpl, url, timeoutMs);
  if (res.status === 200) return { scope, url, status: 'exists' };
  if (res.status === 404) return { scope, url, status: 'missing', detail: 'Scope not found' };
  return { scope, url, status: 'error', detail: res.error ?? `unexpected HTTP ${res.status}` };
}

export function readPackageName(workingName) {
  return JSON.parse(readFileSync(join(REPO, 'packages', workingName, 'package.json'), 'utf8')).name;
}

export async function checkNames({
  fetchImpl = globalThis.fetch,
  registry = REGISTRY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  packages = PACKAGES,
  readName = readPackageName,
} = {}) {
  const ctx = { fetchImpl, registry: registry.replace(/\/+$/, ''), timeoutMs };
  let scope = null; // checked once, only when a fallback is needed
  const results = [];
  for (const working of packages) {
    const packageJsonName = readName(working);
    const candidates = [await checkName(working, ctx)];
    let chosen = null;
    let problem = null;
    const first = candidates[0];
    if (first.status === 'available' || first.status === 'own') chosen = working;
    else if (first.status === 'error') problem = `registry error for ${working}: ${first.detail}`;
    else {
      const fallback = `@${OPERATOR_SCOPE}/${working}`;
      scope ??= await checkScope(OPERATOR_SCOPE, ctx);
      const c = await checkName(fallback, ctx);
      candidates.push(c);
      if (scope.status !== 'exists')
        problem =
          scope.status === 'missing'
            ? `${working} is taken and the operator scope @${OPERATOR_SCOPE} does not exist on npm; create the organization first`
            : `registry error for scope @${OPERATOR_SCOPE}: ${scope.detail}`;
      else if (c.status === 'available' || c.status === 'own') chosen = fallback;
      // Inside the operator's own scope, an existing entry is the operator's earlier publication.
      else if (c.status === 'taken') chosen = fallback;
      else problem = `registry error for ${fallback}: ${c.detail}`;
    }
    const match = chosen !== null && chosen === packageJsonName;
    results.push({
      package: `packages/${working}`,
      workingName: working,
      candidates,
      chosen,
      packageJsonName,
      match,
      ...(problem ? { error: problem } : {}),
      ...(chosen !== null && !match
        ? { rename: `packages/${working}/package.json name ${packageJsonName} -> ${chosen}` }
        : {}),
    });
  }
  const errors = results.some((r) => r.error);
  const exitCode = errors ? 2 : results.every((r) => r.match) ? 0 : 1;
  return {
    check: 'npm-names',
    registry: ctx.registry,
    operatorScope: { scope: OPERATOR_SCOPE, ...(scope ?? { status: 'not-needed' }) },
    checkedAt: new Date().toISOString(),
    packages: results,
    outcome: exitCode === 0 ? 'match' : exitCode === 1 ? 'mismatch' : 'error',
    exitCode,
  };
}

function format(report) {
  const lines = [`npm names (${report.registry}): ${report.outcome}`];
  for (const r of report.packages) {
    const seen = r.candidates.map((c) => `${c.name}=${c.status}`).join(', ');
    lines.push(
      `  ${r.package}: ${seen}; chosen ${r.chosen ?? '-'}; package.json ${r.packageJsonName}`,
    );
    if (r.error) lines.push(`    ERROR ${r.error}`);
    if (r.rename) lines.push(`    RENAME ${r.rename}`);
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  const opts = { ...deps };
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--registry' && argv[i + 1]) opts.registry = argv[++i];
    else if (a === '--timeout-ms' && Number(argv[i + 1]) > 0) opts.timeoutMs = Number(argv[++i]);
    else {
      err(
        `usage: npm-names.mjs [--json] [--registry <url>] [--timeout-ms <n>] (bad argument ${a})\n`,
      );
      return 2;
    }
  }
  const report = await checkNames(opts);
  out((json ? JSON.stringify(report, null, 2) : format(report)) + '\n');
  if (json && report.exitCode !== 0) err(format(report) + '\n');
  return report.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
