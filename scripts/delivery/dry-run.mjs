#!/usr/bin/env node
// Dry run of the delivery runbook (fm-5u9): every command in scripts/delivery/runbook.json runs in its provider's
// dry-run form where one exists (the cf CLI's --dry-run, which shows the request without sending it), and every
// target is probed read-only (cf ... get, gh api GET, ssh with a read-only command, HTTPS HEAD of hosts that do not
// copy on request). Commands with no dry-run form are listed with their read-only probe. A command whose target does
// not exist fails the run. Then every runtime file of each live and rollback artifact is checked against a read-only
// listing of the mirror's R2 bucket: requesting models.facemorph.me itself would copy a missing file into it.
//   node scripts/delivery/dry-run.mjs [--runbook <path>] [--skip-mirror]
// Needs: cf authenticated (CLOUDFLARE_API_TOKEN), gh authenticated, ssh access to triton. Changes nothing.
// One JSON line per command and per mirror path, then a summary; exit 1 on any failure.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

// cf is a root devDependency: npm ci provides it whatever the runner's PATH holds.
const PATH = `${fileURLToPath(new URL('../../node_modules/.bin', import.meta.url))}${delimiter}${process.env.PATH}`;
const run = (cmd, args, timeout = 60_000) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1 << 26,
    env: { ...process.env, PATH },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''),
  };
};
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const unwrap = (d) => (d && typeof d === 'object' && 'result' in d ? d.result : d);

/** Whether a probe's read-only answer shows its target exists as the runbook says. Plain values in, verdict out. */
export function judgeProbe(probe, answer) {
  if (answer.status !== 0)
    return {
      ok: false,
      detail: `probe exited ${answer.status}: ${answer.stderr.trim().slice(0, 200)}`,
    };
  const body = answer.stdout.trim();
  switch (probe.type) {
    case 'cf-get':
    case 'gh': {
      const d = unwrap(json(body));
      if (d === null || d === undefined) return { ok: false, detail: 'no JSON answer' };
      if (probe.expectNonEmpty && !(Array.isArray(d) ? d.length : Object.keys(d).length))
        return { ok: false, detail: 'empty answer: the target does not exist' };
      for (const [k, v] of Object.entries(probe.expect ?? {}))
        if (d[k] !== v)
          return {
            ok: false,
            detail: `${k} is ${JSON.stringify(d[k])}, expected ${JSON.stringify(v)}`,
          };
      if (probe.expectNames) {
        const names = (d.secrets ?? d).map?.((s) => s.name) ?? [];
        const missing = probe.expectNames.filter((n) => !names.includes(n));
        if (missing.length) return { ok: false, detail: `missing ${missing.join(', ')}` };
      }
      return { ok: true, detail: 'exists' };
    }
    case 'ssh': {
      const ok = probe.expectPrefix ? body.startsWith(probe.expectPrefix) : body === probe.expect;
      const want = probe.expectPrefix ? `${probe.expectPrefix}…` : probe.expect;
      return ok
        ? { ok: true, detail: body }
        : {
            ok: false,
            detail: `answered ${JSON.stringify(body)}, expected ${JSON.stringify(want)}`,
          };
    }
    case 'http': {
      const code = Number(body.split(' ')[0]);
      if (!(code >= 100)) return { ok: false, detail: `no HTTP answer (${body})` };
      if (probe.expectStatus && !probe.expectStatus.includes(code))
        return { ok: false, detail: `status ${code}` };
      return { ok: true, detail: `status ${code}` };
    }
    default:
      return { ok: false, detail: `unknown probe type ${probe.type}` };
  }
}

/** What a dry run says it would change. */
export function judgeDryRun(answer) {
  const d = json(answer.stdout.trim());
  if (answer.status !== 0 || !d?.method || !d?.url)
    return {
      ok: false,
      wouldChange: null,
      detail: `dry run exited ${answer.status}: ${answer.stderr.trim().slice(0, 200)}`,
    };
  return { ok: true, wouldChange: `${d.method} ${d.url}`, detail: 'dry run' };
}

export function probeAnswer(probe, runProbe = run) {
  switch (probe.type) {
    case 'cf-get': {
      // The API answers 5xx now and then; one retry, then the answer stands.
      const first = runProbe('cf', probe.argv);
      return first.status !== 0 &&
        /\bStatus code: 5\d\d\b|\b5\d\d [^\r\n]* · HTTP\b/.test(first.stderr)
        ? runProbe('cf', probe.argv)
        : first;
    }
    case 'gh':
      return runProbe('gh', ['api', probe.path]);
    case 'ssh':
      return runProbe('ssh', [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        probe.host,
        ...probe.argv.map((a) => `'${a.replaceAll("'", "'\\''")}'`),
      ]);
    case 'http':
      return runProbe('curl', [
        '-s',
        '-o',
        '/dev/null',
        '-I',
        '-w',
        '%{http_code}',
        '--max-time',
        '20',
        probe.url,
      ]);
    default:
      return { status: 1, stdout: '', stderr: `unknown probe type ${probe.type}` };
  }
}

