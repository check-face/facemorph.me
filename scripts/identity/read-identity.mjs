#!/usr/bin/env node
// Identity reader (fm-a4b, plan: identity.map). Read-only: `gh api` GETs, `git ls-remote`, `curl`.
// Reads every repository (by stable ID, so it survives the organization rename), live host,
// served artifact and GitHub-side integration named in identities.json and integrations.json, and
// writes one JSON line per value: identity, field, value, command, ISO timestamp, exit code.
// A served artifact's source commit is recorded only when a deploy record attests it; otherwise
// `unknown` (or unverified when this credential cannot read the record). Secret and variable values
// are never read into the output, only their names.
//
//   node read-identity.mjs              read, diff against identity-values.jsonl, print the drift
//   node read-identity.mjs --write      read and replace identity-values.jsonl (deliberate refresh)
//   node read-identity.mjs --print      read and print the fresh values
//   --only <prefix>   limit to identities starting with <prefix> (repeatable)
//   --values <file>   compare against another values file
// Exit: 0 no drift, 3 drift listed, 1 failure. A value this credential cannot read (HTTP 403, no
// network) is reported `unverified`, never as drift.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VALUES_FILE = resolve(here, 'identity-values.jsonl');

const quote = (a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const shell = (argv) => argv.map(quote).join(' ');
// Inverse of shell() for one recorded command (no pipes): split on spaces outside single quotes.
export function unshell(command) {
  const argv = [];
  let cur = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === ' ') {
      if (cur !== null) argv.push(cur);
      cur = null;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      cur = (cur ?? '') + command.slice(i + 1, end);
      i = end;
      if (command.startsWith("\\''", i + 1)) {
        cur += "'";
        i += 2;
      }
    } else cur = (cur ?? '') + c;
  }
  if (cur !== null) argv.push(cur);
  return argv;
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// Branch names keep their `/` in query strings (GitHub accepts it), so commands stay readable.
const q = (s) => encodeURIComponent(s).replace(/%2F/g, '/');

function run(argv) {
  return new Promise((done) => {
    execFile(argv[0], argv.slice(1), { encoding: 'buffer', maxBuffer: 256 << 20, timeout: 120_000 }, (err, stdout, stderr) => {
      done({ exit: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: stderr.toString('utf8'), at: new Date().toISOString() });
    });
  });
}

