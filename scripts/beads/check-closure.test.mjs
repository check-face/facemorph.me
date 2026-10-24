import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from './check-closure.mjs';

const bead = (id, status, extra = {}) => ({
  id,
  status,
  closed_at: extra.closed_at,
  acceptance_criteria: extra.ac ?? '',
  dependencies: extra.deps ?? [],
  labels: extra.labels ?? [],
});
const rules = (issues) => violations(issues).map((v) => `${v.bead}:${v.rule}`);

test('unchecked items and open blockers on a closed bead are violations; open beads are ignored', () => {
  assert.deepEqual(
    rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T01:00:00Z', ac: '- [ ] still to do' })]),
    ['fm-a:unchecked-acceptance'],
  );
  assert.deepEqual(
    rules([
      bead('fm-a', 'closed', {
        closed_at: '2026-10-25T01:00:00Z',
        deps: [{ depends_on_id: 'fm-b', type: 'blocks' }],
      }),
      bead('fm-b', 'open'),
    ]),
    ['fm-a:closed-while-blocked'],
  );
  assert.deepEqual(
    rules([bead('fm-a', 'open', { ac: '- [ ] still to do' }), bead('fm-b', 'open')]),
    [],
  );
});

test('a dependency reopened after its dependents closed does not fail them', () => {
  assert.deepEqual(
    rules([
      bead('fm-a', 'closed', {
        closed_at: '2026-10-25T02:00:00Z',
        deps: [{ depends_on_id: 'fm-c', type: 'blocks' }],
      }),
      bead('fm-b', 'open', { labels: ['reopened', 'device-lab-failed'] }),
      bead('fm-c', 'open', { labels: ['reopened'] }),
    ]),
    [],
  );
});