/** Every command entry of the runbook, flattened: retirement items, actions and the names host. */
export function entries(runbook) {
  const out = [];
  for (const r of runbook.retirement)
    out.push({
      id: r.id,
      command: r.command,
      target: r.target,
      dryRun: r.dryRun,
      noDryRun: r.noDryRun,
      probe: r.probe,
    });
  for (const a of runbook.actions)
    if (a.id !== 'names-redirect')
      // its commands are the names host's, below
      out.push({
        id: `action:${a.id}`,
        command: a.commands.join(' '),
        target: a.title,
        dryRun: a.dryRun ?? null,
        noDryRun: a.dryRun ? undefined : 'console or workflow step',
        probe: a.probe,
      });
  const n = runbook.namesHost;
  out.push({
    id: 'names-redirect',
    command: n.redirect.join(' && '),
    target: n.before.dns,
    dryRun: n.dryRun,
    probe: n.probe,
  });
  return out;
}

/** The runtime files of a manifest: every HTTPS runtime URL, a chunked asset by its chunks, never a directory. */
export function runtimeFiles(manifest) {
  const urls = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (Array.isArray(v.chunks) && v.chunks.length) return v.chunks.forEach(walk);
      Object.values(v).forEach(walk);
    } else if (
      typeof v === 'string' &&
      v.startsWith('https://next.facemorph.me/runtime/') &&
      !v.endsWith('/')
    )
      urls.add(new URL(v).pathname.slice(1));
  };
  walk(manifest);
  return [...urls].sort();
}

/** Which runtime files the mirror holds, from a read-only listing of its bucket (requesting the mirror would copy
 * a missing file into it). */
async function mirrorPaths(runbook) {
  const listed = run(
    'cf',
    [
      'r2',
      'objects',
      'list',
      '--bucket-name',
      runbook.mirror.bucket,
      '--prefix',
      'runtime/',
      '--per-page',
      '1000',
    ],
    120_000,
  );
  const objects = unwrap(json(listed.stdout));
  if (listed.status !== 0 || !Array.isArray(objects))
    return [
      {
        mirror: runbook.mirror.bucket,
        ok: false,
        detail: `bucket listing failed: ${listed.stderr.trim().slice(0, 200)}`,
      },
    ];
  if (objects.length >= 1000)
    return [
      {
        mirror: runbook.mirror.bucket,
        ok: false,
        detail: 'listing reached its page size: paginate before trusting it',
      },
    ];
  const held = new Set(objects.map((o) => o.key));
  const lines = [];
  for (const { artifact, manifest } of runbook.mirror.manifests) {
    const res = await fetch(manifest);
    if (!res.ok) {
      lines.push({ mirror: artifact, path: manifest, ok: false, detail: `manifest ${res.status}` });
      continue;
    }
    const mirrored = (key) => runbook.mirror.prefixes.some((p) => key.startsWith(p));
    for (const key of runtimeFiles(await res.json()).filter(mirrored))
      lines.push({ mirror: artifact, path: `/${key}`, held: held.has(key), ok: held.has(key) });
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const path = args.includes('--runbook')
    ? args[args.indexOf('--runbook') + 1]
    : new URL('runbook.json', import.meta.url);
  const runbook = JSON.parse(readFileSync(path, 'utf8'));
  let failed = 0;
  for (const e of entries(runbook)) {
    const probe = judgeProbe(e.probe, probeAnswer(e.probe));
    const dry = e.dryRun ? judgeDryRun(run('cf', e.dryRun.argv)) : null;
    const ok = probe.ok && (dry ? dry.ok : true);
    if (!ok) failed++;
    console.log(
      JSON.stringify({
        id: e.id,
        command: e.command,
        target: e.target,
        exit: ok ? 0 : 1,
        wouldChange: dry ? dry.wouldChange : null,
        dryRun: dry ? dry.detail : `no dry-run form: ${e.noDryRun}`,
        probe: probe.detail,
      }),
    );
  }
  let mirrorMissing = 0;
  if (!args.includes('--skip-mirror'))
    for (const line of await mirrorPaths(runbook)) {
      if (!line.ok) mirrorMissing++;
      console.log(JSON.stringify(line));
    }
  console.log(
    JSON.stringify({ summary: { commands: entries(runbook).length, failed, mirrorMissing } }),
  );
  process.exit(failed || mirrorMissing ? 1 : 0);
}
