#!/usr/bin/env node
// fm-fy2.4 scaffold checks: package-manager monogamy, exact workspaces, strictness that
// nothing overrides, the Oxc tools as caret ranges and the Oxc script contract.
//   node scripts/build/check-scaffold.mjs [--root .]
// Prints one JSON line per violation; exit 1 if any. The judge functions are exported for
// unit tests; the file reads are the only I/O.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORKSPACES = [
  'apps/web',
  'packages/stylegan-js',
  'packages/browser-model-manager',
  'packages/cloudflare-model-host',
  'packages/model-conv',
];
export const BANNED_LOCKFILES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
];
export const BANNED_ORCHESTRATORS = ['turbo.json', 'nx.json', 'lerna.json'];
export const STRICT_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'isolatedModules',
];
export const OXC_SCRIPTS = {
  lint: 'oxlint --deny-warnings',
  'lint:fix': 'oxlint --fix',
  format: 'oxfmt',
  'format:check': 'oxfmt --check',
};

const stripJsonComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');

export function checkWorkspaces(pkg) {
  const violations = [];
  if (JSON.stringify(pkg.workspaces) !== JSON.stringify(WORKSPACES)) {
    violations.push({
      rule: 'workspaces-exact',
      detail: `root workspaces must be exactly ${JSON.stringify(WORKSPACES)}`,
    });
  }
  return violations;
}

export function checkStrictness(baseConfig, packageConfigs) {
  const violations = [];
  for (const flag of STRICT_FLAGS) {
    if (baseConfig.compilerOptions?.[flag] !== true)
      violations.push({ rule: 'base-strict', detail: `tsconfig.base.json ${flag} must be true` });
  }
  for (const [path, config] of Object.entries(packageConfigs)) {
    for (const flag of STRICT_FLAGS) {
      const value = config.compilerOptions?.[flag];
      if (value !== undefined && value !== true)
        violations.push({ rule: 'strict-override', detail: `${path} lowers ${flag}` });
    }
  }
  return violations;
}

export function checkScripts(pkg) {
  const violations = [];
  for (const [name, expected] of Object.entries(OXC_SCRIPTS)) {
    if (pkg.scripts?.[name] !== expected)
      violations.push({
        rule: 'oxc-script',
        detail: `scripts.${name} must be exactly "${expected}"`,
      });
  }
  // Latest releases as caret ranges, never an exact pin or a held-back version (operator, 24 October 2026).
  for (const name of ['oxlint', 'oxfmt']) {
    const version = pkg.devDependencies?.[name];
    if (!/^\^\d+\.\d+\.\d+/.test(version ?? ''))
      violations.push({
        rule: 'oxc-caret',
        detail: `${name} must be a caret range at its latest release, got "${version}"`,
      });
  }
  return violations;
}

export function checkLayout(files) {
  const violations = [];
  for (const banned of [...BANNED_LOCKFILES, ...BANNED_ORCHESTRATORS]) {
    if (files.includes(banned)) violations.push({ rule: 'banned-file', detail: banned });
  }
  return violations;
}

// oxfmt's own option names (node_modules/oxfmt/configuration_schema.json): width 100, two spaces, no tabs, and
// both sortings off (imports, and package.json fields, which oxfmt sorts by default).
export function checkOxfmtConfig(config) {
  const violations = [];
  if (config.printWidth !== 100)
    violations.push({ rule: 'oxfmt-width', detail: 'printWidth must be 100' });
  if (config.tabWidth !== 2 || config.useTabs !== false)
    violations.push({ rule: 'oxfmt-indent', detail: 'tabWidth must be 2 with useTabs false' });
  if (config.sortImports !== false)
    violations.push({ rule: 'oxfmt-imports', detail: 'sortImports must be false' });
  if (config.sortPackageJson !== false)
    violations.push({ rule: 'oxfmt-packages', detail: 'sortPackageJson must be false' });
  return violations;
}

// Correctness as errors, native TypeScript, React with the hooks rules, and browser, worker and Node overrides.
export function checkOxlintConfig(config) {
  const violations = [];
  if (config.categories?.correctness !== 'error')
    violations.push({
      rule: 'oxlint-correctness',
      detail: 'categories.correctness must be "error"',
    });
  for (const plugin of ['typescript', 'react'])
    if (!config.plugins?.includes(plugin))
      violations.push({ rule: 'oxlint-plugin', detail: `plugins must include ${plugin}` });
  for (const rule of ['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps'])
    if (!config.rules?.[rule])
      violations.push({ rule: 'oxlint-hooks', detail: `rules must enable ${rule}` });
  const envs = new Set(
    (config.overrides ?? []).flatMap((o) => Object.keys(o.env ?? {}).filter((k) => o.env[k])),
  );
  for (const env of ['browser', 'worker', 'node'])
    if (!envs.has(env))
      violations.push({
        rule: 'oxlint-override',
        detail: `an override must set the ${env} environment`,
      });
  return violations;
}

