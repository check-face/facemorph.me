// Read immutable Git snapshots; dirty checkout files never supply dependency policy or manifest evidence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import {
  validateLockfile,
  validateManifest,
  validateOrtMirror,
  validateUpdaterPaths,
  type CurrencyViolation,
  type Lockfile,
  type MirrorFile,
  type PackageManifest,
} from './dependency-currency.ts';
import { frozenProblems, type DependencyPolicy } from './dependency-freeze.ts';
import { composeManifest, validateOverlay } from './ort-mirror.ts';
import { composeEncoderDescriptor, verifySerialCompanion } from './serial-ort.ts';

export const DEPENDENCY_GROUPS = [
  'build-tools',
  'react-and-ui',
  'onnx-runtime',
  'test-tools',
] as const;
export interface CurrencyOptions {
  readonly base: string;
  readonly head: string;
  readonly group?: (typeof DEPENDENCY_GROUPS)[number];
  readonly lane: 'stable' | 'bleeding-edge';
  readonly runtimeDir?: string;
}

export interface CurrencyReport {
  readonly schema: 'facemorph.dependency-currency/1';
  readonly base: string;
  readonly head: string;
  readonly group: string | null;
  readonly lane: 'stable' | 'bleeding-edge';
  readonly requiredChecks: readonly string[];
  readonly manifests: number;
  readonly lockfiles: number;
  readonly ok: boolean;
  readonly violations: readonly CurrencyViolation[];
}

const POLICY = 'scripts/ci/dependency-policy.json';
const MIRROR = 'import/runtime-mirror.json';
const SHA = /^[a-f0-9]{40}$/;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const frozen = (path: string) =>
  path
    .split('/')
    .some((part) => part === 'classic' || part === 'self-host' || part.endsWith('-classic'));
const manifestPath = (path: string) => /(^|\/)package\.json$/.test(path);
const lockPath = (path: string) => /(^|\/)package-lock\.json$/.test(path);
const requirementsPath = (path: string) => /(^|\/)requirements\.(?:in|txt)$/.test(path);

/** Follow pinned encoder manifests from actual artifact bytes, including any nested encoder streams. */
function encoderRuntimeProblems(
  root: unknown,
  runtimeDir: string,
  expectedVersion: string,
): CurrencyViolation[] {
  const problems: CurrencyViolation[] = [];
  const visited = new Map<string, string>();
  const problem = (code: string, path: string, text: string) =>
    problems.push({ code, path, message: text });
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'encoderStream') {
        walk(child);
        continue;
      }
      let path = 'encoderStream';
      try {
        if (!child || typeof child !== 'object')
          throw new Error('Encoder stream must be a pinned manifest reference');
        const descriptor = child as { url?: unknown; sha256?: unknown; size?: unknown };
        if (
          typeof descriptor.url !== 'string' ||
          typeof descriptor.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(descriptor.sha256)
        )
          throw new Error('Encoder stream needs a URL and SHA-256 pin');
        const url = new URL(descriptor.url);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !url.pathname.startsWith('/runtime/')
        )
          throw new Error('Encoder manifest URL must identify an HTTPS runtime file');
        path = decodeURIComponent(url.pathname.slice('/runtime/'.length));
        if (
          !path ||
          /[\\\0]/.test(path) ||
          path.split('/').some((part) => !part || part === '.' || part === '..')
        )
          throw new Error('Encoder manifest path must remain inside the runtime artifact');
        const previous = visited.get(path);
        if (previous !== undefined) {
          if (previous !== descriptor.sha256) throw new Error('Conflicting encoder manifest pins');
          continue;
        }
        if (visited.size >= 64)
          throw new Error('Encoder manifest reference graph exceeds 64 files');
        visited.set(path, descriptor.sha256);
        const file = join(runtimeDir, path);
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
          throw new Error('Encoder manifest must be a regular JSON file of at most 16 MiB');
        const bytes = readFileSync(file);
        if (hash(bytes) !== descriptor.sha256)
          throw new Error('Actual encoder manifest digest differs from its pin');
        if (descriptor.size !== undefined && descriptor.size !== bytes.length)
          throw new Error('Actual encoder manifest size differs from its pin');
        const manifest = JSON.parse(bytes.toString('utf8')) as { runtime?: { version?: unknown } };
        if (manifest.runtime?.version !== expectedVersion)
          problem(
            'ort-encoder-version-mismatch',
            path,
            `Mirrored encoder runtime is ${String(manifest.runtime?.version)} but locked/composed ORT is ${expectedVersion}; the bounded encoder runtime must be adopted separately without weakening its memory contract`,
          );
        walk(manifest);
      } catch (error) {
        problem('ort-encoder-manifest-invalid', path, message(error));
      }
    }
  };
  walk(root);
  return problems;
}