// One-line error description without echoing anything that could carry a credential.
function errorOf(r) {
  const http = r.stderr.match(/HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;
  const curl = r.stderr.match(/curl: \((\d+)\)/);
  if (curl) return `curl exit ${curl[1]}`;
  return `exit ${r.exit}`;
}

// A recorder collects value lines for one identity.
function recorder(identity, out) {
  return (field, value, r, command, extra = {}) => {
    const line = { identity, field, value, command, at: r.at, exit: r.exit, ...extra };
    if (value === null && r.exit !== 0 && !line.error) line.error = errorOf(r);
    out.push(line);
    return line;
  };
}

// `gh api` returning JSON; 404 is a value ("none"), any other failure leaves the value null.
async function ghJson(rec, field, argv, pick = (x) => x) {
  const r = await run(argv);
  const command = shell(argv);
  if (r.exit === 0) {
    const text = r.stdout.toString('utf8').trim();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {} // a --jq scalar prints raw text
    const value = pick(parsed);
    rec(field, value, r, command);
    return value;
  }
  if (/HTTP 404/.test(r.stderr)) {
    rec(field, 'none (HTTP 404)', r, command);
    return undefined;
  }
  rec(field, null, r, command);
  return undefined;
}

async function readRepository(spec, out) {
  const rec = recorder(spec.identity, out);
  const argv = ['gh', 'api', `repositories/${spec.id}`, '--jq', '{id,full_name,html_url,default_branch,archived,visibility,homepage}'];
  const r = await run(argv);
  const command = shell(argv);
  if (r.exit !== 0) {
    rec('repo.id', null, r, command);
    return;
  }
  const repo = JSON.parse(r.stdout.toString('utf8'));
  for (const k of ['id', 'full_name', 'html_url', 'default_branch', 'archived', 'visibility', 'homepage']) rec(`repo.${k}`, repo[k] ?? null, r, command);
  for (const b of spec.branches) {
    const lsArgv = ['git', 'ls-remote', `${repo.html_url}.git`, `refs/heads/${b}`];
    const ls = await run(lsArgv);
    const sha = ls.exit === 0 ? ls.stdout.toString('utf8').split(/\s/)[0] || 'absent' : null;
    rec(`branch.${b}`, sha, ls, shell(lsArgv));
  }
  // GitHub-side integrations. Names only: secret, variable and hook-URL values never leave the API.
  const api = (path, jq) => ['gh', 'api', `repositories/${spec.id}/${path}`, '--jq', jq];
  await ghJson(rec, 'hooks', api('hooks', '[.[]|{host:(.config.url|capture("^[a-z]+://(?<h>[^/:?#]+)").h),events,active}]'));
  await ghJson(rec, 'actions.secrets', api('actions/secrets', '[.secrets[].name]'));
  await ghJson(rec, 'actions.variables', api('actions/variables', '[.variables[].name]'));
  await ghJson(rec, 'actions.permissions', api('actions/permissions', '{enabled,allowed_actions}'));
  await ghJson(rec, 'actions.oidc-sub', api('actions/oidc/customization/sub', '{use_default,sub_claim_prefix}'));
  await ghJson(rec, 'actions.runners', api('actions/runners', '[.runners[]|{name,labels:([.labels[].name]|sort)}]|sort_by(.name)'));
  await ghJson(rec, 'actions.workflows', api('actions/workflows', '[.workflows[]|{path,state}]|sort_by(.path)'));
  await ghJson(rec, 'deploy-keys', api('keys', '[.[]|{title,read_only}]'));
  await ghJson(rec, 'pages', api('pages', '{cname,build_type,source,status}'));
  const envs = await ghJson(rec, 'environments', api('environments', '[.environments[]|{name,protection:[.protection_rules[]?.type],branch_policy:.deployment_branch_policy}]'));
  for (const e of envs || []) await ghJson(rec, `environment.${e.name}.secrets`, api(`environments/${q(e.name)}/secrets`, '[.secrets[].name]'));
}

async function readOrganization(spec, out) {
  const rec = recorder(spec.identity, out);
  if (spec.availabilityOnly) {
    // users/<login> answers for users and organizations alike; 404 means not taken, not reserved.
    await ghJson(rec, 'login.taken', ['gh', 'api', `users/${spec.login}`, '--jq', '{login,type}']);
    return;
  }
  const o = (path, jq) => ['gh', 'api', `orgs/${spec.login}${path}`, '--jq', jq];
  await ghJson(rec, 'org', o('', '{id,login}'));
  await ghJson(rec, 'installations', o('/installations', '[.installations[]|{app:.app_slug,selection:.repository_selection}]|sort_by(.app)'));
  await ghJson(rec, 'actions.secrets', o('/actions/secrets', '[.secrets[].name]'));
  await ghJson(rec, 'actions.variables', o('/actions/variables', '[.variables[].name]'));
  await ghJson(rec, 'actions.runners', o('/actions/runners', '[.runners[]|{name,labels:([.labels[].name]|sort)}]|sort_by(.name)'));
  await ghJson(rec, 'packages.container', ['gh', 'api', `orgs/${spec.login}/packages?package_type=container`, '--jq', '[.[].name]']);
  await ghJson(rec, 'hooks', o('/hooks', '[.[]|{host:(.config.url|capture("^[a-z]+://(?<h>[^/:?#]+)").h),events,active}]'));
}

async function readContents(repoId, path, ref) {
  const argv = ['gh', 'api', `repositories/${repoId}/contents/${path}?ref=${q(ref)}`, '--jq', '.content'];
  const r = await run(argv);
  const text = r.exit === 0 ? Buffer.from(r.stdout.toString('utf8').replace(/\\n|\s/g, ''), 'base64').toString('utf8') : null;
  return { r, text, command: shell(argv) };
}

async function readSelfHost(spec, out) {
  const rec = recorder(spec.identity, out);
  const { r, text, command } = await readContents(spec.repoId, spec.sourcePath, spec.ref);
  if (text === null) {
    rec('frontend.revision', null, r, command);
    return;
  }
  const source = JSON.parse(text);
  rec('frontend.repository', source.repository, r, command);
  rec('frontend.revision', source.revision, r, command);
  // The pin is recorded as an original URL; it must still resolve in classic by repository ID.
  await ghJson(rec, 'frontend.revision.resolves-in-classic', ['gh', 'api', `repositories/${spec.repoId}/commits/${source.revision}`, '--jq', '.sha'], (sha) => sha === source.revision);
}

function parseHead(buf) {
  const text = buf.toString('utf8');
  const blocks = text.split(/\r?\n\r?\n/).filter((b) => b.startsWith('HTTP/'));
  const last = blocks.at(-1) ?? '';
  const status = Number(last.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1] ?? 0);
  const header = (name) => last.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'im'))?.[1] ?? null;
  return { status, server: header('server'), location: header('location') };
}

