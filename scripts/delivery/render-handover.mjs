#!/usr/bin/env node
// Writes scripts/delivery/handover.md from scripts/delivery/runbook.json (fm-5u9), so the action list the delivery
// beads read and the commands the dry run checks are one source. --check fails when the committed handover.md is not
// what the runbook renders.
//   node scripts/delivery/render-handover.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const code = (s) => '`' + String(s).replaceAll('`', "'") + '`';
const cell = (s) =>
  String(s ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');

/** The rollback target named concretely: label, build id, source and digest where the artifact has one. */
export function rollbackTarget(runbook, ref) {
  const a = runbook.artifacts[ref.replace(/^artifacts\./, '')];
  if (!a) throw new Error(`unknown rollback target ${ref}`);
  const digest = a.deployNextSha256 ? `, deploy-next digest ${code(a.deployNextSha256)}` : '';
  return `${a.label}: ${a.buildId}, ${code(a.source)}${digest}`;
}

export function render(runbook) {
  const out = [];
  const p = (...lines) => out.push(...lines);
  p(
    '# Handover and retirement actions',
    '',
    `Generated from ${code('scripts/delivery/runbook.json')} by ${code('scripts/delivery/render-handover.mjs')} (fm-5u9); edit the runbook, not this file. ` +
      `Every command here runs in its dry-run or read-only form in CI (${code('scripts/delivery/dry-run.mjs')}, workflow ${code('delivery-dry-run')}). ` +
      'Nothing here has been executed. The operator chooses timing and order; Cloudflare commands use the cf CLI, never Wrangler. ' +
      `Observed read-only on ${runbook.observed_at}.`,
    '',
    `Zone ${code(runbook.zone.name)} is ${code(runbook.zone.id)}; account ${code(runbook.account)}.`,
    '',
    '## Rollback targets',
    '',
    '| Artifact | Build | Source | Digest |',
    '| --- | --- | --- | --- |',
  );
  for (const [key, a] of Object.entries(runbook.artifacts))
    p(
      `| ${cell(a.label)} (${code(key)}) | ${cell(a.buildId)} | ${code(a.source)} | ${a.deployNextSha256 ? code(a.deployNextSha256) : 'none (not an on-device artifact)'} |`,
    );
  p(
    '',
    '## Retirement inventory',
    '',
    'Remove items run at the action named in "When"; keep items stay, with the reason.',
    '',
  );
  p(
    '| Item | Target | Disposition | When | Reason | Command | Dry run |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of runbook.retirement)
    p(
      `| ${code(r.id)} | ${cell(r.target)} | ${r.disposition} | ${cell(r.when)} | ${cell(r.reason)} | ${r.command ? code(r.command) : 'none'} | ${r.dryRun ? code(['cf', ...r.dryRun.argv].join(' ')) : cell(r.noDryRun)} |`,
    );
  p('', '## Source references', '', '| Reference | Disposition |', '| --- | --- |');
  for (const r of runbook.references) p(`| ${cell(r.path)} | ${cell(r.disposition)} |`);
  p('', '## Actions');
  for (const a of runbook.actions) {
    p(
      '',
      `### ${a.title}`,
      '',
      `- **Action:** ${code(a.id)}`,
      `- **Owner:** ${a.owner}`,
      '- **Preconditions:**',
    );
    for (const c of a.preconditions) p(`  - ${c}`);
    p('- **Commands:**');
    for (const c of a.commands) p(`  - ${c}`);
    if (a.dryRun) p(`  - Dry run: ${code(['cf', ...a.dryRun.argv].join(' '))}`);
    p(
      `- **Rollback target:** ${rollbackTarget(runbook, a.rollback.target)}`,
      '- **Rollback steps:**',
    );
    for (const s of a.rollback.steps) p(`  - ${s}`);
    p(`- **One publisher:** ${a.onePublisher}`, `- **Post-delivery check:** ${code(a.check)}`);
    if (a.annotate) p(`- **Cutover annotation:** ${code(a.annotate)}`);
  }
  const n = runbook.namesHost;
  p(
    '',
    '## Names host',
    '',
    `- **Before:** ${n.before.dns}; ${code('GET /')} answered ${n.before.status} with ${n.before.bodyBytes} bytes (SHA-256 ${code(n.before.bodySha256Prefix + '…')}); ${n.before.deployment}.`,
    '- **Redirect:**',
  );
  for (const c of n.redirect) p(`  - ${c.startsWith('cf ') ? code(c) : c}`);
  p(`  - Dry run: ${code(['cf', ...n.dryRun.argv].join(' '))}`, '- **Rollback:**');
  for (const c of n.rollback) p(`  - ${c.startsWith('cf ') ? code(c) : c}`);
  p(
    `- **Check:** ${code(n.check)}`,
    `- **What it may claim:** ${n.claims}`,
    `- **facemorph-names archive notice:** "${n.archiveNotice}"`,
    '',
    '## Second runtime origin',
    '',
    runbook.mirror.note,
    '',
  );
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runbook = JSON.parse(readFileSync(new URL('runbook.json', import.meta.url), 'utf8'));
  const target = new URL('handover.md', import.meta.url);
  const text = render(runbook);
  if (process.argv.includes('--check')) {
    const committed = readFileSync(target, 'utf8');
    if (committed !== text) {
      console.error(
        'handover.md is not what runbook.json renders: run node scripts/delivery/render-handover.mjs',
      );
      process.exit(1);
    }
    console.log(JSON.stringify({ handover: 'matches runbook.json' }));
  } else writeFileSync(target, text);
}
