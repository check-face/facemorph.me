import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
const read = (path: string) =>
  parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const main = read('.github/workflows/main.yml');
const names = [
  'app-contracts',
  'build-identity',
  'cloudflare-model-host',
  'contracts-m1',
  'crop-repro',
  'hosting-staging',
  'import-checks',
  'import-closure',
  'manager-cache',
  'native-retirement',
  'package-gates',
  'web-shell',
  'name-catalogue',
];

test('every shared-build consumer waits for the producer and retains a standalone build', () => {
  for (const name of names) {
    const call = main.jobs[name];
    assert(call.needs.includes('next-site-artifact'), name);
    assert.equal(call.with.shared_build, true, name);
    assert(main.jobs['next-site-artifact'].if.includes(`'${name}'`), name);
    const workflow = read(`.github/workflows/${name}.yml`);
    assert.equal(workflow.on.workflow_call.inputs.shared_build.default, false, name);
    for (const [jobId, job] of Object.entries(workflow.jobs) as [string, any][]) {
      const steps = job.steps ?? [];
      const builds = steps.filter((s: any) => s.run?.match(/npm run build(?!:next.*--check)/));
      if (!builds.length) continue;
      assert(
        steps.some(
          (s: any) =>
            s.uses === './.github/actions/restore-workspace-build' &&
            s.if?.includes('inputs.shared_build'),
        ),
        `${name}/${jobId} restores build`,
      );
      for (const step of builds) {
        // typecheck deliberately builds its declaration prerequisites; all explicit build steps are conditional.
        if (step.run.includes('SHARED_BUILD'))
          assert.equal(step.env.SHARED_BUILD, '${{ inputs.shared_build }}');
        else assert.match(step.if ?? '', /!inputs.shared_build/, `${name}/${jobId}: ${step.run}`);
      }
    }
  }
});

test('one canonical build creates both the deployable artifact and the compiled workspace', () => {
  const producer = read('.github/workflows/next-site-artifact.yml').jobs.artifact;
  const commands = producer.steps.map((s: any) => s.run ?? '');
  assert.equal(commands.filter((s: string) => s.includes('npm run build:next &&')).length, 1);
  assert(!commands.some((s: string) => /^npm run build(?: |$)/.test(s)));
  const build = commands.findIndex((s: string) => s.includes('npm run build:next &&'));
  const imports = commands.findIndex((s: string) => s.includes('execution-gate.test.mjs'));
  assert(build < imports, 'compile once before regression tests import package exports');
  const pack = commands.findIndex((s: string) => s.includes('workspace-build.mjs pack'));
  assert(pack > build);
  const record = producer.steps.findIndex(
    (s: any) => s.name === 'Record exact bytes for promotion',
  );
  assert(pack < record, 'pack while the checkout is clean, before generated provenance is written');
  const upload = producer.steps.find(
    (s: any) => s.with?.name === 'workspace-build-${{ github.sha }}',
  );
  assert.equal(upload.with.path, '.cache/workspace-build-artifact/');
});

test('site consumers restore current-run provenance and retain the existing artifact checks', () => {
  const action = read('.github/actions/restore-site/action.yml');
  const fetch = action.runs.steps[0];
  assert.equal(fetch.uses, './.github/actions/fetch-artifact');
  assert.equal(fetch.with.source_repo_id, '${{ github.repository_id }}');
  assert.equal(fetch.with.workflow, '.github/workflows/main.yml');
  assert.equal(fetch.with.run_id, '${{ github.run_id }}');
  assert.equal(fetch.with.commit, '${{ github.sha }}');
  for (const name of [
    'build-identity',
    'import-checks',
    'crop-repro',
    'hosting-staging',
    'native-retirement',
  ]) {
    const jobs = read(`.github/workflows/${name}.yml`).jobs;
    assert(
      Object.values(jobs).some((j: any) =>
        j.steps.some(
          (s: any) =>
            s.uses === './.github/actions/restore-site' && s.if?.includes('inputs.shared_build'),
        ),
      ),
      name,
    );
    assert(
      Object.values(jobs).some((j: any) =>
        j.steps.some(
          (s: any) =>
            s.run === 'npm run build:next -- --check' && s.if?.includes('inputs.shared_build'),
        ),
      ),
      name,
    );
  }
});
