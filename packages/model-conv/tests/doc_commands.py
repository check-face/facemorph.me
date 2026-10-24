"""Run the first ```sh block of docs/usage.md verbatim (bash -euo pipefail), from the repository root, as a
clean clone would. Usage: python3 packages/model-conv/tests/doc_commands.py [workdir]"""
import re
import subprocess
import sys
from pathlib import Path

package = Path(__file__).resolve().parents[1]
block = re.search(r'```sh\n(.*?)```', (package / 'docs/usage.md').read_text(), re.S).group(1)
root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else package.parents[1]
print(block, flush=True)
sys.exit(subprocess.run(['bash', '-euo', 'pipefail', '-c', block], cwd=root).returncode)
