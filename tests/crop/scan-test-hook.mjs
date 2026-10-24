#!/usr/bin/env node
// The crop tests' detector-failure hook (window.__FACEMORPH_TEST_FAIL_DETECTION__, fm-f2rs) may exist only in test
// builds. Scans a built site for its name; exit 1 if any file carries it.
//   node tests/crop/scan-test-hook.mjs deploy-next
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const HOOK = '__FACEMORPH_TEST_FAIL_DETECTION__';

export function scan(dir) {
  const hits = [];
  let files = 0;
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else { files++; if (readFileSync(path).includes(HOOK)) hits.push(path); }
    }
  };
  walk(dir);
  return { files, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, hits } = scan(process.argv[2] ?? 'deploy-next');
  console.log(JSON.stringify({ hook: HOOK, files, hits }));
  process.exit(files > 0 && hits.length === 0 ? 0 : 1);
}
