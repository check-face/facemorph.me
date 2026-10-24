"""Run each ```sh block of docs/usage.md marked `<!-- ci: verbatim -->` verbatim (bash -euo pipefail), from the
repository root, as a clean clone would. Usage: python3 packages/model-conv/tests/doc_commands.py [workdir]"""
import re
import subprocess
import sys
from pathlib import Path

package = Path(__file__).resolve().parents[1]
blocks = re.findall(r'<!-- ci: verbatim -->\n```sh\n(.*?)```', (package / 'docs/usage.md').read_text(), re.S)
if not blocks:
    sys.exit('no `<!-- ci: verbatim -->` blocks in docs/usage.md')
root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else package.parents[1]
for block in blocks:
    print(block, flush=True)
    code = subprocess.run(['bash', '-euo', 'pipefail', '-c', block], cwd=root).returncode
    if code:
        sys.exit(code)
