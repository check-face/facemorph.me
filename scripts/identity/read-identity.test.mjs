// fm-a4b: identity reader. Pure decision logic is called with plain values; everything else makes
// the real read-only `gh api`, `git ls-remote` and `curl` calls (no recorded responses). Needs `gh`
// authenticated (GH_TOKEN in CI) and network access. Reads the current credential cannot make
// (admin-only settings under a workflow token) are reported unverified, never as drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAll, diffValues, readValues, findSecrets, shell, unshell, VALUES_FILE } from './read-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(resolve(here, 'identities.json'), 'utf8'));
const { integrations } = JSON.parse(readFileSync(resolve(here, 'integrations.json'), 'utf8'));
const checkedIn = readValues();
const AT = '2026-10-24T00:00:00.000Z';
const v = (identity, field, value, exit = 0) => ({ identity, field, value, command: 'x', at: AT, exit, ...(value === null && exit ? { error: 'HTTP 403' } : {}) });
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX40 = /^[0-9a-f]{40}$/;

// ---- pure logic -------------------------------------------------------------------------------

test('diff: unchanged, drift, unverified, not read and added are kept apart', () => {
  const was = [v('a', 'id', 1), v('a', 'branch', 'abc'), v('a', 'secrets', ['X']), v('a', 'gone', true), v('b', 'obj', { y: 2, x: 1 })];
  const now = [v('a', 'id', 1), v('a', 'branch', 'def'), v('a', 'secrets', null, 1), v('a', 'new', 5), v('b', 'obj', { x: 1, y: 2 })];
  const d = diffValues(was, now);
  assert.deepEqual(d.unchanged.map((x) => x.field).sort(), ['id', 'obj']);
  assert.deepEqual(d.drift.map((x) => [x.field, x.was, x.now]), [['branch', 'abc', 'def']]);
  assert.deepEqual(d.unverified.map((x) => [x.field, x.error]), [['secrets', 'HTTP 403']]);
  assert.deepEqual(d.notRead.map((x) => x.field), ['gone']);
  assert.deepEqual(d.added.map((x) => x.field), ['new']);
});

test('diff: a value that was itself unreadable and still is counts as unchanged', () => {
  const d = diffValues([v('o', 'secrets', null, 1)], [v('o', 'secrets', null, 1)]);
  assert.equal(d.unchanged.length, 1);
  assert.equal(d.unverified.length + d.drift.length, 0);
});

test('findSecrets flags credential shapes and passes digests, commits, IDs and branch names', () => {
  const shapes = {
    'github-token': 'token gho_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6',
    'github-pat': 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnop',
    'private-key': '-----BEGIN OPENSSH PRIVATE KEY-----',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
    'mixed-token': 'value Xk9mQ2vR7tLp4Wz8Hn3Yb6Jc',
  };
  for (const [kind, text] of Object.entries(shapes)) assert.ok(findSecrets(text).some((f) => f.kind === kind), kind);
  const clean = [
    'e6e229831533244133f80aea61ae944c811bf9a0',
    'd9e37e50a436e9fb7c0c7f973e70adee353c808f48c6a51fa5a9186f1c650a5c',
    '{"repo.id":295956585}',
    'candidate/next-delivery-20260916',
    'facemorph-names-d1enhzirl-erinome.vercel.app',
    'CLOUDFLARE_API_TOKEN STATS_SCRAPE_TOKEN',
  ].join('\n');
  assert.deepEqual(findSecrets(clean), []);
  assert.equal(findSecrets('x supersecretvalue9 y', { known: ['supersecretvalue9'] })[0].kind, 'known-credential');
});

test('recorded commands round-trip through shell quoting', () => {
  for (const argv of [['gh', 'api', 'repositories/1', '--jq', '{id,full_name}'], ['curl', '-H', 'accept: application/dns-json', "it's"]]) {
    assert.deepEqual(unshell(shell(argv)), argv);
  }
});

// ---- checked-in data --------------------------------------------------------------------------

test('every checked-in value carries identity, field, command, ISO timestamp and exit code', () => {
  assert.ok(checkedIn.length > 100, 'identity-values.jsonl is populated');
  for (const x of checkedIn) {
    assert.ok(x.identity && x.field && x.command, JSON.stringify(x));
    assert.match(x.at, ISO);
    assert.equal(typeof x.exit, 'number');
    if (x.exit !== 0 && x.value === null) assert.ok(x.error, `${x.identity} ${x.field}: failed read without an error`);
  }
  const ids = new Set(checkedIn.map((x) => x.identity));
  for (const r of spec.repositories) {
    const get = (f) => checkedIn.find((x) => x.identity === r.identity && x.field === f)?.value;
    assert.equal(get('repo.id'), r.id, `${r.identity} repo.id`);
    assert.ok(get('repo.full_name') && get('repo.default_branch'), r.identity);
    for (const b of r.branches) assert.match(get(`branch.${b}`), HEX40, `${r.identity} ${b}`);
  }
  for (const h of spec.hosts) {
    assert.ok(ids.has(h.identity), `${h.identity} not read`);
    assert.ok(checkedIn.some((x) => x.identity === h.identity && x.field === 'http.status'), `${h.identity} http.status`);
  }
});