export function parseCurrencyArgs(args: readonly string[]): CurrencyOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      group: { type: 'string' },
      lane: { type: 'string', default: 'stable' },
      'runtime-dir': { type: 'string' },
    },
  });
  if (!values.base || !SHA.test(values.base) || !values.head || !SHA.test(values.head))
    throw new Error('--base and --head must be full immutable Git SHAs');
  if (values.group !== undefined && !DEPENDENCY_GROUPS.some((group) => group === values.group))
    throw new Error(`--group must be one of ${DEPENDENCY_GROUPS.join(', ')}`);
  if (values.lane !== 'stable' && values.lane !== 'bleeding-edge')
    throw new Error('--lane must be stable or bleeding-edge');
  if (values['runtime-dir'] === '')
    throw new Error('--runtime-dir must name an artifact directory');
  return {
    base: values.base,
    head: values.head,
    lane: values.lane,
    ...(values.group === undefined
      ? {}
      : { group: values.group as CurrencyOptions['group'] & string }),
    ...(values['runtime-dir'] === undefined ? {} : { runtimeDir: values['runtime-dir'] }),
  };
}

function workspaceNames(root: unknown, manifests: Map<string, PackageManifest>): string[] {
  const workspaces = (root as { workspaces?: unknown })?.workspaces;
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : (workspaces as { packages?: unknown } | undefined)?.packages;
  if (patterns === undefined) return [];
  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== 'string'))
    throw new Error('workspaces must contain package directory patterns');
  const matchers = patterns.map(
    (pattern: string) =>
      new RegExp(
        `^${pattern
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*')}/package\\.json$`,
      ),
  );
  return [...manifests]
    .filter(([path]) => matchers.some((matcher) => matcher.test(path)))
    .flatMap(([, manifest]) => (manifest.name ? [manifest.name] : []));
}

