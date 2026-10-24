// The delivery runbook (fm-5u9): its table rules, the secret scan, the rendered handover.md, and the dry run's
// judgements on plain values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { entries, judgeDryRun, judgeProbe, runtimeFiles } from './dry-run.mjs';
import { render, rollbackTarget } from './render-handover.mjs';

const runbook = JSON.parse(readFileSync(new URL('runbook.json', import.meta.url), 'utf8'));
const handover = readFileSync(new URL('handover.md', import.meta.url), 'utf8');

test('every retirement item is remove or keep with a reason; every remove has its command and a probe', () => {
  for (const r of runbook.retirement) {
    assert.ok(['remove', 'keep'].includes(r.disposition), r.id);
    assert.ok(r.reason && r.when && r.target, `${r.id} has target, when and reason`);
    assert.ok(r.probe, `${r.id} has a read-only probe`);
    if (r.disposition === 'remove' && r.when !== 'separate data-disposal operation')
      assert.ok(r.command, `${r.id} has its command`);
    assert.ok(r.dryRun || r.noDryRun, `${r.id} has a dry run or says why it has none`);
  }
  assert.ok(runbook.references.length >= 5 && runbook.references.every((r) => r.disposition));
});

test('the keep list names the statistics Worker, metrics.facemorph.me, the triton Prometheus with its old-API series, and triton as a worker', () => {
  const keep = runbook.retirement
    .filter((r) => r.disposition === 'keep')
    .map((r) => r.target)
    .join('\n');
  for (const must of [
    /facemorph-stats/,
    /metrics\.facemorph\.me/,
    /triton Prometheus with its stored old-API counter series/,
    /the triton machine: development worker/,
    /models\.facemorph\.me.*facemorph-runtime-mirror/,
  ])
    assert.match(keep, must);
});

test('no credential value appears in the runbook or handover.md', () => {
  const credentialShapes = [
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /github_pat_\w{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z_]*\s*[:=]\s*['"]?[^\s'"<,}]{4,}/,
  ];
  // An API token is a 40-character run with both upper and lower case; commit SHAs and record IDs are lower-case hex.
  const tokenLike = (text) =>
    [...text.matchAll(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/g)]
      .map((m) => m[0])
      .filter((t) => /[a-z]/.test(t) && /[A-Z]/.test(t));
  for (const [name, text] of [
    ['runbook.json', JSON.stringify(runbook, null, 1)],
    ['handover.md', handover],
  ]) {
    for (const shape of credentialShapes) assert.doesNotMatch(text, shape, `${name}: ${shape}`);
    assert.deepEqual(tokenLike(text), [], `${name}: token-like strings`);
  }
  assert.deepEqual(
    tokenLike('x AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab y'),
    ['AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab'],
    'the token rule finds one',
  );
  assert.match(
    'MONGO_INITDB_ROOT_PASSWORD: hunter22',
    credentialShapes[3],
    'the assignment rule finds one',
  );
});

test('every action has preconditions, commands, a concrete rollback target, an owner, a one-publisher step and its check', () => {
  for (const a of runbook.actions) {
    assert.ok(a.preconditions.length && a.commands.length && a.owner && a.onePublisher, a.id);
    assert.match(
      rollbackTarget(runbook, a.rollback.target),
      /run \d+|deployment \d+|next-[0-9a-f]+|digest/,
      a.id,
    );
    assert.match(
      a.check,
      /^node scripts\/delivery\/post-delivery-check\.mjs --mode (app|retired|page|redirect|unchanged) --host /,
    );
    if (a.changesVisitors)
      assert.match(
        a.annotate ?? '',
        /^node scripts\/delivery\/annotate-cutover\.mjs --action /,
        a.id,
      );
  }
  const ids = runbook.actions.map((a) => a.id);
  for (const id of [
    'early-promotion',
    'candidate-source-handover',
    'production-promotion',
    'api-retirement',
    'names-redirect',
    'vercel-retirement',
    'classic-default-branch',
  ])
    assert.ok(ids.includes(id), id);
});

test('the names host records its before state, redirect, rollback, redirect check and archive notice', () => {
  const n = runbook.namesHost;
  assert.match(n.before.dns, /record [0-9a-f]{32}/);
  assert.equal(n.before.status, 200);
  assert.match(n.before.bodySha256Prefix, /^[0-9a-f]{16}$/);
  assert.ok(n.redirect.length && n.rollback.length && n.archiveNotice);
  assert.match(n.check, /--mode redirect --host names\.facemorph\.me/);
});

test('handover.md is what the runbook renders', () => {
  assert.equal(handover, render(runbook));
});

test('the dry run judges answers as plain values', () => {
  const ok = {
    status: 0,
    stdout: JSON.stringify({ result: { name: 'api.facemorph.me' } }),
    stderr: '',
  };
  assert.deepEqual(judgeProbe({ type: 'cf-get', expect: { name: 'api.facemorph.me' } }, ok), {
    ok: true,
    detail: 'exists',
  });
  assert.equal(judgeProbe({ type: 'cf-get', expect: { name: 'e4e.facemorph.me' } }, ok).ok, false);
  assert.equal(
    judgeProbe({ type: 'cf-get' }, { status: 1, stdout: '', stderr: 'Status code: 404' }).ok,
    false,
    'a missing target fails',
  );
  assert.equal(
    judgeProbe(
      { type: 'ssh', expectPrefix: 'db ' },
      { status: 0, stdout: 'db restarting\n', stderr: '' },
    ).ok,
    true,
  );
  assert.equal(judgeProbe({ type: 'http' }, { status: 0, stdout: '404', stderr: '' }).ok, true);
  assert.equal(
    judgeProbe(
      { type: 'gh', expectNames: ['A', 'B'] },
      { status: 0, stdout: JSON.stringify({ secrets: [{ name: 'A' }] }), stderr: '' },
    ).ok,
    false,
  );
  assert.deepEqual(
    judgeDryRun({
      status: 0,
      stdout: JSON.stringify({ method: 'DELETE', url: 'https://x/y' }),
      stderr: '',
    }).wouldChange,
    'DELETE https://x/y',
  );
  assert.equal(judgeDryRun({ status: 1, stdout: '', stderr: 'bad flag' }).ok, false);
  assert.ok(entries(runbook).length >= 20);
});

test('runtime files count a chunked asset by its chunks and never a directory', () => {
  const files = runtimeFiles({
    synthesis: {
      url: 'https://next.facemorph.me/runtime/assets/a/s.onnx',
      chunks: [{ url: 'https://next.facemorph.me/runtime/chunks/c1.bin' }],
    },
    wasmPaths: 'https://next.facemorph.me/runtime/assets/b/',
    mapping: { url: 'https://next.facemorph.me/runtime/assets/m/mapping.onnx' },
    other: 'https://example.com/runtime/x',
  });
  assert.deepEqual(files, ['runtime/assets/m/mapping.onnx', 'runtime/chunks/c1.bin']);
});
