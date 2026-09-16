"""Drive the actual installed application's product controls with synthetic inputs.

Host-only rehearsal mode supplies a synthetic photo and an isolated export/data
folder. Inference executes the packaged worker; dialogs are exercised separately.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from asset_store import acquire,checksum
p=argparse.ArgumentParser();p.add_argument('--binary',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
manifest=json.loads(a.manifest.read_text());photo=acquire(manifest['photoCanary']['image'],a.cache/'models')
with tempfile.TemporaryDirectory(prefix='checkface-installed-workflow-') as temporary:
    root=Path(temporary);data=root/'data';data.mkdir()
    shutil.copytree(a.cache,data/'cache',copy_function=os.link)
    report=root/'result.json'
    env={**os.environ,'CHECKFACE_DESKTOP_WORKFLOW_REPORT':str(report),'CHECKFACE_DESKTOP_TEST_PHOTO':str(photo.resolve()),'CHECKFACE_DESKTOP_TEST_SAVE_DIR':str(root/'exports'),'CHECKFACE_DESKTOP_TEST_DATA_DIR':str(data)}
    with (root/'stderr.log').open('w') as errors:
        process=subprocess.Popen([str(a.binary.resolve())],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=errors)
        try:
            deadline=time.monotonic()+1500
            while time.monotonic()<deadline and not report.exists() and process.poll() is None:time.sleep(.25)
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()
    result=json.loads(report.read_text()) if report.exists() else {'passed':False,'error':'Installed app exited or timed out','stderr':(root/'stderr.log').read_text()[-3000:]}
    result.update(schemaVersion=1,binarySha256=checksum(a.binary),manifestSha256=checksum(a.manifest),testMode='real-installed-controls-native-inference-isolated-file-destination',interactiveSaveDialogTested=False)
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(result,indent=2)+'\n')
    if not result.get('passed'):raise SystemExit(result.get('error','Installed workflow failed'))
    print('PASS installed product seed/text/photo/e4e, project reopening, morph video/playback and native file bytes')