test('served artifacts: source commit is attested by a named record or marked unknown', () => {
  for (const h of spec.hosts.filter((x) => x.deployRecord)) {
    const get = (f) => checkedIn.find((x) => x.identity === h.identity && x.field === f)?.value;
    assert.match(get('artifact.html.sha256'), /^[0-9a-f]{64}$/, h.identity);
    const source = get('source.commit');
    assert.ok(source === 'unknown' || HEX40.test(source), `${h.identity}: ${source}`);
    if (source !== 'unknown') {
      assert.equal(get('deploy.record.sha') ?? get('deploy.record.deployment')?.sha, source, `${h.identity}: record and source disagree`);
      assert.match(get('source.attestation'), new RegExp(source), h.identity);
    }
  }
  const next = (f) => checkedIn.find((x) => x.identity === 'on-device-candidate' && x.field === f)?.value;
  assert.match(next('artifact.buildId'), /^next-[0-9a-f]{16}$/);
  if (next('source.commit') !== 'unknown') assert.equal(next('artifact.embeddedSourceCommit'), next('source.commit'));
});

test('model, catalogue, preview/latent and diagnostics hosts each have an owner, source path and serving Worker/bucket', () => {
  const hosts = ['model-chunks', 'model-mirror', 'names-catalogue', 'preview-host', 'latent-host', 'diagnostics-collector'];
  for (const id of hosts) {
    const host = new URL(spec.hosts.find((h) => h.identity === id).url).hostname;
    const owners = integrations.filter((i) => i.scope.includes(`host:${host}`));
    assert.ok(owners.length, `${id}: no integration covers host:${host}`);
    assert.ok(owners.some((i) => i.binding?.repoId && (i.binding.path || i.binding.branch)), `${id}: no source path`);
    assert.ok(owners.some((i) => /Worker `[a-z-]+`/.test(i.target)), `${id}: no serving Worker named`);
  }
  assert.ok(integrations.some((i) => /R2 `facemorph-diagnostics`/.test(i.target)), 'diagnostics bucket');
  assert.ok(integrations.some((i) => /R2 `facemorph-runtime-mirror`/.test(i.target)), 'runtime mirror bucket');
});

test('every integration is verified (with evidence) or needs-inspection (with what is missing); publishers list trigger and credential names', () => {
  const NAME = /^[A-Z][A-Z0-9_]*( \(variable\))?$/;
  for (const i of integrations) {
    assert.ok(['verified', 'needs-inspection'].includes(i.status), `${i.id}: ${i.status}`);
    if (i.status === 'verified') {
      assert.ok(i.evidence?.length, `${i.id}: no evidence`);
      for (const e of i.evidence) assert.ok(e.command && /^2026-\d{2}-\d{2}/.test(e.at), `${i.id}: evidence needs command and date`);
    } else assert.ok(i.missing, `${i.id}: needs-inspection without what is missing`);
    assert.ok(i.scope?.length && i.binding?.type && i.target && i.trigger !== undefined, `${i.id}: incomplete binding`);
    assert.ok(Array.isArray(i.credentials), `${i.id}: credentials`);
    if (/publisher$/.test(i.kind) && i.kind !== 'manual-publisher' && i.kind !== 'github-app-publisher') {
      assert.ok(i.credentials.length && i.credentials.every((c) => NAME.test(c)), `${i.id}: credential names`);
      assert.ok(i.check?.workflow, `${i.id}: Actions publisher without a workflow check`);
    }
  }
  for (const id of ['classic-vercel-production', 'classic-next-site', 'classic-models-mirror', 'names-vercel-git', 'checkface-pages']) {
    assert.ok(integrations.some((i) => i.id === id), `${id} binding missing`);
  }
});

