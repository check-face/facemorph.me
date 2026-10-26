import { spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';

// CI also runs this suite inside the scaffold lane. All its origins are local;
// a separate network namespace keeps concurrent Docker netlink changes from
// aborting Chromium's localhost imports with ERR_NETWORK_CHANGED.
const isolated = process.env.FACEMORPH_ISOLATE_TEST_NETWORK === '1';
const files = process.argv.slice(2);
// Each browser case exercises concurrency itself. Parallel files add independent browser/profile I/O,
// which can consume a case's real deadline before its workers are ready, including in scaffold's npm test.
const args = [process.execPath, '--test', '--test-concurrency=1', ...files];
const env = { ...process.env };
// These disposable component profiles qualify native APIs, not disk throughput. Keep them separate from
// Docker/model builds on Linux when a sufficiently large memory filesystem exists. Explicit TMPDIR wins;
// leave the cold-photo component's storage measurement on its normal filesystem.
if (
  !env.TMPDIR &&
  process.platform === 'linux' &&
  existsSync('/dev/shm') &&
  files.some((file) => file.includes('.test.ts')) &&
  !files.some((file) => file.includes('cold-photo.component'))
) {
  const { bavail, bsize } = statfsSync('/dev/shm');
  if (bavail * bsize >= 1024 ** 3) env.TMPDIR = '/dev/shm';
}
const result = isolated
  ? spawnSync(
      'unshare',
      [
        '--user',
        '--map-root-user',
        '--net',
        'sh',
        '-c',
        'ip link set lo up && exec "$@"',
        '--',
        ...args,
      ],
      { stdio: 'inherit', env },
    )
  : spawnSync(args[0], args.slice(1), { stdio: 'inherit', env });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