// The CNAME when there is one (its target is the identity; providers such as Vercel rotate the
// addresses behind it), otherwise the A records.
async function readDns(rec, host) {
  const query = async (type) => {
    const argv = ['curl', '-sS', '-m', '20', '-H', 'accept: application/dns-json', `https://cloudflare-dns.com/dns-query?name=${host}&type=${type}`];
    const r = await run(argv);
    const want = type === 'A' ? 1 : 5;
    const answers = r.exit === 0 ? (JSON.parse(r.stdout.toString('utf8')).Answer ?? []).filter((a) => a.type === want).map((a) => a.data.replace(/\.$/, '')).sort() : null;
    return { r, command: shell(argv), answers };
  };
  const c = await query('CNAME');
  const cname = c.answers ? (c.answers[0] ?? 'none') : null;
  rec('dns.cname', cname, c.r, c.command, { host });
  if (cname !== 'none') return;
  const a = await query('A');
  rec('dns.a', a.answers, a.r, a.command, { host });
}

// Same-origin scripts and stylesheets named by the page, fetched and hashed.
function assetPaths(html) {
  const paths = new Set();
  for (const m of html.matchAll(/(?:src|href)=(["'])([^"']+\.(?:js|mjs|css))\1/g)) {
    if (!/^(?:https?:)?\/\//.test(m[2])) paths.add(m[2].replace(/^\.?\//, ''));
  }
  return [...paths].sort();
}

async function fetchArtifact(base) {
  const argv = ['curl', '-sS', '-f', '-m', '30', base];
  const page = await run(argv);
  if (page.exit !== 0) return { page, command: `${shell(argv)} | sha256sum` };
  const html = page.stdout.toString('utf8');
  const assets = {};
  const bodies = {};
  for (const p of assetPaths(html)) {
    const r = await run(['curl', '-sS', '-f', '-m', '60', new URL(p, base).href]);
    assets[p] = r.exit === 0 ? sha256(r.stdout) : `fetch failed (${errorOf(r)})`;
    if (r.exit === 0) bodies[p] = r.stdout;
  }
  return { page, html, htmlSha: sha256(page.stdout), assets, bodies, command: `${shell(argv)} | sha256sum; same-origin script/stylesheet: curl -sS -f <url> | sha256sum` };
}

async function latestRun(rec, repoId, workflow, branch) {
  const argv = ['gh', 'api', `repositories/${repoId}/actions/workflows/${workflow}/runs?branch=${q(branch)}&event=push&status=success&per_page=1`, '--jq', '.workflow_runs[0]|{id,head_sha,created_at}'];
  const run0 = await ghJson(rec, 'deploy.record.run', argv);
  if (!run0?.id) return undefined;
  const jobsArgv = ['gh', 'api', `repositories/${repoId}/actions/runs/${run0.id}/jobs`, '--jq', '[.jobs[]|{id,name,conclusion}]'];
  const r = await run(jobsArgv);
  const jobs = r.exit === 0 ? JSON.parse(r.stdout.toString('utf8')) : null;
  rec('deploy.record.jobs', jobs && jobs.map(({ name, conclusion }) => ({ name, conclusion })), r, shell(jobsArgv));
  return { ...run0, jobs: jobs ?? [], jobsRun: r, jobsCommand: shell(jobsArgv) };
}

// Compare a deployment URL's bytes with the live page: same HTML and same same-origin assets.
async function sameBytes(live, deploymentUrl) {
  const dep = await fetchArtifact(deploymentUrl);
  if (dep.page.exit !== 0) return { equal: false, why: `deployment URL unreadable (${errorOf(dep.page)})`, dep };
  const equal = dep.htmlSha === live.htmlSha && JSON.stringify(dep.assets) === JSON.stringify(live.assets);
  return { equal, why: equal ? 'byte-identical HTML and same-origin assets' : 'bytes differ from the live page', dep };
}

async function readHost(spec, out) {
  const rec = recorder(spec.identity, out);
  const host = spec.dnsHost ?? new URL(spec.url).hostname;
  const headArgv = ['curl', '-sS', '-I', '-m', '20', spec.url];
  const head = await run(headArgv);
  const h = head.exit === 0 ? parseHead(head.stdout) : null;
  rec('http.status', h ? h.status : null, head, shell(headArgv));
  rec('http.server', h ? h.server : null, head, shell(headArgv));
  if (h?.location) rec('http.location', h.location.replace(/[?#].*$/, ''), head, shell(headArgv));
  await readDns(rec, host);

  if (spec.pagesRepoId) await ghJson(rec, 'github-pages', ['gh', 'api', `repositories/${spec.pagesRepoId}/pages`, '--jq', '{cname,build_type,source,status}']);

  if (spec.manifest || spec.catalogue) {
    const argv = ['curl', '-sS', '-f', '-m', '30', spec.url];
    const r = await run(argv);
    const doc = r.exit === 0 ? JSON.parse(r.stdout.toString('utf8')) : null;
    const cmd = shell(argv);
    rec(spec.manifest ? 'manifest.sha256' : 'catalogue.sha256', doc ? sha256(r.stdout) : null, r, `${cmd} | sha256sum`);
    if (spec.manifest && doc) {
      rec('manifest.bundleVersion', doc.bundleVersion ?? null, r, cmd);
      rec('manifest.modelSourceSha256', doc.modelSourceSha256 ?? null, r, cmd);
      rec('manifest.runtimeVersion', doc.runtime?.version ?? null, r, cmd);
    }
    if (spec.catalogue && doc) {
      rec('catalogue.version', doc.version ?? null, r, cmd);
      rec('catalogue.names', doc.names?.length ?? null, r, cmd);
      rec('catalogue.previewOrigin', doc.origin ?? null, r, cmd);
      const latent = doc.names?.[0]?.latent?.url;
      if (latent) {
        const lArgv = ['curl', '-sS', '-I', '-m', '20', latent];
        const l = await run(lArgv);
        rec('catalogue.latentOrigin', new URL(latent).origin, r, cmd);
        rec('catalogue.latentSample.status', l.exit === 0 ? parseHead(l.stdout).status : null, l, shell(lArgv));
      }
    }
  }

  if (spec.mirrorOf) {
    const argv = ['curl', '-sS', '-f', '-m', '30', spec.mirrorOf];
    const r = await run(argv);
    const doc = r.exit === 0 ? JSON.parse(r.stdout.toString('utf8')) : null;
    const first = doc?.runtime?.assets?.find((a) => /\/runtime\/assets\//.test(a.url));
    if (first) {
      const mirrored = new URL(new URL(first.url).pathname, spec.url).href;
      const mArgv = ['curl', '-sS', '-I', '-m', '30', mirrored];
      const m = await run(mArgv);
      rec('mirror.sample.status', m.exit === 0 ? parseHead(m.stdout).status : null, m, `${shell(argv)} (first runtime asset), then ${shell(mArgv)}`);
    } else rec('mirror.sample.status', null, r, shell(argv));
  }

  if (!spec.artifact) return;
  const live = await fetchArtifact(spec.url);
  if (live.page.exit !== 0) {
    rec('artifact.html.sha256', null, live.page, live.command);
    return;
  }
  rec('artifact.html.sha256', live.htmlSha, live.page, live.command);
  rec('artifact.assets', live.assets, live.page, live.command);
  let embeddedSource = null;
  if (spec.embedded) {
    const app = Object.keys(live.bodies).find((p) => /^app\.[0-9a-f]+\.js$/.test(p));
    const text = app ? live.bodies[app].toString('utf8') : '';
    const pick = (re) => text.match(new RegExp(re))?.[1] ?? null;
    embeddedSource = pick(spec.embedded.sourceCommit);
    rec('artifact.buildId', pick(spec.embedded.buildId), live.page, `${live.command}; build id read from ${app}`);
    rec('artifact.embeddedSourceCommit', embeddedSource, live.page, `${live.command}; FACEMORPH_SOURCE_SHA read from ${app}`);
  }

  const d = spec.deployRecord;
  if (!d) return;
  let source = 'unknown';
  let attestation = 'no deploy record attests the served bytes';
  let proof = live.page;
  let proofCommand = live.command;
  if (d.kind === 'wrangler-workflow') {
    const rr = await latestRun(rec, d.repoId, d.workflow, d.branch);
    if (rr) {
      const job = rr.jobs.find((j) => j.name === d.job);
      if (job?.conclusion === 'success' && embeddedSource === rr.head_sha) {
        source = rr.head_sha;
        attestation = `${d.workflow} run ${rr.id} deployed ${rr.head_sha} (its deploy job checks the live site serves the built app bundle) and the live bundle embeds that commit`;
        proof = rr.jobsRun;
        proofCommand = rr.jobsCommand;
      } else attestation = `latest successful ${d.workflow} run ${rr.id} (${rr.head_sha}) does not match the commit embedded in the live bundle (${embeddedSource ?? 'none'})`;
    }
  } else if (d.kind === 'vercel-cli-workflow') {
    const rr = await latestRun(rec, d.repoId, d.workflow, d.branch);
    const job = rr?.jobs?.[0];
    if (rr && job) {
      // Logs carry terminal escapes; gh 2.103+ prints them only with --allow-escape-sequences.
      let logArgv = ['gh', 'api', '--allow-escape-sequences', `repositories/${d.repoId}/actions/jobs/${job.id}/logs`];
      let log = await run(logArgv);
      if (log.exit !== 0 && /unknown flag/.test(log.stderr)) {
        logArgv = logArgv.filter((a) => a !== '--allow-escape-sequences');
        log = await run(logArgv);
      }
      const url = log.exit === 0 ? log.stdout.toString('utf8').match(new RegExp(d.logPattern))?.[1] : null;
      rec('deploy.record.deploymentUrl', url ?? null, log, `${shell(logArgv)} | grep 'Production deployment:'`);
      if (url) {
        const cmp = await sameBytes(live, url);
        rec('deploy.record.bytesMatchLive', cmp.equal, cmp.dep.page, `${cmp.dep.command}; compared with the live page`);
        if (cmp.equal) {
          source = rr.head_sha;
          attestation = `${d.workflow} run ${rr.id} production deployment ${url} built from ${rr.head_sha} serves ${cmp.why} to the live page`;
          proof = cmp.dep.page;
          proofCommand = cmp.dep.command;
        } else attestation = `${d.workflow} run ${rr.id} deployment ${url}: ${cmp.why}`;
      }
    }
  } else if (d.kind === 'github-deployment') {
    const dep = await ghJson(rec, 'deploy.record.deployment', ['gh', 'api', `repositories/${d.repoId}/deployments?environment=${q(d.environment)}&per_page=1`, '--jq', '.[0]|{id,sha,created_at,creator:.creator.login}']);
    if (dep) {
      const st = await ghJson(rec, 'deploy.record.status', ['gh', 'api', `repositories/${d.repoId}/deployments/${dep.id}/statuses`, '--jq', '.[0]|{state,environment_url}']);
      if (st?.environment_url) {
        const cmp = await sameBytes(live, st.environment_url);
        rec('deploy.record.bytesMatchLive', cmp.equal, cmp.dep.page, `${cmp.dep.command}; compared with the live page`);
        if (cmp.equal) {
          source = dep.sha;
          attestation = `GitHub deployment ${dep.id} (${d.environment}, by ${dep.creator}) of ${dep.sha} at ${st.environment_url} serves ${cmp.why} to the live page`;
          proof = cmp.dep.page;
          proofCommand = cmp.dep.command;
        } else attestation = `GitHub deployment ${dep.id} at ${st.environment_url}: ${cmp.why}`;
      }
    }
  }
  // A deploy-record read this credential could not make leaves the source unverified, not unknown.
  const blocked = out.find((v) => v.identity === spec.identity && v.field.startsWith('deploy.record') && v.value === null && v.exit !== 0);
  if (source === 'unknown' && blocked) {
    const extra = { error: `${blocked.field} unreadable (${blocked.error})` };
    rec('source.commit', null, { exit: blocked.exit, at: blocked.at }, blocked.command, extra);
    rec('source.attestation', null, { exit: blocked.exit, at: blocked.at }, blocked.command, extra);
    return;
  }
  rec('source.commit', source, proof, proofCommand);
  rec('source.attestation', attestation, proof, proofCommand);
}

// Each publisher binding in integrations.json with a `workflow` check: the workflow file at its
// ref must still contain the trigger, deploy command and credential names recorded for it.
async function readIntegrationChecks(integrations, out) {
  for (const i of integrations) {
    if (!i.check?.workflow) continue;
    const rec = recorder(`integration:${i.id}`, out);
    const w = i.check.workflow;
    const { r, text, command } = await readContents(w.repoId, w.path, w.ref);
    if (text === null) {
      rec('workflow.check', null, r, command);
      continue;
    }
    const missing = w.contains.filter((s) => !text.includes(s));
    rec('workflow.check', missing.length ? `missing: ${JSON.stringify(missing)}` : 'pass', r, command);
  }
}

export async function readAll({ only = [] } = {}) {
  const spec = JSON.parse(readFileSync(resolve(here, 'identities.json'), 'utf8'));
  const integrations = JSON.parse(readFileSync(resolve(here, 'integrations.json'), 'utf8')).integrations;
  const want = (id) => !only.length || only.some((p) => id.startsWith(p));
  const out = [];
  const jobs = [
    ...spec.repositories.filter((s) => want(s.identity)).map((s) => () => readRepository(s, out)),
    ...spec.organizations.filter((s) => want(s.identity)).map((s) => () => readOrganization(s, out)),
    ...(want(spec.selfHost.identity) ? [() => readSelfHost(spec.selfHost, out)] : []),
    ...spec.hosts.filter((s) => want(s.identity)).map((s) => () => readHost(s, out)),
    ...(want('integration:') ? [() => readIntegrationChecks(integrations, out)] : []),
  ];
  // A few identities at a time; each reads its own commands in order. A reader that throws is
  // recorded (error class only, never the text it was parsing) and the others carry on.
  const queue = [...jobs];
  const failures = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        await job();
      } catch (e) {
        failures.push(`${e.name} at ${String(e.stack).split('\n')[1]?.trim() ?? 'unknown'}`);
      }
    }
  }));
  return Object.assign(sortValues(out), { failures });
}

export const keyOf = (v) => `${v.identity}\u0000${v.field}`;
export const sortValues = (values) => [...values].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// Pure: compare checked-in values with a fresh read. A fresh value that could not be read with
// this credential is `unverified`, not drift.
export function diffValues(checkedIn, fresh) {
  const was = new Map(checkedIn.map((v) => [keyOf(v), v]));
  const now = new Map(fresh.map((v) => [keyOf(v), v]));
  const result = { unchanged: [], drift: [], unverified: [], notRead: [], added: [] };
  for (const [k, old] of was) {
    const cur = now.get(k);
    if (!cur) result.notRead.push({ identity: old.identity, field: old.field });
    else if (cur.value === null && cur.exit !== 0 && old.value !== null) result.unverified.push({ identity: old.identity, field: old.field, error: cur.error, command: cur.command });
    else if (canonical(cur.value) === canonical(old.value)) result.unchanged.push({ identity: old.identity, field: old.field });
    else result.drift.push({ identity: old.identity, field: old.field, was: old.value, now: cur.value, wasAt: old.at, nowAt: cur.at, command: cur.command });
  }
  for (const [k, cur] of now) if (!was.has(k)) result.added.push({ identity: cur.identity, field: cur.field });
  return result;
}

export const readValues = (file = VALUES_FILE) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// Credential-shaped strings: known token prefixes, private keys, JWTs, and any long token mixing
// upper case, lower case and digits (digests, commits and IDs here are lower-case hex or numeric).
const SECRET_SHAPES = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['mixed-token', /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g],
];

export function findSecrets(text, { known = [] } = {}) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const [kind, re] of SECRET_SHAPES) for (const m of line.matchAll(re)) found.push({ line: i + 1, kind, length: m[0].length });
    for (const k of known) if (k && k.length >= 8 && line.includes(k)) found.push({ line: i + 1, kind: 'known-credential', length: k.length });
  });
  return found;
}

