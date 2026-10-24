#!/usr/bin/env node
// Cutover annotation (fm-tayo): one Grafana annotation on metrics.facemorph.me per visitor-changing delivery action,
// tagged facemorph-cutover plus the action name (tag-scoped, so no dashboard has to exist), with hostname, artifact
// digest and the CI run URL. Best effort: a missing token or a failed request is logged and never fails or undoes the
// delivery, so this always exits 0. Token: GRAFANA_ANNOTATION_TOKEN (a Grafana service-account token held as a CI
// secret).
//   node scripts/delivery/annotate-cutover.mjs --action <name> --host <hostname> --digest <sha256>
// One JSON line: action, host, digest, HTTP status, annotation id.
import { fileURLToPath } from 'node:url';

export const GRAFANA = 'https://metrics.facemorph.me';
const FLAGS = { action: 'action', host: 'host', digest: 'digest' };

export function parseAnnotateArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !(flag in FLAGS))
      throw new Error(`unknown argument ${argv[i]}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${flag} needs a value`);
    o[FLAGS[flag]] = value;
  }
  for (const k of Object.keys(FLAGS)) if (!o[k]) throw new Error(`--${k} is required`);
  return o;
}

/** The annotation body: tags, text naming host, digest and run, and the time in milliseconds. */
export function annotation({ action, host, digest }, runUrl, time) {
  return {
    time,
    tags: ['facemorph-cutover', action],
    text: `${action}: ${host} now serves ${digest}${runUrl ? ` (${runUrl})` : ''}`,
  };
}

export async function annotate(o, env = process.env) {
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : null;
  const line = {
    action: o.action,
    host: o.host,
    digest: o.digest,
    status: null,
    annotationId: null,
  };
  if (!env.GRAFANA_ANNOTATION_TOKEN)
    return { ...line, note: 'no GRAFANA_ANNOTATION_TOKEN: not annotated' };
  try {
    const res = await fetch(`${GRAFANA}/api/annotations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GRAFANA_ANNOTATION_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(annotation(o, runUrl, Date.now())),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    return { ...line, status: res.status, annotationId: body?.id ?? null };
  } catch (e) {
    return { ...line, note: `not annotated: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let o;
  try {
    o = parseAnnotateArgs(process.argv.slice(2));
  } catch (e) {
    console.log(JSON.stringify({ note: `not annotated: ${e.message}` }));
    process.exit(0);
  }
  console.log(JSON.stringify(await annotate(o)));
  process.exit(0);
}
