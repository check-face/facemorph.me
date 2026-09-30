"""Route convolutions through a checked channel-as-batch filter workaround."""
import re,sys
from pathlib import Path
for path in Path(sys.argv[1]).glob('*.rs'):
 code=path.read_text()
 if path.name.startswith('block-'):
  code,count=re.subn(r'let reshape4_out1 = convtranspose2d1_out1.reshape\([^;]+;\s*let reshape5_out1 = reshape4_out1.reshape\([^;]+;', 'let reshape5_out1 = convtranspose2d1_out1;', code)
  assert count >= 1, (path,count)
 code,n=re.subn(r'self\.(conv2d\d+)\.forward\((\w+)\)',r'crate::checked_conv(&self.\1, \2)',code)
 path.write_text(code);print(path.name,n)
