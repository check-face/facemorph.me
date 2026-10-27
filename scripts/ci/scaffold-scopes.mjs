// Only audited orchestration changes can defer package npm suites on ordinary main. The full manual gate
// bypasses this selector. Runtime/interception helpers have real cross-workspace callers and are not on this list.
const ORCHESTRATION_FILES = new Set([
  'scripts/ci/changes.ts',
  'scripts/ci/changes.test.ts',
  'scripts/ci/path-filters.ts',
  'scripts/ci/path-filters.json',
  'scripts/ci/path-filters.test.ts',
  'scripts/ci/pre-deploy.ts',
  'scripts/ci/pre-deploy.test.ts',
  'scripts/ci/workspace-build.mjs',
  'scripts/ci/workspace-build.test.mjs',
  'scripts/ci/scaffold-test-shards.mjs',
  'scripts/ci/scaffold-test-shards.test.mjs',
  'scripts/ci/scaffold-scopes.mjs',
  'scripts/ci/scaffold-scopes.test.mjs',
  'scripts/ci/shared-build.test.ts',
]);
const PACKAGE_SUITES = new Set([
  'packages/stylegan-js',
  'packages/browser-model-manager',
  'packages/cloudflare-model-host',
]);
const retained = (suite) => suite.cwd === '' || suite.cwd === 'apps/web';

function relativePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !/^[a-z]:/i.test(path) &&
    !path.includes('\\') &&
    !Array.from(path, (character) => character.charCodeAt(0)).some(
      (code) => code < 32 || code === 127,
    ) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

/** Keep cwd, runner and file lists intact. Missing history, mixed changes and unknown suite roots retain all. */
export function scopeInventory(suites, changedFiles) {
  const all = () => ({ run: suites, deferred: [] });
  if (changedFiles == null) return all();
  if (!Array.isArray(changedFiles) || !Array.from(changedFiles).every(relativePath))
    throw Error('scaffold scopes require an array of repository-relative paths or null');
  if (
    changedFiles.length === 0 ||
    !changedFiles.every(
      (path) => /^\.github\/workflows\/[^/]+\.yml$/.test(path) || ORCHESTRATION_FILES.has(path),
    ) ||
    suites.some((suite) => !retained(suite) && !PACKAGE_SUITES.has(suite.cwd))
  )
    return all();
  return {
    run: suites.filter(retained),
    deferred: suites.filter((suite) => !retained(suite)),
  };
}
