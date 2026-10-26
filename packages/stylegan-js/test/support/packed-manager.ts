// The packed browser-model-manager as a consumer gets it, beside packFresh's stylegan-js (packed.ts):
// the manager's current sources built fresh into a staging directory (never the checkout's dist/), type-checked
// against the freshly staged stylegan-js declarations rather than the checkout's (possibly stale) stylegan-js dist/,
// and `npm pack`ed. Install both tarballs in one `npm install` so the manager's dependency resolves to the staged
// stylegan-js tarball.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './packed.ts';

export const MANAGER = join(REPO, 'packages/browser-model-manager');

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 28,
  });

/**
 * Builds the manager's src/ into `work`/manager-stage/dist and packs it; the tarball path. `styleganStage` is the
 * directory packFresh staged (its dist/ holds the declarations the manager compiles against).
 */
export function packManagerFresh(work: string, styleganStage = join(work, 'stage')): string {
  const stage = join(work, 'manager-stage');
  mkdirSync(stage, { recursive: true });
  const dts = (p: string) => join(styleganStage, 'dist', p);
  const config = join(stage, 'tsconfig.build.json');
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        extends: join(MANAGER, 'tsconfig.build.json'),
        compilerOptions: {
          rootDir: join(MANAGER, 'src'),
          outDir: join(stage, 'dist'),
          paths: {
            'stylegan-js': [dts('index.d.ts')],
            'stylegan-js/engine': [dts('engine/index.d.ts')],
            'stylegan-js/engine/webgpu': [dts('engine/webgpu.d.ts')],
          },
        },
        include: [join(MANAGER, 'src')],
      },
      null,
      2,
    )}\n`,
  );
  run(join(REPO, 'node_modules/.bin/tsc'), ['-p', config], stage);
  copyFileSync(join(MANAGER, 'package.json'), join(stage, 'package.json'));
  for (const f of ['schema', 'LICENSE', 'THIRD_PARTY_NOTICES', 'README.md'])
    if (existsSync(join(MANAGER, f))) cpSync(join(MANAGER, f), join(stage, f), { recursive: true });
  const out = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], stage)) as {
    filename: string;
  }[];
  return join(work, out[0]!.filename);
}