function parseArgs(argv) {
  const opts = { only: [], values: VALUES_FILE, mode: 'diff' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only.push(argv[++i]);
    else if (a === '--values') opts.values = resolve(argv[++i]);
    else if (a === '--write') opts.mode = 'write';
    else if (a === '--print') opts.mode = 'print';
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\nusage: read-identity.mjs [--write|--print] [--only <prefix>]... [--values <file>]`);
    process.exit(2);
  }
  const fresh = await readAll({ only: opts.only });
  if (fresh.failures.length) {
    console.error(JSON.stringify({ event: 'reader-failed', failures: fresh.failures }));
    process.exit(1);
  }
  if (opts.mode === 'print') {
    for (const v of fresh) console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (opts.mode === 'write') {
    const secrets = findSecrets(fresh.map((v) => JSON.stringify(v)).join('\n'));
    if (secrets.length) {
      console.error(JSON.stringify({ event: 'refused', reason: 'credential-shaped value in the read', secrets }));
      process.exit(1);
    }
    const keep = opts.only.length ? readValues(opts.values).filter((v) => !opts.only.some((p) => v.identity.startsWith(p))) : [];
    writeFileSync(opts.values, sortValues([...keep, ...fresh]).map((v) => JSON.stringify(v)).join('\n') + '\n');
    console.log(JSON.stringify({ event: 'written', file: opts.values, values: fresh.length }));
    process.exit(0);
  }
  const checkedIn = readValues(opts.values).filter((v) => !opts.only.length || opts.only.some((p) => v.identity.startsWith(p)));
  const d = diffValues(checkedIn, fresh);
  for (const x of d.drift) console.log(JSON.stringify({ event: 'drift', ...x }));
  for (const x of d.unverified) console.log(JSON.stringify({ event: 'unverified', ...x }));
  for (const x of d.notRead) console.log(JSON.stringify({ event: 'not-read', ...x }));
  for (const x of d.added) console.log(JSON.stringify({ event: 'added', ...x }));
  console.log(JSON.stringify({ event: 'identity-done', read: fresh.length, unchanged: d.unchanged.length, drift: d.drift.length, unverified: d.unverified.length, notRead: d.notRead.length, added: d.added.length }));
  process.exit(d.drift.length ? 3 : 0);
}
