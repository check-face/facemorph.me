#!/usr/bin/env node
// Checks the closure rules that `br` cannot enforce on its own, over the committed .beads/issues.jsonl:
//   1. a ticked `close-after fm-X:` item on a closed bead needs fm-X closed at or before it;
//   2. a closed bead has no unchecked acceptance item (catches a forced or bypassed close);
//   3. a closed bead has no open blocking dependency (catches `br close --force`).
// A dependency that was closed and later reopened (label `reopened`) is not the dependent's fault: rules 1
// and 3 skip it, since the reopened bead carries its own unchecked item until it is fixed.
// Prints one JSON line per violation and exits 1 if there is any.
//   node scripts/beads/check-close-after.mjs [path/to/issues.jsonl]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['blocks', 'conditional-blocks', 'waits-for']);
const reopened = (b) => (b.labels ?? []).includes('reopened');

export function violations(issues) {
  const byId = new Map(issues.filter((i) => i.status !== 'tombstone').map((i) => [i.id, i]));
  const out = [];
  for (const i of byId.values()) {
    if (i.status !== 'closed') continue;
    const closedAt = Date.parse(i.closed_at ?? i.updated_at);
    const lines = (i.acceptance_criteria ?? '').split('\n');
    for (const line of lines) {
      if (/^\s*- \[ \]/.test(line)) out.push({ bead: i.id, rule: 'unchecked-acceptance', item: line.trim().slice(6, 120) });
      const m = line.match(/^\s*- \[x\]\s*close-after (fm-[a-z0-9]+(?:\.[0-9]+)*):/i);
      if (!m) continue;
      const dep = byId.get(m[1]);
      if (!dep) out.push({ bead: i.id, rule: 'close-after-unknown', dep: m[1] });
      else if (dep.status !== 'closed' && !reopened(dep)) out.push({ bead: i.id, rule: 'close-after-open', dep: m[1], depStatus: dep.status });
      else if (Date.parse(dep.closed_at ?? dep.updated_at) > closedAt) out.push({ bead: i.id, rule: 'close-after-order', dep: m[1] });
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
  console.log(JSON.stringify({ event: 'check-close-after', closed: issues.filter((i) => i.status === 'closed').length, violations: v.length }));
  process.exit(v.length ? 1 : 0);
}
