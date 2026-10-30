#!/usr/bin/env node
// Which checks a push needs after its build (fm-3yqf, operator 30 October 2026: "approx 10 minute ci loops, and
// select the tests we need"). One explicit path->check map, first matching rule wins, for every changed path:
//   functional  the operated e2e suites (apps/web/test/e2e/<name>.e2e.ts) that run beside the release's journeys
//   timing      the paired CPU timing segments against the pinned control (face, morph, photo), in qualify.yml
//   engine      the engine numerics (full31, CPU and browser routes), in qualify.yml
//   cells       the six local cells and the phone pairs against live next, in qualify.yml
// A path no rule names selects everything (fail safe), as do a missing base and an empty diff. Docs, beads and unit
// tests (check.yml runs those) select nothing. A changed release suite selects itself. Shared app code (shell core,
// controller, styles) selects every functional suite; the engine, runtime, packages and model inputs select
// everything. The full set stays one dispatch away (qualify.yml full=true).
//   node scripts/ci/select-checks.mjs --head <sha> [--base <sha>] [--full]
//   one JSON line; appends functional=<json array>, timing=<json array>, engine, cells, full and any to $GITHUB_OUTPUT
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The verify.functional manifest's suites (apps/web/test/verify/cases/verify-functional.ts). Kept in step by a test. */
export const MANIFEST_SUITES = [
  'batch',
  'crop-acceptance',
  'encode',
  'face-controls',
  'face-many',
  'help',
  'names',
  'provider-selector',
  'session-words',
  'shell',
  'still-entry',
];
/** The other product beads' operated suites, formerly qualify.yml's OPERATED list. */
export const OPERATED_SUITES = [
  'blend',
  'consent-requests',
  'crop-journey',
  'debug-reporting',
  'dialogs',
  'encoder-setup',
  'morph-guards',
  'morph-intent',
  'morph-output',
  'morph-progress',
  'result-actions',
  'tiles',
  'tooltip-hits',
];
export const SUITES = [...new Set([...MANIFEST_SUITES, ...OPERATED_SUITES])].sort();
export const SEGMENTS = ['face', 'morph', 'photo'];

const ALL = 'all';
const PHOTO = [
  'batch',
  'blend',
  'consent-requests',
  'crop-acceptance',
  'crop-journey',
  'dialogs',
  'encode',
  'face-many',
  'session-words',
  'still-entry',
];
const MORPH = [
  'morph-guards',
  'morph-intent',
  'morph-output',
  'morph-progress',
  'result-actions',
  'session-words',
];
const FACES = [
  'face-controls',
  'face-many',
  'morph-intent',
  'names',
  'session-words',
  'tiles',
  'tooltip-hits',
];
const DIALOGS = ['consent-requests', 'debug-reporting', 'dialogs', 'help'];
const CONSENT = ['consent-requests', 'dialogs', 'encoder-setup', 'provider-selector'];

const W = 'apps/web';
const R = `${W}/shell/render`;
const C = `${W}/src/controller`;
/**
 * First match wins. `functional`: suite names, ALL, or omitted (none). `timing`: segments or ALL. `engine`, `cells`:
 * booleans. `everything: true` selects every check. Ordered from the most specific path to the broadest.
 */
