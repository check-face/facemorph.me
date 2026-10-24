import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from './check-close-after.mjs';

const bead = (id, status, extra = {}) => ({ id, status, closed_at: extra.closed_at, acceptance_criteria: extra.ac ?? '', dependencies: extra.deps ?? [], labels: extra.labels ?? [] });
const rules = (issues) => violations(issues).map((v) => `${v.bead}:${v.rule}`);

test('a close-after item is satisfied only when its bead closed first', () => {
  const ac = '- [x] close-after fm-b: integration check';
  assert.deepEqual(rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T02:00:00Z', ac }), bead('fm-b', 'closed', { closed_at: '2026-10-25T01:00:00Z' })]), []);
  assert.deepEqual(rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T01:00:00Z', ac }), bead('fm-b', 'closed', { closed_at: '2026-10-25T02:00:00Z' })]), ['fm-a:close-after-order']);
  assert.deepEqual(rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T01:00:00Z', ac }), bead('fm-b', 'in_progress')]), ['fm-a:close-after-open']);
});

test('unchecked items and open blockers on a closed bead are violations; open beads are ignored', () => {
  assert.deepEqual(rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T01:00:00Z', ac: '- [ ] still to do' })]), ['fm-a:unchecked-acceptance']);
  assert.deepEqual(rules([bead('fm-a', 'closed', { closed_at: '2026-10-25T01:00:00Z', deps: [{ depends_on_id: 'fm-b', type: 'blocks' }] }), bead('fm-b', 'open')]), ['fm-a:closed-while-blocked']);
  assert.deepEqual(rules([bead('fm-a', 'open', { ac: '- [ ] still to do\n- [x] close-after fm-b: x' }), bead('fm-b', 'open')]), []);
});

test('a dependency reopened after its dependents closed does not fail them', () => {
  const ac = '- [x] close-after fm-b: integration check';
  assert.deepEqual(rules([
    bead('fm-a', 'closed', { closed_at: '2026-10-25T02:00:00Z', ac, deps: [{ depends_on_id: 'fm-c', type: 'blocks' }] }),
    bead('fm-b', 'open', { labels: ['reopened', 'device-lab-failed'] }),
    bead('fm-c', 'open', { labels: ['reopened'] }),
  ]), []);
});
