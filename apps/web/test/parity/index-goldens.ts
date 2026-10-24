// Indexes the goldens the parity spec wrote with RECORD=1 (test/goldens/control/<rowId>/<project>/) in
// test/goldens/goldens.json, section parity-spec: per parity row its tag, plan and files per project, plus the
// control, recorder command, oracle and blind spots. Run after a recording run:
//   node apps/web/test/parity/index-goldens.ts
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readIndex, writeIndex } from '../goldens/index-file.ts';
import { REPO } from './control-server.ts';
import { ROWS } from './rows.ts';

const control = new URL('../goldens/control/', import.meta.url);
const record = JSON.parse(readFileSync(`${REPO}/import/control-artifact.json`, 'utf8'));
const deployNext = record.files
  .filter((f: { path: string }) => f.path.startsWith('deploy-next/'))
  .map((f: { path: string; sha256: string }) => `${f.sha256}  ${f.path}\n`)
  .join('');
const flows = readIndex().sections['flows'];

const rows = ROWS.filter((r) => r.tag === 'parity').map((r) => {
  const files: Record<string, string[]> = {};
  for (const project of ['desktop', 'phone']) {
    const dir = new URL(`${r.rowId}/${project}/`, control);
    if (existsSync(dir))
      files[project] = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => `control/${r.rowId}/${project}/${f}`);
  }
  return {
    id: r.rowId,
    freeze: r.tag,
    journey: r.journey,
    plan: r.plan,
    variants: r.variants,
    files,
    ...(Object.keys(files).length
      ? {}
      : {
          note: 'Asserted by the spec; no journey-step golden kept (the row checks downloads, sharing or a reload).',
        }),
  };
});

writeIndex('parity-spec', {
  control: {
    label: record.label,
    commit: record.source.commit,
    release_sha256: record.release.sha256,
    deploy_next_sha256: createHash('sha256').update(deployNext).digest('hex'),
  },
  recorder: {
    command:
      'python3 autoresearch/run.py --lane browser-cpu --device eris --wait 900 --timeout 3600 -- env RECORD=1 npx --prefix apps/web playwright test -c apps/web/test/parity/playwright.config.ts && node apps/web/test/parity/index-goldens.ts',
    spec: 'apps/web/test/parity/flow-matrix.spec.ts (rows: apps/web/test/parity/rows.ts)',
    projects: { desktop: '1280 x 900, mouse', phone: '390 x 844, touch, mobile' },
    browser: 'Playwright Chromium (1.64.1), WebGPU switched off at launch: the CPU route',
    oracle:
      (flows?.recorder as { oracle?: string } | undefined)?.oracle ??
      'journey-step snapshots of the Elmish model and the DOM',
    blind_spots: (flows?.recorder as { blind_spots?: string[] } | undefined)?.blind_spots ?? [],
    privacy:
      'no photo bytes, latents or typed inputs beyond the synthetic fixture words and seeds (test/build/goldens.test.ts)',
  },
  rows,
});
console.log(
  JSON.stringify({
    parityRows: rows.length,
    withGoldens: rows.filter((r) => Object.keys(r.files).length).length,
  }),
);