/** repo is injectable for real temporary Git-repository tests; no ambient checkout reads are used. */
export function checkDependencyCurrency(
  options: CurrencyOptions,
  repo = process.cwd(),
): CurrencyReport {
  const violations: CurrencyViolation[] = [];
  let manifestCount = 0;
  let lockCount = 0;
  let requiredChecks: readonly string[] = [];
  const problem = (code: string, path: string, text: string) =>
    violations.push({ code, path, message: text });
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const read = (revision: string, path: string) => git(['show', `${revision}:${path}`]);
  const json = (revision: string, path: string): any => JSON.parse(read(revision, path));
  const attempt = <T>(path: string, run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      problem('input-invalid', path, message(error));
      return undefined;
    }
  };
  try {
    if (!SHA.test(options.base) || !SHA.test(options.head))
      throw new Error('base/head must be full immutable Git SHAs');
    if (options.group !== undefined && !DEPENDENCY_GROUPS.includes(options.group))
      throw new Error('unknown dependency group');
    if (options.lane !== 'stable' && options.lane !== 'bleeding-edge')
      throw new Error('unknown dependency lane');
    const headPaths = git(['ls-tree', '-r', '--name-only', '-z', options.head])
      .split('\0')
      .filter((path) => path && !frozen(path));
    const basePaths = git(['ls-tree', '-r', '--name-only', '-z', options.base])
      .split('\0')
      .filter((path) => path && !frozen(path));
    const allPaths = [...new Set([...basePaths, ...headPaths])];
    const trusted = attempt(POLICY, () => json(options.base, POLICY) as DependencyPolicy);
    const candidate = attempt(POLICY, () => json(options.head, POLICY) as DependencyPolicy);
    if (trusted && options.group)
      requiredChecks = trusted.groups[options.group]?.requiredChecks ?? [];
    if (trusted && candidate)
      attempt(POLICY, () => {
        for (const text of frozenProblems(
          trusted,
          candidate,
          (path) => read(options.head, path),
          git(['diff', options.base, options.head, '--', 'PLAN.md']),
        ))
          problem('frozen-policy', POLICY, text);
      });
    if (options.group) {
      const changed = git(['diff', '--no-renames', '--name-only', '-z', options.base, options.head])
        .split('\0')
        .filter(Boolean);
      // Python requirement manifests are a separate explicit category; do not pass them off as runtime manifests.
      const requirements = new Set(allPaths.filter(requirementsPath));
      violations.push(
        ...validateUpdaterPaths(
          changed.filter((path) => !(requirements.has(path) && !frozen(path))),
          {
            manifestPaths: allPaths.filter(manifestPath),
            lockfilePaths: allPaths.filter(lockPath),
            runtimeManifestPaths: [MIRROR],
          },
        ),
      );
    }
    const manifests = new Map<string, PackageManifest>();
    for (const path of headPaths.filter(manifestPath)) {
      const manifest = attempt(path, () => json(options.head, path) as PackageManifest);
      if (manifest) manifests.set(path, manifest);
    }
    manifestCount = manifests.size;
    const internal =
      attempt('package.json', () => workspaceNames(manifests.get('package.json'), manifests)) ?? [];
    for (const [path, manifest] of manifests)
      attempt(path, () =>
        violations.push(
          ...validateManifest(
            { path, manifest },
            { workspaceNames: internal, requireNodeEngine: path === 'package.json' },
          ),
        ),
      );
    const locks = new Map<string, Lockfile>();
    for (const path of headPaths.filter(lockPath)) {
      const lock = attempt(path, () => json(options.head, path) as Lockfile);
      if (lock) {
        locks.set(path, lock);
        attempt(path, () =>
          violations.push(...validateLockfile({ path, lockfile: lock }, { lane: options.lane })),
        );
      }
    }
    lockCount = locks.size;
    const lock = locks.get('package-lock.json');
    if (!lock) problem('ort-lock-missing', 'package-lock.json', 'Root lockfile is required');
    const overlay = attempt(MIRROR, () => validateOverlay(json(options.head, MIRROR)));
    const control = attempt('import/build-inputs.json', () => {
      const inventory = json(options.base, 'import/build-inputs.json');
      const pin = inventory.runtime.manifest.sha256;
      if (!/^[a-f0-9]{64}$/.test(pin)) throw new Error('Invalid frozen control manifest pin');
      const path = `import/runtime-manifests/control/${pin}/manifest.json`;
      const bytes = read(options.base, path);
      if (hash(bytes) !== pin) throw new Error('Frozen control manifest digest mismatch');
      return JSON.parse(bytes) as Record<string, any>;
    });
    const actualFiles: MirrorFile[] = [];
    let composed = false;
    if (overlay && options.runtimeDir) {
      for (const file of overlay.files)
        attempt(file.path, () => {
          const path = join(resolve(repo, options.runtimeDir!), file.path);
          if (!lstatSync(path).isFile())
            throw new Error('Runtime artifact asset must be a regular file');
          const bytes = readFileSync(path);
          actualFiles.push({ path: file.path, sha256: hash(bytes) });
          if (bytes.length !== file.size)
            problem(
              'ort-size-mismatch',
              file.path,
              'Runtime artifact asset size differs from the mirror manifest',
            );
        });
      if (control)
        attempt('manifest.json', () => {
          const actual = JSON.parse(
            readFileSync(join(resolve(repo, options.runtimeDir!), 'manifest.json'), 'utf8'),
          );
          const origin = new URL(actual.runtime.moduleUrl).origin;
          let controlEncoderDescriptorBytes: Buffer | undefined;
          if (overlay.schema === 'facemorph.ort-mirror/2') {
            // Only the immutable base snapshot can authorize model/reference fields in a new descriptor.
            // The candidate's own self-consistent hash is insufficient evidence of preservation.
            const reference = control.encoderStream;
            const url = new URL(reference.url);
            const path = decodeURIComponent(url.pathname.slice('/runtime/'.length));
            if (
              url.protocol !== 'https:' ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              !url.pathname.startsWith('/runtime/') ||
              !path ||
              /[\\\0]/.test(path) ||
              path.split('/').some((part) => !part || part === '.' || part === '..')
            )
              throw new Error('Trusted encoder descriptor URL must remain inside the runtime');
            controlEncoderDescriptorBytes = Buffer.from(
              read(options.base, `import/runtime-manifests/${path}`),
            );
            if (
              hash(controlEncoderDescriptorBytes) !== reference.sha256 ||
              controlEncoderDescriptorBytes.length !== reference.size
            )
              throw new Error('Trusted encoder descriptor bytes differ from the frozen root pin');
            verifySerialCompanion(
              join(resolve(repo, options.runtimeDir!), 'assets', overlay.serial.bundleSha256),
              overlay.serial,
            );
            const descriptor = composeEncoderDescriptor(
              controlEncoderDescriptorBytes,
              overlay.serial,
              origin,
            );
            const actualDescriptor = join(resolve(repo, options.runtimeDir!), descriptor.path);
            const stat = lstatSync(actualDescriptor);
            if (
              !stat.isFile() ||
              stat.size !== descriptor.bytes.length ||
              !readFileSync(actualDescriptor).equals(descriptor.bytes)
            )
              throw new Error(
                'Actual encoder descriptor is not exactly the trusted control plus serial runtime',
              );
          }
          const expected = composeManifest(
            control,
            overlay,
            origin,
            controlEncoderDescriptorBytes === undefined ? {} : { controlEncoderDescriptorBytes },
          );
          composed = isDeepStrictEqual(actual, expected);
          if (!composed)
            problem(
              'ort-composition-mismatch',
              'manifest.json',
              'Runtime artifact is not the frozen control composed with exactly the declared CPU/WebGPU ORT overlay; model/reference fields must remain intact',
            );
          violations.push(
            ...encoderRuntimeProblems(actual, resolve(repo, options.runtimeDir!), overlay.version),
          );
        });
    }
    if (overlay && lock)
      violations.push(
        ...validateOrtMirror({
          lockfile: lock,
          lockfilePath: 'package-lock.json',
          mirror: overlay,
          mirrorPath: MIRROR,
          actualFiles,
        }),
      );
    if (!options.runtimeDir)
      problem(
        'runtime-artifact-required',
        MIRROR,
        'Supply --runtime-dir to verify actual mirrored bytes and any generated candidate composition; an overlay version label is not adopted runtime evidence',
      );
    if (control && lock && !composed) {
      for (const [route, actual] of [
        ['cpu', control.runtime?.version],
        ['webgpu', control.webgpu?.runtime?.version],
      ] as const) {
        for (const [path, entry] of Object.entries(lock.packages))
          if (
            (path === 'node_modules/onnxruntime-web' ||
              path.endsWith('/node_modules/onnxruntime-web')) &&
            !entry.link &&
            entry.version !== actual
          )
            problem(
              'ort-adopted-version-mismatch',
              MIRROR,
              `${path} resolves to ${String(entry.version)} but frozen ${route} runtime is ${String(actual)}; no verified generated candidate composition replaces it`,
            );
      }
    }
  } catch (error) {
    problem('input-invalid', '.', message(error));
  }
  return {
    schema: 'facemorph.dependency-currency/1',
    base: options.base,
    head: options.head,
    group: options.group ?? null,
    lane: options.lane,
    requiredChecks,
    manifests: manifestCount,
    lockfiles: lockCount,
    ok: violations.length === 0,
    violations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkDependencyCurrency(parseCurrencyArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        schema: 'facemorph.dependency-currency/1',
        ok: false,
        violations: [{ code: 'arguments', path: '.', message: message(error) }],
      }),
    );
    process.exitCode = 1;
  }
}
