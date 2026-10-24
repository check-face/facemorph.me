// A test file that no lane names is not a gate; it is a file. crop-queue.test.mjs was written
// with the fix for crops cancelling each other and never ran in CI, and encoder-preflight.test.mjs
// had been unrun since the candidate landed. Both passed the whole time, which is exactly why
// nobody noticed: an unrun test is indistinguishable from a passing one until it matters.
//
// Every *.test.mjs under src/Next must appear in the artifact job's test command. Adding a file
// and forgetting the workflow now fails the build that forgot it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const workflow = readFileSync(join(root, '.github/workflows/next-site.yml'), 'utf8');

function testFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) testFiles(full, found);
    else if (entry.endsWith('.test.mjs')) found.push(relative(root, full));
  }
  return found;
}

const missing = testFiles(join(root, 'src/Next')).filter(file => !workflow.includes(file)).sort();
if (missing.length) {
  console.error('Test files not run by .github/workflows/next-site.yml:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(JSON.stringify({ testFilesListed: testFiles(join(root, 'src/Next')).length }));
