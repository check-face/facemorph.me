#!/usr/bin/env node
// Grades a subject's recorded goldens against the control's, row by row (fm-q007). Rows come from the frozen flow
// matrix (apps/web/test/parity/rows.ts): parity rows compare the DOM contract of every step exactly; changed and new
// rows are emitted owner-graded and never compared. Goldens are apps/web/test/goldens/<subject>/<row>/<project>/NN-<step>.json
// as recorded by the parity spec with RECORD=1.
//   node --experimental-strip-types scripts/verify/parity-grade.mjs [--control DIR] --subject DIR [--out FILE]
// One JSON line per row and project, then a summary; exit 1 when any parity row fails.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeRow } from './dom-contract.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PROJECTS = ['desktop', 'phone'];

export function readSteps(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d+-.*\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function grade(rows, controlDir, subjectDir) {
  const results = [];
  for (const row of rows) {
    for (const project of PROJECTS) {
      const control = readSteps(join(controlDir, row.rowId, project));
      if (row.tag === 'parity' && !control.length) continue; // the spec records no steps for this row on this project
      results.push({ project, ...gradeRow(row, control, readSteps(join(subjectDir, row.rowId, project))) });
    }
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  return { results, summary: { passed: count('passed'), failed: count('failed'), ownerGraded: count('owner-graded'), untested: count('untested') } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  const { ROWS } = await import(join(REPO, 'apps/web/test/parity/rows.ts'));
  const controlDir = resolve(args.control ?? join(REPO, 'apps/web/test/goldens/control'));
  if (!args.subject) { console.error('--subject DIR is required'); process.exit(2); }
  const { results, summary } = grade(ROWS, controlDir, resolve(args.subject));
  for (const r of results) console.log(JSON.stringify(r));
  console.log(JSON.stringify({ summary: { ...summary, control: controlDir, subject: resolve(args.subject) } }));
  if (args.out) writeFileSync(args.out, JSON.stringify({ results, summary }, null, 1) + '\n');
  process.exit(summary.failed ? 1 : 0);
}