test('a secret scan finds no secret values in the checked-in identity data', () => {
  let known = [process.env.GH_TOKEN, process.env.GITHUB_TOKEN, process.env.CLOUDFLARE_API_TOKEN];
  try {
    known.push(execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {}
  known = known.filter(Boolean);
  for (const f of ['identity-values.jsonl', 'integrations.json', 'identities.json', 'org-link-rules.json']) {
    assert.deepEqual(findSecrets(readFileSync(resolve(here, f), 'utf8'), { known }), [], f);
  }
  // Secret and variable listings hold names only.
  for (const x of checkedIn.filter((x) => /(^|\.)secrets$|variables$/.test(x.field) && x.value !== null)) {
    assert.ok(Array.isArray(x.value) && x.value.every((n) => /^[A-Z_][A-Z0-9_]*$/.test(n)), `${x.identity} ${x.field}`);
  }
  for (const x of checkedIn.filter((x) => x.field === 'hooks' && Array.isArray(x.value))) {
    for (const h of x.value) assert.deepEqual(Object.keys(h).sort(), ['active', 'events', 'host'], 'hooks keep host only');
  }
});

// ---- live reads -------------------------------------------------------------------------------

test('live: repository identities re-read by ID agree with the checked-in values or list the drift', async () => {
  const only = spec.repositories.map((r) => r.identity);
  const fresh = await readAll({ only });
  assert.deepEqual(fresh.failures, []);
  for (const r of spec.repositories) {
    const id = fresh.find((x) => x.identity === r.identity && x.field === 'repo.id');
    assert.equal(id.value, r.id, `${r.identity}: ${id.error ?? ''}`);
    assert.match(id.command, new RegExp(`^gh api repositories/${r.id} `));
    const owner = fresh.find((x) => x.identity === r.identity && x.field === 'repo.full_name').value.split('/')[0];
    assert.ok(['check-face', 'facemorph-me'].includes(owner), owner);
  }
  const d = diffValues(checkedIn.filter((x) => only.includes(x.identity)), fresh);
  assert.deepEqual(d.notRead, [], 'every checked-in value was re-read');
  assert.deepEqual(d.drift.filter((x) => x.field === 'repo.id'), [], 'repository IDs never drift');
  for (const x of d.drift) assert.ok('was' in x && 'now' in x && x.command, 'drift lists both values and the command');
});

test('live: each checked-in `gh api` value matches a re-run of the command it cites, or the reader lists it as drift', async () => {
  const cited = checkedIn.filter((x) => x.identity !== 'org:facemorph-me' && /^gh api repositories\/\d+ --jq|^gh api orgs\/[a-z-]+ --jq/.test(x.command));
  assert.ok(cited.length >= 5 * 7, 'repository and organization fields cite their reads');
  const fresh = await readAll({ only: [...new Set(cited.map((x) => x.identity))] });
  const drift = new Set(diffValues(cited, fresh).drift.map((x) => `${x.identity} ${x.field}`));
  const outputs = new Map();
  let checked = 0;
  for (const x of cited) {
    if (!outputs.has(x.command)) {
      try {
        outputs.set(x.command, JSON.parse(execFileSync(unshell(x.command)[0], unshell(x.command).slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })));
      } catch {
        outputs.set(x.command, undefined); // not readable with this credential: unverified, not compared
      }
    }
    const out = outputs.get(x.command);
    if (out === undefined) continue;
    const live = x.field.startsWith('repo.') ? out[x.field.slice(5)] ?? null : out;
    if (JSON.stringify(live) !== JSON.stringify(x.value)) assert.ok(drift.has(`${x.identity} ${x.field}`), `${x.identity} ${x.field} changed but the reader did not list it`);
    checked++;
  }
  assert.ok(checked >= 5 * 7, `only ${checked} values re-checked`);
});

test('live: a second run reports drift against the checked-in file instead of overwriting it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  const planted = join(dir, 'values.jsonl');
  const lines = checkedIn.filter((x) => x.identity === 'encoder-fork').map((x) => (x.field === 'repo.default_branch' ? { ...x, value: 'planted-branch' } : x));
  const text = lines.map((x) => JSON.stringify(x)).join('\n') + '\n';
  writeFileSync(planted, text);
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('node', [resolve(here, 'read-identity.mjs'), '--only', 'encoder-fork', '--values', planted], { encoding: 'utf8' });
  } catch (e) {
    ({ stdout, status } = e);
  }
  assert.equal(status, 3, 'drift exits 3');
  const events = stdout.trim().split('\n').map((l) => JSON.parse(l));
  const drift = events.find((e) => e.event === 'drift' && e.field === 'repo.default_branch');
  assert.equal(drift.was, 'planted-branch');
  assert.equal(drift.now, 'main');
  assert.equal(events.at(-1).event, 'identity-done');
  assert.equal(readFileSync(planted, 'utf8'), text, 'the checked-in file is left as it was');
});

test('live: served artifacts are read from live bytes and their source attested or marked unknown', async () => {
  const fresh = await readAll({ only: ['on-device-candidate', 'legacy-production-web'] });
  assert.deepEqual(fresh.failures, []);
  for (const id of ['on-device-candidate', 'legacy-production-web']) {
    const get = (f) => fresh.find((x) => x.identity === id && x.field === f);
    assert.match(get('artifact.html.sha256').value, /^[0-9a-f]{64}$/);
    assert.match(get('artifact.html.sha256').command, /^curl -sS -f /);
    const source = get('source.commit');
    // null only when this credential could not read the deploy record (reported unverified).
    assert.ok(source.value === 'unknown' || HEX40.test(source.value) || (source.value === null && source.error), `${id}: ${JSON.stringify(source)}`);
  }
  assert.match(fresh.find((x) => x.identity === 'on-device-candidate' && x.field === 'artifact.embeddedSourceCommit').value, HEX40);
});

test('live: every publisher workflow still declares the trigger, deploy command and credential names recorded for it', async () => {
  const fresh = await readAll({ only: ['integration:'] });
  const checks = integrations.filter((i) => i.check?.workflow);
  assert.equal(fresh.length, checks.length);
  for (const x of fresh) assert.equal(x.value, 'pass', `${x.identity}: ${x.value ?? x.error}`);
});

test('values file is sorted and keyed uniquely', () => {
  const keys = checkedIn.map((x) => `${x.identity}\u0000${x.field}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(readFileSync(VALUES_FILE, 'utf8').endsWith('\n'), true);
});
