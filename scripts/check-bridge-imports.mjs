// Every name the compiled UI imports from a hand-written module must actually be exported there.
//
// Fable emits `import { selectPhoto } from "./product-bridge.mjs"` straight from an F# [<Import>]
// attribute, and neither Fable nor F# can see whether the JavaScript side still exports that name.
// Webpack notices and emits a warning — one of seven the build already printed — and then bundles
// the import as `undefined`. Calling it throws at the first user action that reaches it.
//
// That is exactly how the whole photo path shipped dead: R2-15 wrapped photo preparation in
// reported variants and renamed the bridge exports to `selectPhotoReported`, `previewPhotoReported`
// and `cropPhotoReported`, while Product.fs kept importing the raw names. Choosing a photo threw
// `selectPhoto is not a function` on every device, and the CI end-to-end run had been failing at
// `syntheticPhotoE4e` ever since — the warning was there the whole time, unread.
//
// A warning nobody reads is not a gate. This makes it one.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

function sources(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) sources(path, found);
    else if (entry.name.endsWith('.fs.js')) found.push(path);
  }
  return found;
}

/** Named exports of a module, by static reading: these modules cannot be imported under node. */
function exportsOf(file) {
  const text = readFileSync(file, 'utf8');
  const names = new Set();
  for (const [, name] of text.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(name);
  for (const [, name] of text.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(name);
  for (const [, group] of text.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const part of group.split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  // `export * from './x.mjs'` re-exports transitively; follow it so a legitimate barrel passes.
  for (const [, target] of text.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    const next = resolve(dirname(file), target);
    if (existsSync(next)) for (const name of exportsOf(next)) names.add(name);
  }
  return names;
}

const problems = [];
for (const file of sources(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const [, group, specifier] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(file), specifier);
    // Only hand-written modules are checked; Fable's own output is generated together.
    if (!/\.mjs$/.test(target) || !existsSync(target)) continue;
    const available = exportsOf(target);
    for (const part of group.split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const wanted = piece.split(/\s+as\s+/)[0].trim();
      if (!available.has(wanted))
        problems.push({
          from: relative(root, file), specifier, wanted,
          near: [...available].filter(name => name.toLowerCase().includes(wanted.toLowerCase())
            || wanted.toLowerCase().includes(name.toLowerCase())).slice(0, 4)
        });
    }
  }
}

if (problems.length) {
  console.error('Compiled UI imports names the module does not export:\n');
  for (const problem of problems)
    console.error(`  ${problem.from}\n    imports { ${problem.wanted} } from '${problem.specifier}'`
      + (problem.near.length ? `\n    did you mean: ${problem.near.join(', ')}` : '')
      + '\n    This bundles as undefined and throws at the first call.\n');
  process.exit(1);
}
console.log(JSON.stringify({ bridgeImportsResolved: true, files: sources(join(root, 'src')).length }));