// Both tools ignore exactly the declared scope (scripts/build/oxc-scope.json), so format and lint cover the same files.
export function checkScope(scope, oxfmt, oxlint) {
  const violations = [];
  for (const [name, config] of [
    ['.oxfmtrc.json', oxfmt],
    ['.oxlintrc.json', oxlint],
  ]) {
    if (JSON.stringify(config.ignorePatterns) !== JSON.stringify(scope.ignore))
      violations.push({
        rule: 'oxc-scope',
        detail: `${name} ignorePatterns must equal scripts/build/oxc-scope.json ignore`,
      });
  }
  for (const frozen of [
    'autoresearch/benchmark-campaign-v2/',
    'autoresearch/candidates/',
    'autoresearch/devices/',
    'autoresearch/history/',
    'autoresearch/reviews/',
    'autoresearch/templates/',
    'apps/web/src/Next/',
    '.beads/',
  ]) {
    if (!scope.ignore.includes(`${frozen}**`))
      violations.push({ rule: 'oxc-frozen', detail: `${frozen} must be ignored` });
  }
  return violations;
}

// Every tracked top-level directory is either covered by the gates (scope.included) or declared outside them with
// its reason (scope.outside), so a new root cannot fall outside formatting and lint unnoticed.
export function checkRoots(scope, roots) {
  const violations = [];
  for (const root of roots) {
    if (!scope.included.includes(root) && !(root in (scope.outside ?? {})))
      violations.push({
        rule: 'oxc-root',
        detail: `${root}/ is neither included in nor declared outside scripts/build/oxc-scope.json`,
      });
  }
  for (const root of [...scope.included, ...Object.keys(scope.outside ?? {})])
    if (!roots.includes(root))
      violations.push({
        rule: 'oxc-root-stale',
        detail: `${root}/ is declared in scripts/build/oxc-scope.json but not tracked`,
      });
  return violations;
}

// No floating installs anywhere CI or scripts run: npm ci only, no @latest, no npx <pkg>@<version>.
export function checkInstalls(files) {
  const violations = [];
  for (const [path, text] of files) {
    if (/@latest\b/.test(text))
      violations.push({ rule: 'install-latest', detail: `${path} uses @latest` });
    if (/\bnpx\s+(-y\s+)?[@\w./-]+@\d/.test(text))
      violations.push({ rule: 'install-npx-version', detail: `${path} runs npx <pkg>@<version>` });
    if (/\bnpm\s+(install|i)\b/.test(text))
      violations.push({
        rule: 'install-npm-install',
        detail: `${path} runs npm install (CI uses npm ci)`,
      });
  }
  return violations;
}

// No exact versions (operator, 24 October 2026): every dependency in every package.json is a range, a caret range at
// the latest release when it is added or upgraded. A bare x.y.z specifier is a pin. PIN_EXEMPT names the only ones
// left, each with the bead that removes it.
export const PIN_EXEMPT = {
  'services/stats/package.json devDependencies wrangler':
    'fm-oop0 removes Wrangler (Cloudflare work uses the cf CLI)',
};
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
export function checkNoPins(manifests, exempt = PIN_EXEMPT) {
  const violations = [];
  for (const [path, pkg] of manifests)
    for (const section of SECTIONS)
      for (const [name, spec] of Object.entries(pkg[section] ?? {}))
        if (
          /^=?v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(String(spec)) &&
          !exempt[`${path} ${section} ${name}`]
        )
          violations.push({
            rule: 'pinned-version',
            detail: `${path} ${section} ${name} is pinned at ${spec}: use a caret range at latest`,
          });
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const root = args.includes('--root')
    ? args[args.indexOf('--root') + 1]
    : fileURLToPath(new URL('../..', import.meta.url));
  const read = (path) => JSON.parse(stripJsonComments(readFileSync(`${root}/${path}`, 'utf8')));
  const violations = [];

  const pkg = read('package.json');
  violations.push(...checkWorkspaces(pkg));
  violations.push(...checkScripts(pkg));
  violations.push(...checkLayout(readdirSync(root)));

  const baseConfig = read('tsconfig.base.json');
  const packageConfigs = {};
  for (const workspace of WORKSPACES) {
    const tsconfig = `${workspace}/tsconfig.json`;
    if (existsSync(`${root}/${tsconfig}`)) packageConfigs[tsconfig] = read(tsconfig);
  }
  violations.push(...checkStrictness(baseConfig, packageConfigs));
  const oxfmt = read('.oxfmtrc.json'),
    oxlint = read('.oxlintrc.json');
  violations.push(
    ...checkOxfmtConfig(oxfmt),
    ...checkOxlintConfig(oxlint),
    ...checkScope(read('scripts/build/oxc-scope.json'), oxfmt, oxlint),
  );
  const roots = execFileSync('git', ['-C', root, 'ls-tree', '-d', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  violations.push(...checkRoots(read('scripts/build/oxc-scope.json'), roots));
  const workflows = readdirSync(`${root}/.github/workflows`)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [`.github/workflows/${f}`, readFileSync(`${root}/.github/workflows/${f}`, 'utf8')]);
  violations.push(...checkInstalls(workflows));
  const manifests = execFileSync('git', ['-C', root, 'ls-files', '*package.json'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(
      (f) =>
        f.endsWith('package.json') && !f.includes('node_modules/') && existsSync(`${root}/${f}`),
    )
    .map((f) => [f, read(f)]);
  violations.push(...checkNoPins(manifests));

  for (const v of violations) console.log(JSON.stringify(v));
  if (violations.length > 0) {
    console.error(`scaffold: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.error('scaffold: OK');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