export const RULES = [
  // Nothing a visitor gets, or covered by check.yml (unit tests, lint, typecheck, build).
  {
    name: 'docs, beads and records',
    paths: [
      '**/*.md',
      '.beads/**',
      'docs/**',
      'autoresearch/**',
      'inventory/**',
      'ops/**',
      '.github/ISSUE_TEMPLATE/**',
      'LICENSE*',
    ],
  },
  {
    name: 'unit tests (check.yml)',
    paths: ['**/*.test.ts', '**/*.test.mjs', '**/*.test.js', '**/*.test-d.ts', '**/*.test.py'],
  },
  // CI definitions and tooling: a changed job is exercised by its own run, or by dispatching qualify.yml full=true,
  // not by every functional suite on every push. check.yml runs the scripts' unit tests.
  {
    name: 'CI workflows and tooling',
    paths: [
      '.github/**',
      'scripts/ci/select-checks.mjs',
      'scripts/ci/affected.mjs',
      'scripts/ci/scaffold-*.mjs',
      'scripts/ci/failures.mjs',
      'scripts/ci/release-local.mjs',
      'scripts/beads/**',
      'scripts/hooks/**',
      'scripts/packages/**',
    ],
  },
  { name: 'device lab', paths: ['tools/device-lab/**'], cells: true },
  {
    name: 'timing harness',
    paths: ['scripts/verify/not-worse/**', 'scripts/ci/release-checks.mjs'],
    timing: ALL,
  },
  {
    name: 'deploy and delivery',
    paths: ['hosting/**', 'scripts/hosting/**', 'scripts/delivery/**'],
    cells: true,
  },
  // A release suite's own file selects it; other e2e files are not release suites.
  { name: 'release suite', paths: [`${W}/test/e2e/*.e2e.ts`], self: true },
  {
    name: 'e2e support',
    paths: [`${W}/test/e2e/**`, `${W}/test/support/**`, `${W}/test/verify/**`],
    functional: ALL,
  },
  // The photo path: chooser, faces-first detection, crop editor, encoder input.
  {
    name: 'photo and crop',
    paths: [
      `${R}/CropEditor.tsx`,
      `${R}/crop.css`,
      `${W}/src/Next/photo/**`,
      `${W}/src/Next/photo-selection.mjs`,
      `${W}/src/Next/image-encoder*.mjs`,
      `${W}/src/Next/image-envelope.mjs`,
      `${W}/src/photo/**`,
      `${W}/photo-native/**`,
      `${W}/photo-runtime/**`,
      `${W}/src/media/still-entry.ts`,
      `${C}/reducers/crop.ts`,
      `${C}/reducers/photo.ts`,
      `${C}/geometry.ts`,
    ],
    functional: [...PHOTO, 'result-actions'],
    timing: ['photo'],
  },
  {
    name: 'batch',
    paths: [
      `${R}/BatchDialog.tsx`,
      `${R}/batch.css`,
      `${C}/batch-selection.ts`,
      `${C}/reducers/batch.ts`,
    ],
    functional: ['batch', 'blend', 'face-many', 'still-entry'],
  },
  { name: 'blend styles', paths: [`${R}/blend.css`], functional: ['blend'] },
  {
    name: 'blend',
    paths: [
      `${R}/BlendView.tsx`,
      `${W}/shell/blend-route.ts`,
      `${C}/blend.ts`,
      `${C}/reducers/blend.ts`,
    ],
    functional: ['blend', 'result-actions'],
  },
  {
    name: 'morph scheduling',
    paths: [`${C}/reducers/jobs.ts`, `${C}/reducers/schedule.ts`, `${W}/src/Next/morph-frames.mjs`],
    functional: MORPH,
    timing: ['morph'],
  },
  // The Save/Share row's file preparation (result-actions; paths from MossyFalcon, fm-7u7z).
  {
    name: 'export and recovery files',
    paths: [
      `${W}/src/Next/export-files.mjs`,
      `${W}/src/Next/recovery-metadata.mjs`,
      `${W}/src/Next/video-worker.mjs`,
      `${W}/src/contracts/prepared-file-cache.ts`,
      `${W}/src/contracts/export-identity*`,
      `${W}/src/media/export-policy.ts`,
    ],
    functional: ['morph-output', 'result-actions'],
  },
  {
    name: 'morph view and result',
    paths: [
      `${R}/MorphSlot.tsx`,
      `${R}/VideoSlot.tsx`,
      `${R}/progress.tsx`,
      `${R}/estimate.ts`,
      `${R}/morph-output.css`,
      `${R}/ResultActions.tsx`,
      `${R}/result-actions.css`,
      `${C}/morph-options.ts`,
      `${C}/reducers/slider.ts`,
      `${W}/src/Next/estimate.mjs`,
      `${W}/src/Next/export-files.mjs`,
      `${W}/src/Next/last-result.mjs`,
      `${W}/src/media/**`,
    ],
    functional: [...MORPH, 'debug-reporting'],
  },
  {
    name: 'faces and tiles',
    paths: [
      `${R}/FaceTile.tsx`,
      `${R}/FacesLayout.tsx`,
      `${R}/faces-many.css`,
      `${R}/faces-mode.ts`,
      `${R}/Connectors.tsx`,
      `${R}/FaceField.tsx`,
      `${R}/ModeSwitch.tsx`,
      `${R}/mode-switch.css`,
      `${R}/FancyButton.tsx`,
      `${R}/undo-canvas.ts`,
      `${C}/reducers/inputs.ts`,
      `${C}/reducers/names.ts`,
      `${C}/reducers/undo.ts`,
      `${W}/src/Next/name-results.mjs`,
    ],
    functional: [...FACES, 'result-actions'],
  },
  {
    name: 'dialogs and help',
    paths: [
      `${R}/Dialogs.tsx`,
      `${R}/DialogCheck.tsx`,
      `${R}/Support.tsx`,
      `${R}/Explain.tsx`,
      `${R}/Notes.tsx`,
      `${R}/help.ts`,
      `${R}/model-licences.ts`,
      `${R}/StoredData.tsx`,
      `${W}/shell/links.ts`,
      `${C}/reducers/reporting.ts`,
    ],
    functional: DIALOGS,
  },
  {
    name: 'provider selector',
    paths: [`${R}/ProviderSelector.tsx`],
    functional: ['provider-selector'],
  },
  {
    name: 'consent and downloads',
    paths: [
      `${W}/src/consent/**`,
      `${W}/src/admission/**`,
      `${C}/download-decision.ts`,
      `${C}/download-storage.ts`,
      `${C}/admission.ts`,
      `${C}/reducers/gate.ts`,
    ],
    functional: [...CONSENT, 'debug-reporting'],
  },
  {
    name: 'diagnostics and usage',
    paths: [
      `${W}/src/analytics/**`,
      `${W}/src/Next/analytics.mjs`,
      `${W}/src/Next/reporting.mjs`,
      `${W}/src/Next/usage-stats.mjs`,
      `${W}/src/Next/logging*.mjs`,
      `${W}/shell/facade/usage-stats.ts`,
    ],
    functional: ['debug-reporting', 'dialogs'],
  },
  // Shared app code: the whole UI can change, the engine and its timing cannot.
  {
    name: 'shared app code',
    paths: [
      `${W}/shell/render/**`,
      `${W}/shell/style/**`,
      `${W}/shell/facade/**`,
      `${W}/shell/session/**`,
      `${W}/shell/*.tsx`,
      `${W}/shell/theme.ts`,
      `${W}/shell/links.ts`,
      `${W}/shell/react-subscription.ts`,
      `${W}/src/controller/reducers/**`,
      `${W}/src/controller/*.ts`,
      `${W}/src/contracts/**`,
      `${W}/src/project/**`,
      `${W}/src/style.scss`,
      `${W}/src/Next/*.scss`,
      `${W}/src/Next/product-bridge.mjs`,
      `${W}/index.html`,
    ],
    functional: ALL,
  },
  // The browser runtime and the model inputs it loads: everything (below). Other product modules: the whole UI.
  {
    name: 'engine, runtime and build',
    paths: [
      `${W}/src/Next/browser/**`,
      `${W}/src/Next/model-inventory.mjs`,
      `${W}/src/Next/infill.mjs`,
    ],
    everything: true,
  },
  {
    name: 'product modules',
    paths: [`${W}/src/Next/*.mjs`, `${W}/src/Next/geometry/**`],
    functional: ALL,
  },
  // Engine, runtime and model inputs: everything, including timing, the numerics and the live cells.
  {
    name: 'engine, runtime and build',
    paths: [
      'packages/**',
      'import/**',
      `${W}/src/operations/**`,
      `${W}/src/preflight/**`,
      `${W}/src/Next/**`,
      `${W}/shell/workers.ts`,
      `${W}/build/**`,
      `${W}/vite.config.ts`,
      `${W}/package.json`,
      'package.json',
      'package-lock.json',
    ],
    everything: true,
  },
];

