#!/usr/bin/env node
// Checks the closure rules that `br` cannot enforce on its own, over the committed .beads/issues.jsonl:
//   1. a closed bead has no unchecked acceptance item (catches a forced or bypassed close);
//   2. a closed bead has no open blocking dependency (catches `br close --force`).
// A dependency that was closed and later reopened (label `reopened`) is not the dependent's fault: rule 2
// skips it, since the reopened bead carries its own unchecked item until it is fixed.
// Prints one JSON line per violation and exits 1 if there is any.
//   node scripts/beads/check-closure.mjs [path/to/issues.jsonl]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['blocks', 'conditional-blocks', 'waits-for']);
const reopened = (b) => (b.labels ?? []).includes('reopened');

export function violations(issues) {
  const byId = new Map(issues.filter((i) => i.status !== 'tombstone').map((i) => [i.id, i]));
  const out = [];
  for (const i of byId.values()) {
    if (i.status !== 'closed') continue;
    for (const line of (i.acceptance_criteria ?? '').split('\n')) {
      if (/^\s*- \[ \]/.test(line)) out.push({ bead: i.id, rule: 'unchecked-acceptance', item: line.trim().slice(6, 120) });
    }
    for (const d of i.dependencies ?? []) {
      if (!BLOCKING.has(d.type)) continue;
      const dep = byId.get(d.depends_on_id);
      if (dep && dep.status !== 'closed' && !reopened(dep)) out.push({ bead: i.id, rule: 'closed-while-blocked', dep: dep.id, depStatus: dep.status });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? '.beads/issues.jsonl';
  const issues = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const v = violations(issues);
  for (const x of v) console.log(JSON.stringify(x));
  console.log(JSON.stringify({ event: 'check-closure', closed: issues.filter((i) => i.status === 'closed').length, violations: v.length }));
  process.exit(v.length ? 1 : 0);
}
