import { spawnSync } from 'node:child_process';

// CI also runs this suite inside the scaffold lane. All its origins are local;
// a separate network namespace keeps concurrent Docker netlink changes from
// aborting Chromium's localhost imports with ERR_NETWORK_CHANGED.
const isolated = process.env.FACEMORPH_ISOLATE_TEST_NETWORK === '1';
const args = [process.execPath, '--test', ...process.argv.slice(2)];
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
      { stdio: 'inherit' },
    )
  : spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
