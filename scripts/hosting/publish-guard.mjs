#!/usr/bin/env node
// Single-publisher guard (fm-6fx6): exactly one repository publishes a target at a time. Before any `cf deploy` of
// the site or the mirror (scripts/hosting/deploy.mjs, hosting/next-static/promote.py), a publish to `target` is
// refused unless
//   - hosting/publish-targets.json names the target and the kind (site, mirror) being published,
//   - the target is not classicOwned (next.facemorph.me and facemorph.me stay classic's until the candidate-source
//     handover), and shares no Worker, bucket or host with a classicOwned target, and
//   - the repository variable FACEMORPH_PUBLISH_TARGETS (comma-separated target names) names it.
// Pure and local: it reads the configuration file and the environment, and makes no network call.
//   node scripts/hosting/publish-guard.mjs --target <name> --kind site,mirror
// One JSON line; exit 0 allowed, 1 refused, 2 usage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const TARGETS = fileURLToPath(
  new URL('../../hosting/publish-targets.json', import.meta.url),
);
export const VARIABLE = 'FACEMORPH_PUBLISH_TARGETS';
export const KINDS = ['site', 'mirror'];

export const loadTargets = (path = TARGETS) => JSON.parse(readFileSync(path, 'utf8'));

/** The names a variable value allows. Pure. */
export const allowedNames = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** Every identity a publish of `entry` writes to: Workers, buckets, hosts. Pure. */
function identities(entry) {
  const out = new Set();
  if (!entry) return out;
  for (const v of [entry.worker, entry.bucket, entry.domain])
    if (v) out.add(String(v).toLowerCase());
  const host = hostOf(entry.origin);
  if (host) out.add(host.toLowerCase());
  if (entry.diagnostics?.bucket) out.add(String(entry.diagnostics.bucket).toLowerCase());
  return out;
}

/**
 * Whether this repository may publish `kinds` of target `name`. Pure.
 * @returns {{ok: boolean, target: string, kinds: string[], refused: string[]}}
 */
export function check({ config, name, kinds = KINDS, allowed = [] }) {
  const refused = [];
  const target = config?.targets?.[name];
  if (!name || !target)
    refused.push(`target ${JSON.stringify(name)} is not in hosting/publish-targets.json`);
  for (const kind of kinds)
    if (!KINDS.includes(kind)) refused.push(`unknown publish kind ${JSON.stringify(kind)}`);
  if (target) {
    if (target.classicOwned !== false)
      refused.push(`target ${name} is classic-owned until the candidate-source handover`);
    const classic = new Set();
    for (const [other, t] of Object.entries(config.targets))
      if (other !== name && t.classicOwned !== false)
        for (const kind of KINDS) for (const id of identities(t[kind])) classic.add(id);
    for (const kind of kinds) {
      if (!target[kind]) {
        refused.push(`target ${name} has no ${kind}`);
        continue;
      }
      for (const id of identities(target[kind]))
        if (classic.has(id))
          refused.push(`${kind} ${id} of ${name} is a classic-owned Worker, bucket or host`);
    }
    if (!allowed.includes(name)) refused.push(`${VARIABLE} does not name ${name}`);
  }
  return { ok: refused.length === 0, target: name ?? null, kinds: [...kinds], refused };
}

/** Throws unless allowed; for callers that publish next. */
export function assertMayPublish(name, kinds, env = process.env, config = loadTargets()) {
  const r = check({ config, name, kinds, allowed: allowedNames(env[VARIABLE]) });
  if (!r.ok)
    throw Object.assign(new Error(`publish refused: ${r.refused.join('; ')}`), { report: r });
  return config.targets[name];
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { target: { type: 'string' }, kind: { type: 'string' }, config: { type: 'string' } },
  });
  if (!values.target || !values.kind) {
    console.error('usage: publish-guard.mjs --target <name> --kind site,mirror [--config <file>]');
    process.exit(2);
  }
  const r = check({
    config: loadTargets(values.config ?? TARGETS),
    name: values.target,
    kinds: values.kind
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    allowed: allowedNames(process.env[VARIABLE]),
  });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
