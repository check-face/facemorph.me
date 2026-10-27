#!/usr/bin/env node
// Every failing check of a release run in one place (operator, 28 October 2026): each job's failure step records the
// check, its numbers, the artifact holding what is needed to fix it locally and the exact local command that
// reproduces it; the report job lists them all in the run summary with links to those artifacts.
//
//   node scripts/ci/failures.mjs add --dir <dir> --check <name> --repro <command> [--bundle <artifact>]
//        [--numbers <file>] [--detail <text>]
//   node scripts/ci/failures.mjs summary --dir <dir> [--repo owner/name --run <id>]   (GITHUB_TOKEN for artifact links)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One failure record. Pure apart from reading the numbers file, which is kept whole up to 20 kB. */
export function record({ check, repro, bundle, numbers, detail }) {
  if (!check || !repro) throw new Error('a failure needs --check and --repro');
  const text =
    numbers && existsSync(numbers) ? readFileSync(numbers, 'utf8').slice(0, 20000) : null;
  return { check, repro, bundle: bundle ?? null, numbers: text, detail: detail ?? null };
}

/** The summary's Markdown: one row per failure, then each one's numbers and repro command. Pure. */
export function markdown(failures, links = {}) {
  if (!failures.length) return '## Release checks\n\nNo check failed.\n';
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const link = (f) =>
    f.bundle ? (links[f.bundle] ? `[${f.bundle}](${links[f.bundle]})` : f.bundle) : '–';
  const md = [
    `## ${failures.length} failing check${failures.length === 1 ? '' : 's'}`,
    '',
    '| Check | Detail | Failure bundle | Local repro |',
    '|---|---|---|---|',
    ...failures.map(
      (f) => `| ${cell(f.check)} | ${cell(f.detail ?? '–')} | ${link(f)} | \`${cell(f.repro)}\` |`,
    ),
  ];
  for (const f of failures.filter((x) => x.numbers))
    md.push('', `### ${f.check}`, '', '```', f.numbers.trimEnd(), '```');
  return `${md.join('\n')}\n`;
}

export function load(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((n) => String(n).endsWith('.failure.json'))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(dir, String(n)), 'utf8')));
}

async function artifactLinks(repo, run, token) {
  if (!repo || !run || !token) return {};
  const links = {};
  for (let page = 1; page < 10; page++) {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${run}/artifacts?per_page=100&page=${page}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } },
    );
    if (!r.ok) break;
    const { artifacts } = await r.json();
    for (const a of artifacts)
      links[a.name] = `https://github.com/${repo}/actions/runs/${run}/artifacts/${a.id}`;
    if (artifacts.length < 100) break;
  }
  return links;
}

if (import.meta.main) {
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      check: { type: 'string' },
      repro: { type: 'string' },
      bundle: { type: 'string' },
      numbers: { type: 'string' },
      detail: { type: 'string' },
      repo: { type: 'string' },
      run: { type: 'string' },
    },
  });
  if (!o.dir || !['add', 'summary'].includes(positionals[0])) {
    console.error('usage: failures.mjs add|summary --dir <dir> ...');
    process.exit(2);
  }
  if (positionals[0] === 'add') {
    mkdirSync(o.dir, { recursive: true });
    const f = record(o);
    writeFileSync(join(o.dir, `${slug(f.check)}.failure.json`), JSON.stringify(f, null, 2));
    console.log(`recorded failure: ${f.check}\n  reproduce locally: ${f.repro}`);
  } else {
    const failures = load(o.dir);
    const text = markdown(failures, await artifactLinks(o.repo, o.run, process.env.GITHUB_TOKEN));
    if (process.env.GITHUB_STEP_SUMMARY)
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: 'a' });
    console.log(text);
  }
}
