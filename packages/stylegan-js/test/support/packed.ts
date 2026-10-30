// The packed package as a consumer gets it (fm-1jr7): this package's current sources built fresh into a staging
// directory (never the checkout's dist/, which may be stale or absent), `npm pack`ed, and installed into a clean
// project in os.tmpdir(), outside the monorepo: no workspace links, no path aliases, no repository tsconfig.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG = fileURLToPath(new URL('../../', import.meta.url));
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const PACKAGE_NAME = 'stylegan-js';

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  });

/** The repository's version of a dev dependency, so the clean project compiles with the same tools. */
export const repoVersion = (name: string): string =>
  (
    JSON.parse(readFileSync(join(REPO, 'node_modules', name, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

/**
 * The release tarball of one of this repository's packages when FACEMORPH_PACKED_TARBALLS names a directory of them
 * (the `packages` workflow's artifact, as the clean-consumer smoke uses: scripts/packages/clean-consumer-smoke.mjs),
 * else null. The file must be `<name>-<version>.tgz` at the checkout's version of that package.
 */
export function releaseTarball(name: string): string | null {
  const dir = process.env['FACEMORPH_PACKED_TARBALLS'];
  if (!dir) return null;
  const { version } = JSON.parse(
    readFileSync(join(REPO, 'packages', name, 'package.json'), 'utf8'),
  ) as { version: string };
  const tarball = join(dir, `${name}-${version}.tgz`);
  if (!existsSync(tarball))
    throw new Error(`FACEMORPH_PACKED_TARBALLS has no ${name}-${version}.tgz`);
  return tarball;
}

/**
 * Builds src/ into `work`/stage/dist with tsconfig.build.json and packs it; the tarball path. With
 * FACEMORPH_PACKED_TARBALLS set, the release tarball instead (releaseTarball).
 */
export function packFresh(work: string): string {
  const given = releaseTarball(PACKAGE_NAME);
  if (given) return given;
  const stage = join(work, 'stage');
  mkdirSync(stage, { recursive: true });
  copyFileSync(join(PKG, 'package.json'), join(stage, 'package.json'));
  run(
    join(REPO, 'node_modules/.bin/tsc'),
    ['-p', join(PKG, 'tsconfig.build.json'), '--outDir', join(stage, 'dist')],
    PKG,
  );
  const out = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], stage)) as {
    filename: string;
  }[];
  return join(work, out[0]!.filename);
}

/** A clean ES-module project at `dir` with the tarball and `extra` registry packages installed. */
export function installClean(dir: string, tarball: string, extra: readonly string[] = []): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'stylegan-js-clean-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefer-offline',
      '--no-package-lock',
      tarball,
      ...extra,
    ],
    dir,
  );
}

/** tsc in the clean project: exit status, diagnostics, and every file of the workspace packages the compiler read. */
export function compileClean(dir: string, config = 'tsconfig.json') {
  const tsc = join(dir, 'node_modules/.bin/tsc');
  let status = 0;
  let output = '';
  try {
    output = run(tsc, ['-p', config], dir);
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const listed = run(tsc, ['-p', config, '--listFilesOnly'], dir).split('\n');
  const ours = listed.filter((f) =>
    /\/node_modules\/(?:stylegan-js|browser-model-manager|cloudflare-model-host)\//.test(f),
  );
  return {
    status,
    output: output.trim(),
    declarations: ours,
    sources: ours.filter((f) => !f.endsWith('.d.ts')),
  };
}
