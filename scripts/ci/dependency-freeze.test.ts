import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stringify } from 'yaml';
import {
  declaredPlanRevision,
  frozenProblems,
  policyProblems,
  type DependencyPolicy,
} from './dependency-freeze.ts';

const policy = JSON.parse(
  readFileSync(new URL('./dependency-policy.json', import.meta.url), 'utf8'),
) as DependencyPolicy;
const tolerancePath = Object.keys(policy.toleranceFiles)[0]!;
const tolerance = readFileSync(new URL(`../../${tolerancePath}`, import.meta.url), 'utf8');
const root = new URL('../..', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('current frozen numerical constants, required jobs and all five desktop cells are intact', () => {
  assert.deepEqual(policyProblems(policy), []);
  assert.deepEqual(frozenProblems(policy, policy, read), []);
});

test('a widened synthesis or e4e tolerance fails against the trusted digest', () => {
  for (const [before, after] of [
    ['maxRgbDiff: 1', 'maxRgbDiff: 2'],
    ['maxAbsError: 0.0001', 'maxAbsError: 0.001'],
  ]) {
    assert.ok(tolerance.includes(before!));
    const problems = frozenProblems(policy, policy, (path) =>
      path === tolerancePath ? tolerance.replace(before!, after!) : read(path),
    );
    assert.ok(problems.some((p) => p.includes('frozen numerical tolerance digest changed')));
  }
});

test('updating the candidate digest to conceal the widened tolerance cannot replace the trusted base', () => {
  const edited = tolerance.replace('maxRgbDiff: 1', 'maxRgbDiff: 2');
  const candidate = structuredClone(policy);
  candidate.toleranceFiles[tolerancePath] = createHash('sha256').update(edited).digest('hex');
  const problems = frozenProblems(policy, candidate, (path) =>
    path === tolerancePath ? edited : read(path),
  );
  assert.ok(problems.some((p) => p.includes('frozen policy changed')));
  assert.ok(problems.some((p) => p.includes('tolerance digest changed')));
});

test('removing any of the five desktop cells fails even if the candidate removes its frozen entry too', () => {
  const path = '.github/workflows/next-matrix.yml';
  const cells = policy.requiredMatrices[path]!.engines!.include as unknown[];
  for (let index = 0; index < cells.length; index++) {
    const candidate = structuredClone(policy);
    (candidate.requiredMatrices[path]!.engines!.include as unknown[]).splice(index, 1);
    const workflow = {
      jobs: {
        engines: {
          steps: [{ run: 'real suite' }],
          strategy: {
            matrix: {
              include: cells.filter((_, i) => i !== index),
            },
          },
        },
        summary: { steps: [{ run: 'real suite' }] },
      },
    };
    const problems = frozenProblems(policy, candidate, (file) =>
      file === path ? stringify(workflow) : read(file),
    );
    assert.ok(
      problems.some((p) => p.includes('required cell engines.include removed')),
      String(index),
    );
    assert.ok(problems.some((p) => p.includes('frozen policy changed')));
  }
});

test('a required job cannot disappear, allow failure, be disabled or become empty', () => {
  const path = '.github/workflows/contracts-m1.yml';
  for (const [job, expected] of [
    [undefined, 'removed'],
    [{ steps: [{ run: 'real suite' }], 'continue-on-error': true }, 'allows failure'],
    [{ steps: [{ run: 'real suite' }], if: '${{ false }}' }, 'disabled'],
    [{ steps: [] }, 'has no work'],
  ] as const) {
    const problems = frozenProblems(policy, policy, (file) =>
      file === path ? stringify({ jobs: { browsers: job } }) : read(file),
    );
    assert.ok(
      problems.some((p) => p.includes(expected)),
      expected,
    );
  }
});

test('a missing required-check group and an extra or missing group fail the policy', () => {
  const candidate = structuredClone(policy);
  candidate.groups['build-tools']!.requiredChecks = [];
  assert.ok(policyProblems(candidate).some((p) => p.includes('required checks are missing')));
  delete candidate.groups['test-tools'];
  assert.ok(policyProblems(candidate).some((p) => p.includes('exactly the four')));
});

test('declared plan revision requires a newly added dated operator decision with matching text', () => {
  const candidate = structuredClone(policy);
  candidate.planRevision = { date: '2026-10-27', decision: 'Add another desktop cell' };
  assert.equal(
    declaredPlanRevision(candidate, '| 2026-10-27 | Operator | Add another desktop cell |'),
    false,
  );
  assert.equal(
    declaredPlanRevision(candidate, '+| 2026-10-27 | Implementer | Add another desktop cell |'),
    false,
  );
  assert.equal(
    declaredPlanRevision(candidate, '+| 2026-10-26 | Operator | Add another desktop cell |'),
    false,
  );
  assert.equal(
    declaredPlanRevision(candidate, '+| 2026-10-27 | Operator | Add another desktop cell |'),
    true,
  );
  assert.deepEqual(
    frozenProblems(
      policy,
      candidate,
      read,
      '+| 2026-10-27 | Operator | Add another desktop cell |',
    ),
    [],
  );
});

test('the active LTS and both frozen distribution exclusions remain mandatory', () => {
  const candidate = structuredClone(policy);
  candidate.activeNodeMajor = 26;
  candidate.excludedPaths = [];
  assert.equal(policyProblems(candidate).length, 3);
});