/** A path glob as a RegExp: `**` any depth, `*` within one segment, `?` one character. Pure. */
export function globRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // '**/' matches zero or more whole segments; a trailing '**' matches the rest.
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const COMPILED = RULES.map((rule) => ({ ...rule, res: rule.paths.map(globRegExp) }));

/** The rule a path falls under, or undefined (unknown: selects everything). Pure. */
export function ruleFor(path) {
  return COMPILED.find((rule) => rule.res.some((re) => re.test(path)));
}

const suiteOf = (path) => /\/test\/e2e\/([^/]+)\.e2e\.ts$/.exec(path)?.[1];

/**
 * The checks for the changed paths. `files` null (no usable base) or empty selects everything. Returns
 * {full, functional (sorted suite names), timing (segments), engine, cells, any, reasons: [{path, rule}]}. Pure.
 */
export function selectChecks(files, { full = false } = {}) {
  const everything = (reason) => ({
    full: true,
    reason,
    functional: [...SUITES],
    timing: [...SEGMENTS],
    engine: true,
    cells: true,
    any: true,
    reasons: [],
  });
  if (full) return everything('full run requested');
  if (files == null) return everything('no usable base');
  if (!files.length) return everything('no changed files');
  const functional = new Set();
  const timing = new Set();
  let engine = false;
  let cells = false;
  const reasons = [];
  for (const path of files) {
    const rule = ruleFor(path);
    reasons.push({ path, rule: rule?.name ?? 'unknown: everything' });
    if (!rule || rule.everything)
      return { ...everything(`${path}: ${rule?.name ?? 'no rule'}`), reasons };
    if (rule.self) {
      const suite = suiteOf(path);
      if (SUITES.includes(suite)) functional.add(suite);
    }
    for (const s of rule.functional === ALL ? SUITES : (rule.functional ?? [])) functional.add(s);
    for (const s of rule.timing === ALL ? SEGMENTS : (rule.timing ?? [])) timing.add(s);
    engine ||= Boolean(rule.engine);
    cells ||= Boolean(rule.cells);
  }
  const out = {
    full: false,
    reason: `${files.length} changed path(s)`,
    functional: SUITES.filter((s) => functional.has(s)),
    timing: SEGMENTS.filter((s) => timing.has(s)),
    engine,
    cells,
    reasons,
  };
  return { ...out, any: Boolean(out.functional.length || out.timing.length || engine || cells) };
}

/** Changed paths between two commits, or null when the base is missing or unknown here. */
export function changedFiles(base, head, cwd = ROOT) {
  if (!base || /^0+$/.test(base)) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({
    options: { head: { type: 'string' }, base: { type: 'string' }, full: { type: 'boolean' } },
  });
  const head = values.head ?? 'HEAD';
  const result = selectChecks(values.full ? [] : changedFiles(values.base, head), {
    full: values.full,
  });
  console.log(JSON.stringify({ base: values.base ?? null, head, ...result }));
  const out = process.env.GITHUB_OUTPUT;
  if (out && existsSync(out))
    appendFileSync(
      out,
      [
        `functional=${JSON.stringify(result.functional)}`,
        `timing=${JSON.stringify(result.timing)}`,
        `engine=${result.engine}`,
        `cells=${result.cells}`,
        `full=${result.full}`,
        `any=${result.any}`,
        '',
      ].join('\n'),
    );
}
