import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = (name: string) =>
  parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const wrapper = workflow('next-site');
const artifact = workflow('next-site-artifact');
const qualify = workflow('next-site-qualify');
const cpu = workflow('next-e2e');
const main = workflow('main');
const provenance = ['artifact_run', 'artifact_workflow', 'artifact_commit', 'artifact_name'];

test('the wrapper builds once then qualifies, while child workflows leave queue ownership to their caller', () => {
  assert.deepEqual(Object.keys(wrapper.jobs), ['artifact', 'qualify']);
  assert.equal(wrapper.jobs.artifact.uses, './.github/workflows/next-site-artifact.yml');
  assert.equal(wrapper.jobs.qualify.uses, './.github/workflows/next-site-qualify.yml');
  assert.equal(wrapper.jobs.qualify.needs, 'artifact');
  assert.equal(wrapper.concurrency['cancel-in-progress'], false);
  for (const child of [artifact, qualify]) assert.equal(child.concurrency, undefined);
  for (const wf of [wrapper, artifact, qualify, cpu]) {
    assert.deepEqual(wf.permissions, { contents: 'read', actions: 'read' });
    for (const job of Object.values(wf.jobs) as any[]) {
      if (job.uses) assert.deepEqual(job.permissions, wf.permissions);
    }
  }
  assert.deepEqual(artifact.jobs.artifact['runs-on'], ['self-hosted', 'facemorph-artifact']);
  const steps = artifact.jobs.artifact.steps;
  assert.equal(steps.filter((s: any) => s.run?.includes('npm run build:next &&')).length, 1);
  assert.equal(steps.filter((s: any) => s.uses === 'actions/upload-artifact@v4').length, 1);
  assert.equal(steps.at(-1).with.name, 'next-site-${{ github.sha }}');
  assert.equal(artifact.env.BUILD_WORKFLOW, '${{ inputs.artifact_workflow }}');
  assert.equal(
    wrapper.jobs.artifact.with.artifact_workflow,
    wrapper.jobs.qualify.with.artifact_workflow,
  );
  for (const event of ['push', 'pull_request']) {
    for (const name of ['next-site-artifact', 'next-site-qualify']) {
      assert(wrapper.on[event].paths.includes(`.github/workflows/${name}.yml`));
    }
  }
});

test('both qualification paths consume all explicit pins and retain real CPU, UI and byte verification', () => {
  assert.deepEqual(Object.keys(qualify.jobs), ['qualify', 'compiled-ui']);
  for (const pin of provenance) {
    assert.equal(qualify.on.workflow_call.inputs[pin].required, true);
    assert.equal(qualify.jobs.qualify.with[pin], '${{ inputs.' + pin + ' }}');
    assert(wrapper.jobs.qualify.with[pin]);
  }
  assert.equal(qualify.jobs.qualify.uses, './.github/workflows/next-e2e.yml');
  assert.match(qualify.jobs.qualify.if, /github.event_name == 'push'/);
  assert.match(qualify.jobs.qualify.if, /github.event_name == 'workflow_dispatch'/);
  const steps = qualify.jobs['compiled-ui'].steps;
  const fetch = steps.find((s: any) => s.uses === './.github/actions/fetch-artifact');
  for (const [field, pin] of Object.entries({
    run_id: 'artifact_run',
    workflow: 'artifact_workflow',
    commit: 'artifact_commit',
    artifact_name: 'artifact_name',
  })) {
    assert.equal(fetch.with[field], '${{ inputs.' + pin + ' }}');
  }
  const commands = steps.map((s: any) => s.run ?? '').join('\n');
  assert.match(commands, /sha256sum --check next-site-SHA256SUMS/);
  assert.match(commands, /inputs.artifact_commit/);
  assert.match(commands, /preflight.e2e.ts/);
  assert.match(commands, /webgpu_contract_test.py/);
  assert.match(commands, /compiled_ui.py --artifact site\/deploy-next/);
  assert.doesNotMatch(commands, /test\/harness\/run.ts|fetch-control.mjs/);
  assert(
    cpu.jobs['real-ui-cpu'].steps.some((s: any) => s.with?.command?.includes('real-ui-cpu.mjs')),
  );
  assert.equal(qualify.jobs.qualify.with.runtime_sha, '${{ inputs.runtime_sha }}');
  assert.equal(
    qualify.on.workflow_call.inputs.runtime_sha.default,
    wrapper.jobs.qualify.with.runtime_sha,
  );
});

test('the executed CPU provenance gate rejects workflow and commit mismatches before fetching bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-next-site-pins-'));
  try {
    const command = cpu.jobs['real-ui-cpu'].steps
      .find((s: any) => s.id === 'source')
      .run.replaceAll('${{ github.repository_id }}', '123');
    const commit = 'a'.repeat(40);
    const source = {
      path: '.github/workflows/main.yml',
      conclusion: null,
      event: 'push',
      head_sha: commit,
    };
    writeFileSync(join(root, 'run.json'), JSON.stringify(source));
    writeFileSync(join(root, 'gh'), '#!/bin/sh\ncat "$RUN_FIXTURE"\n', { mode: 0o755 });
    const run = (pins: Record<string, string>) =>
      spawnSync('bash', ['-c', command], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          RUN_FIXTURE: join(root, 'run.json'),
          RUN_ID: '99',
          THIS_RUN: '99',
          ARTIFACT: `next-site-${commit}`,
          EXPECTED_WORKFLOW: source.path,
          EXPECTED_COMMIT: commit,
          GITHUB_OUTPUT: join(root, 'output'),
          ...pins,
        },
      });
    assert.equal(run({}).status, 0);
    assert.equal(
      readFileSync(join(root, 'output'), 'utf8'),
      `commit=${commit}\nworkflow=${source.path}\n`,
    );
    for (const pins of [
      { EXPECTED_WORKFLOW: '.github/workflows/next-site.yml' },
      { EXPECTED_COMMIT: 'b'.repeat(40) },
    ]) {
      rmSync(join(root, 'output'), { force: true });
      const result = run(pins);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /differs from caller pin/);
    }
    // Standalone/manual callers without the new pins retain run-derived provenance checks.
    assert.equal(run({ EXPECTED_WORKFLOW: '', EXPECTED_COMMIT: '' }).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main artifact consumers do not wait on CPU or compiled UI qualification; a deploy does', () => {
  assert.equal(main.jobs['next-site-artifact'].uses, './.github/workflows/next-site-artifact.yml');
  assert.equal(main.jobs['next-site'].uses, './.github/workflows/next-site-qualify.yml');
  assert.deepEqual(main.jobs['next-site'].needs, ['changes', 'next-site-artifact']);
  for (const id of ['web-shell', 'mobile-browser', 'next-deploy']) {
    assert.deepEqual(
      main.jobs[id].needs,
      id === 'next-deploy'
        ? ['changes', 'next-site-artifact', 'next-site', 'pre-deploy']
        : ['changes', 'next-site-artifact'],
    );
    for (const pin of provenance)
      assert.equal(main.jobs[id].with[pin], main.jobs['next-site'].with[pin]);
  }
  // fm-6fx6: qualification runs whenever a deploy target is set, and the deploy needs it to pass.
  for (const id of ['next-site-artifact', 'next-site'])
    assert.match(main.jobs[id].if, /FACEMORPH_DEPLOY_TARGET/);
  assert.match(main.jobs['next-deploy'].if, /needs\.pre-deploy\.result == 'success'/);
});
