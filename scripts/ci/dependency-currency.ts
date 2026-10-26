/** Pure dependency-currency policy. Callers supply parsed files and independently computed mirror digests. */
export const ACTIVE_NODE_LTS_MAJOR = 24;

export interface CurrencyViolation {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface PackageManifest {
  readonly name?: string;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface Lockfile {
  readonly packages: Readonly<
    Record<string, { readonly version?: string; readonly name?: string; readonly link?: boolean }>
  >;
}

export interface MirrorFile {
  /** The same relative file identity in the manifest and the independently hashed file inventory. */
  readonly path: string;
  readonly sha256: string;
}

export interface RuntimeMirror {
  readonly version: string;
  readonly files: readonly MirrorFile[];
}

const number = '(?:0|[1-9]\\d*)';
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = `${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;
const version = new RegExp(`^${versionPattern}$`);
const caret = new RegExp(`^\\^${versionPattern}$`);
const prerelease = new RegExp(`^${number}\\.${number}\\.${number}-`);
const sections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const violation = (code: string, path: string, message: string): CurrencyViolation => ({
  code,
  path,
  message,
});

type Triple = readonly [number, number, number];
interface Bound {
  readonly value: Triple;
  readonly inclusive: boolean;
}
const compare = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Accept stable semver selectors only when every alternative stays inside the active LTS major. */
export function isActiveLtsNodeRange(range: string): boolean {
  const floor: Triple = [ACTIVE_NODE_LTS_MAJOR, 0, 0];
  const ceiling: Triple = [ACTIVE_NODE_LTS_MAJOR + 1, 0, 0];
  return range.split('||').every((alternative) => {
    let lower: Bound = { value: [0, 0, 0], inclusive: true };
    let upper: Bound = { value: [Infinity, 0, 0], inclusive: false };
    const constrain = (lo?: Bound, hi?: Bound) => {
      if (
        lo &&
        (compare(lo.value, lower.value) > 0 ||
          (compare(lo.value, lower.value) === 0 && !lo.inclusive))
      )
        lower = lo;
      if (
        hi &&
        (compare(hi.value, upper.value) < 0 ||
          (compare(hi.value, upper.value) === 0 && !hi.inclusive))
      )
        upper = hi;
    };
    const text = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+(?=\d)/g, '$1');
    if (!text) return false;
    for (const token of text.split(/\s+/)) {
      const match = token.match(
        /^(>=|<=|>|<|=|\^|~)?(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?$/,
      );
      if (!match) return false;
      const [, op = '', majorText = '', minorText, patchText] = match;
      const major = Number(majorText);
      const minor =
        minorText === undefined || /^(x|\*)$/.test(minorText) ? undefined : Number(minorText);
      const patch =
        patchText === undefined || /^(x|\*)$/.test(patchText) ? undefined : Number(patchText);
      if (minor === undefined && patch !== undefined) return false;
      const minimum: Triple = [major, minor ?? 0, patch ?? 0];
      const next: Triple = minor === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
      const partial = minor === undefined || patch === undefined;
      if (op === '^')
        constrain(
          { value: minimum, inclusive: true },
          { value: [major + 1, 0, 0], inclusive: false },
        );
      else if (op === '~')
        constrain({ value: minimum, inclusive: true }, { value: next, inclusive: false });
      else if (op === '>=') constrain({ value: minimum, inclusive: true });
      else if (op === '>') constrain({ value: partial ? next : minimum, inclusive: partial });
      else if (op === '<') constrain(undefined, { value: minimum, inclusive: false });
      else if (op === '<=')
        constrain(undefined, { value: partial ? next : minimum, inclusive: !partial });
      else if (partial)
        constrain({ value: minimum, inclusive: true }, { value: next, inclusive: false });
      else constrain({ value: minimum, inclusive: true }, { value: minimum, inclusive: true });
    }
    const nonempty =
      compare(lower.value, upper.value) < 0 ||
      (compare(lower.value, upper.value) === 0 && lower.inclusive && upper.inclusive);
    return (
      nonempty &&
      compare(lower.value, floor) >= 0 &&
      (compare(upper.value, ceiling) < 0 ||
        (compare(upper.value, ceiling) === 0 && !upper.inclusive))
    );
  });
}

function localReference(range: string): boolean {
  const match = range.match(/^(?:file|link):(.+)$/);
  return Boolean(match && !/^(?:\/|[A-Za-z]+:)/.test(match[1]!) && !/[\\\0]/.test(match[1]!));
}

export function validateManifest(
  input: { readonly path: string; readonly manifest: PackageManifest },
  policy: {
    readonly workspaceNames?: readonly string[];
    readonly requireNodeEngine?: boolean;
  } = {},
): CurrencyViolation[] {
  const errors: CurrencyViolation[] = [];
  const internal = new Set(policy.workspaceNames ?? []);
  for (const section of sections) {
    for (const [name, range] of Object.entries(input.manifest[section] ?? {})) {
      const workspaceRange = range.startsWith('workspace:')
        ? range.slice('workspace:'.length)
        : undefined;
      const workspace =
        internal.has(name) &&
        (range === '*' ||
          version.test(range) ||
          (workspaceRange !== undefined &&
            (['*', '^', '~'].includes(workspaceRange) ||
              version.test(workspaceRange) ||
              caret.test(workspaceRange) ||
              (workspaceRange.startsWith('~') && version.test(workspaceRange.slice(1))))));
      if (
        workspace ||
        localReference(range) ||
        range.split('||').every((part) => caret.test(part.trim()))
      )
        continue;
      errors.push(
        violation(
          'manifest-caret',
          input.path,
          `${section}.${name} must use a caret range, a declared workspace reference, or a local file/link reference; found ${JSON.stringify(range)}`,
        ),
      );
    }
  }
  const node = input.manifest.engines?.node;
  if (
    (node === undefined && policy.requireNodeEngine) ||
    (node !== undefined && !isActiveLtsNodeRange(node))
  )
    errors.push(
      violation(
        'node-lts',
        input.path,
        `engines.node must admit only Node ${ACTIVE_NODE_LTS_MAJOR} LTS; found ${JSON.stringify(node)}`,
      ),
    );
  return errors;
}

export function validateLockfile(
  input: { readonly path: string; readonly lockfile: Lockfile },
  policy: { readonly lane?: 'stable' | 'bleeding-edge' } = {},
): CurrencyViolation[] {
  const errors: CurrencyViolation[] = [];
  for (const [path, entry] of Object.entries(input.lockfile.packages)) {
    if (entry.link || !path.includes('node_modules/')) continue;
    if (!entry.version || !version.test(entry.version))
      errors.push(
        violation('lock-version', input.path, `${path} has no valid resolved semver version`),
      );
    else if (policy.lane !== 'bleeding-edge' && prerelease.test(entry.version))
      errors.push(
        violation(
          'lock-prerelease',
          input.path,
          `${path} resolves to prerelease ${entry.version} outside the bleeding-edge lane`,
        ),
      );
  }
  return errors;
}

function canonicalPath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !/[\\\0]/.test(path) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function frozenPath(path: string): boolean {
  return path
    .split('/')
    .some((part) => part === 'self-host' || part === 'classic' || part.endsWith('-classic'));
}

export function validateUpdaterPaths(
  paths: readonly string[],
  allowed: {
    readonly manifestPaths: readonly string[];
    readonly lockfilePaths: readonly string[];
    readonly runtimeManifestPaths: readonly string[];
  },
): CurrencyViolation[] {
  const permitted = new Set([
    ...allowed.manifestPaths.filter(
      (path) => path === 'package.json' || path.endsWith('/package.json'),
    ),
    ...allowed.lockfilePaths.filter(
      (path) => path === 'package-lock.json' || path.endsWith('/package-lock.json'),
    ),
    ...allowed.runtimeManifestPaths,
  ]);
  return paths
    .filter((path) => !canonicalPath(path) || frozenPath(path) || !permitted.has(path))
    .map((path) =>
      violation(
        'updater-path',
        path,
        'Updater changes may touch only the explicitly listed package manifests, lockfiles and runtime-mirror manifests outside classic/self-host',
      ),
    );
}

export function validateOrtMirror(input: {
  readonly lockfile: Lockfile;
  readonly lockfilePath: string;
  readonly mirror: RuntimeMirror;
  readonly mirrorPath: string;
  /** Hashes computed from real files by the caller, not copied from the mirror manifest. */
  readonly actualFiles: readonly MirrorFile[];
}): CurrencyViolation[] {
  const errors: CurrencyViolation[] = [];
  const ort = Object.entries(input.lockfile.packages).filter(
    ([path, entry]) =>
      !entry.link &&
      (path === 'node_modules/onnxruntime-web' ||
        path.endsWith('/node_modules/onnxruntime-web') ||
        entry.name === 'onnxruntime-web'),
  );
  if (!ort.length)
    errors.push(
      violation(
        'ort-lock-missing',
        input.lockfilePath,
        'No resolved onnxruntime-web package exists in the lockfile',
      ),
    );
  if (!version.test(input.mirror.version))
    errors.push(
      violation(
        'ort-mirror-version',
        input.mirrorPath,
        'Runtime mirror must declare an exact ORT semver version',
      ),
    );
  for (const [path, entry] of ort)
    if (entry.version !== input.mirror.version)
      errors.push(
        violation(
          'ort-version-mismatch',
          input.mirrorPath,
          `${path} resolves to ${String(entry.version)} but the runtime mirror declares ${input.mirror.version}`,
        ),
      );
  if (!input.mirror.files.length)
    errors.push(
      violation(
        'ort-mirror-files',
        input.mirrorPath,
        'Runtime mirror must record its ORT files and SHA-256 digests',
      ),
    );
  const actual = new Map<string, string>();
  for (const file of input.actualFiles) {
    if (!canonicalPath(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256) || actual.has(file.path))
      errors.push(
        violation(
          'ort-actual-file',
          input.mirrorPath,
          `Invalid or duplicate independently hashed file: ${file.path}`,
        ),
      );
    actual.set(file.path, file.sha256);
  }
  const seen = new Set<string>();
  for (const file of input.mirror.files) {
    if (!canonicalPath(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256) || seen.has(file.path))
      errors.push(
        violation(
          'ort-mirror-file',
          input.mirrorPath,
          `Invalid or duplicate runtime mirror file: ${file.path}`,
        ),
      );
    seen.add(file.path);
    if (actual.get(file.path) !== file.sha256)
      errors.push(
        violation(
          'ort-digest-mismatch',
          input.mirrorPath,
          `Runtime mirror digest does not match independently hashed file: ${file.path}`,
        ),
      );
  }
  for (const path of actual.keys())
    if (!seen.has(path))
      errors.push(
        violation(
          'ort-unrecorded-file',
          input.mirrorPath,
          `Independently hashed ORT file is absent from the runtime mirror: ${path}`,
        ),
      );
  return errors;
}
