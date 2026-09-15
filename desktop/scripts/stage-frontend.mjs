import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const sourceArg = process.argv.indexOf('--source');
if (sourceArg >= 0 && !process.argv[sourceArg + 1]) throw new Error('--source needs a directory');
const source = sourceArg >= 0 ? path.resolve(process.argv[sourceArg + 1]) : path.resolve(desktop, '../deploy');
const target = path.join(desktop, 'frontend');
await readFile(path.join(source, 'index.html')); // fail before touching staged output
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const files = [];
async function stage(dir, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Frontend symlinks are not accepted');
    const name = path.join(relative, entry.name);
    if ((!relative && ['api', 'package.json', 'vercel.json'].includes(entry.name)) || name.endsWith('.map')) continue;
    if (entry.isDirectory()) {
      await mkdir(path.join(target, name), { recursive: true });
      await stage(path.join(dir, entry.name), name);
    } else if (entry.isFile()) {
      const data = await readFile(path.join(source, name));
      await cp(path.join(source, name), path.join(target, name));
      files.push({ path: name.split(path.sep).join('/'), sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
}
await stage(source);
files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(path.join(target, 'desktop-assets.json'), JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
console.log(`Staged ${files.length} shared frontend assets; inference remains unavailable.`);
