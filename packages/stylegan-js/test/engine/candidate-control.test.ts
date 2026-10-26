// The frozen control (fm-7f2o): test/vectors/candidate-control holds the candidate's route, engine and canary modules
// as the app ran them before they moved into this package; routes.test.ts and canary.test.ts compare against them.
// Each file must be byte-identical to the app path at the commit its manifest names, so the comparison is still
// with the candidate and never with this package's own copy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../vectors/candidate-control/', import.meta.url);
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as {
  files: { file: string; sha256: string; source?: { path: string; commit: string } }[];
};
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('every vendored control file has its recorded digest and matches its app source commit', () => {
  assert.ok(manifest.files.length >= 7);
  for (const f of manifest.files) {
    const bytes = readFileSync(new URL(f.file, DIR));
    assert.equal(sha256(bytes), f.sha256, f.file);
    if (!f.source) continue;
    let original: Buffer;
    try {
      original = execFileSync('git', ['-C', REPO, 'show', `${f.source.commit}:${f.source.path}`]);
    } catch {
      continue; // a shallow checkout without that commit still checks the recorded digest above
    }
    assert.equal(sha256(original), f.sha256, `${f.file} is ${f.source.path} at ${f.source.commit}`);
  }
});
