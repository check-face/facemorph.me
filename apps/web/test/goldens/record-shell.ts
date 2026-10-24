// Records the shell rows' goldens from the control (fm-svg): fetch-control first (it fails closed), then the
// control's deploy-next/ served locally, read at desktop and phone width in Chromium. Writes
// test/goldens/control/<row>/<width>.json and test/goldens/goldens.json.
//   node test/goldens/record-shell.ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../support/serve.ts';
import { SHELL_ROWS, SNAPSHOT_IN_PAGE } from './snapshot.ts';

export const WIDTHS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
const repo = new URL('../../../../', import.meta.url);
const out = new URL('./', import.meta.url);

const fetched = execFileSync(process.execPath, [new URL('scripts/import/fetch-control.mjs', repo).pathname], { encoding: 'utf8' });
const summary = JSON.parse(fetched.trim().split('\n').at(-1) ?? '{}').summary;
if (!summary?.ok) throw new Error(`fetch-control refused the control: ${fetched}`);
const record = JSON.parse(readFileSync(new URL('import/control-artifact.json', repo), 'utf8'));
const deployNext = record.files.filter((f: { path: string }) => f.path.startsWith('deploy-next/'));
const deployNextSha256 = createHash('sha256').update(deployNext.map((f: { path: string; sha256: string }) => `${f.sha256}  ${f.path}\n`).join('')).digest('hex');

const site = await serve(`${summary.dir}/deploy-next`);
const browser = await chromium.launch();
try {
  for (const [width, viewport] of Object.entries(WIDTHS)) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${site.origin}/`);
    await page.waitForSelector('footer.next-footer');
    const rows = await page.evaluate(`(${SNAPSHOT_IN_PAGE})(${JSON.stringify(SHELL_ROWS)})`) as Record<string, unknown>;
    for (const row of SHELL_ROWS) {
      if (!rows[row.id]) throw new Error(`${row.id}: ${row.selector} not found in the control`);
      mkdirSync(new URL(`control/${row.id}/`, out), { recursive: true });
      writeFileSync(new URL(`control/${row.id}/${width}.json`, out), JSON.stringify(rows[row.id], null, 1) + '\n');
    }
    await page.close();
  }
} finally {
  await browser.close();
  await site.close();
}
writeFileSync(new URL('goldens.json', out), JSON.stringify({
  schema: 'facemorph.goldens/1',
  control: { label: record.label, commit: record.source.commit, release_sha256: record.release.sha256, deploy_next_sha256: deployNextSha256 },
  recorder: { command: 'node test/goldens/record-shell.ts', browser: `chromium ${browser.version()}`, widths: WIDTHS },
  rows: SHELL_ROWS.map((r) => ({ id: r.id, selector: r.selector, freeze: r.freeze, ...(r.note ? { note: r.note } : {}), files: Object.keys(WIDTHS).map((w) => `control/${r.id}/${w}.json`) })),
  owner_graded: [],
  untested: [],
}, null, 1) + '\n');
console.log(JSON.stringify({ recorded: SHELL_ROWS.length, widths: Object.keys(WIDTHS), deploy_next_sha256: deployNextSha256 }));
