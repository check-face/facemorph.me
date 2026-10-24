"""browser_source (fm-eulc follow-up): on a planted source tree, a shim that re-exports a package's TS module, the
package module's own relative TS imports (a sibling and a parent directory) and an app module importing app TS all
end up as `.mjs` with types stripped; other files are copied as they are. The result is loaded by Node as plain
JavaScript (no type stripping involved).

    python3 scripts/import/control_site_test.py
"""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from control_site import browser_source  # noqa: E402


class BrowserSource(unittest.TestCase):
    def test_shims_become_plain_javascript(self):
        root = Path(tempfile.mkdtemp())
        pkg = root / 'packages/m/src/cache'
        pkg.mkdir(parents=True)
        (pkg / 'a.ts').write_text("import { b } from './b.ts';\nimport { c } from '../acq/c.ts';\n"
                                  "export const a = (n: number): number => b(n) + c;\n")
        (root / 'packages/m/src/acq').mkdir()
        (root / 'packages/m/src/acq/c.ts').write_text('export const c: number = 1;\n')
        (pkg / 'b.ts').write_text('export function b(n: number): number {\n  return n * 2;\n}\n')
        src = root / 'apps/web/src/Next/Assets'
        src.mkdir(parents=True)
        for name in ('a', 'b'):
            (src / f'{name}.mjs').write_text(f"export * from '../../../../../packages/m/src/cache/{name}.ts';\n")
        (src / 'other.mjs').write_text("export const other = 1;\n")
        (root / 'apps/web/src/contracts').mkdir()
        (root / 'apps/web/src/contracts/d.ts').write_text('export const d = (s: string): string => s + "!";\n')
        (src / 'uses-d.mjs').write_text("import { d } from '../../contracts/d.ts';\nexport const e = d('x');\n")
        out = browser_source(root / 'apps/web/src', root / 'browser/src')
        a = (out / '_repo/packages/m/src/cache/a.mjs').read_text()
        self.assertIn("from './b.mjs'", a)
        self.assertIn("from '../acq/c.mjs'", a)
        self.assertNotIn(': number', a)
        self.assertNotIn('.ts', (out / 'Next/Assets/a.mjs').read_text())
        self.assertEqual((out / 'Next/Assets/other.mjs').read_text(), 'export const other = 1;\n')
        r = subprocess.run(['node', '--no-experimental-strip-types', '--input-type=module', '-e',
                            'const {a}=await import(process.argv[1]);console.log(a(3))', str(out / 'Next/Assets/a.mjs')],
                           capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), '7', r.stderr)
        r = subprocess.run(['node', '--no-experimental-strip-types', '--input-type=module', '-e',
                            'const {e}=await import(process.argv[1]);console.log(e)', str(out / 'Next/Assets/uses-d.mjs')],
                           capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), 'x!', r.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
