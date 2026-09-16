"""Collect full installed-distribution notices alongside the frozen runtime."""
import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import shutil
import sysconfig
import sys

DESKTOP=Path(__file__).resolve().parents[1]
def stage(output):
    notices=output/'notices';notices.mkdir(parents=True,exist_ok=True);packages=[]
    for name in ('onnxruntime','numpy','scipy','pillow','dlib','pyinstaller','cffi','certifi','charset-normalizer','packaging','flatbuffers'):
        try:distribution=metadata.distribution(name)
        except metadata.PackageNotFoundError:continue
        copied=[]
        for item in distribution.files or []:
            if not any(word in item.name.lower() for word in ('license','copying','copyright','notice')):continue
            source=Path(distribution.locate_file(item))
            if not source.is_file():continue
            # Preserve unique relative license paths without trusting metadata traversal.
            safe=[part for part in item.parts if part not in ('..','.','/')]
            destination=notices/name/Path(*safe);destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination);copied.append(destination.relative_to(output).as_posix())
        if not copied and name in ('onnxruntime','numpy','scipy','pillow','dlib','pyinstaller'):raise ValueError(f'Missing installed license for {name}')
        packages.append({'name':name,'version':distribution.version,'licenseExpression':distribution.metadata.get('License-Expression'),'licenseFiles':copied})
    for source in (DESKTOP/'native/licenses/NVIDIA-LICENSE.txt',DESKTOP/'native/ALIGNMENT-LICENSE'):
        shutil.copyfile(source,notices/source.name)
    candidates=[Path(sysconfig.get_path('stdlib'))/'LICENSE.txt',Path(sys.base_prefix)/'LICENSE.txt',Path(sys.base_prefix)/'LICENSE']
    python_license=next((p for p in candidates if p.is_file()),None)
    if python_license is None:raise ValueError('Python distribution license is missing')
    shutil.copyfile(python_license,notices/'PYTHON-LICENSE.txt')
    (notices/'NOTICE.txt').write_text('FaceMorph Preview is a research/evaluation candidate. NVIDIA model/code terms, e4e/FFHQ dataset terms and dlib iBUG landmark model terms apply to acquired models. No commercial-use or redistribution grant is implied. Model bytes are separately verified downloads, not bundled here.\n\nModel sources and terms:\nhttps://github.com/NVlabs/stylegan2-ada-pytorch/blob/main/LICENSE.txt\nhttps://github.com/omertov/encoder4editing/blob/main/LICENSE\nhttps://github.com/NVlabs/ffhq-dataset#licenses\nhttps://dlib.net/face_landmark_detection.py.html\n\nThe FFmpeg codec is separately acquired from the pinned upstream distribution described in the product manifest. Its corresponding source and license notices are in the product distribution notices.\n')
    (notices/'python-packages.json').write_text(json.dumps(packages,indent=2)+'\n')
    # Refresh inventory after adding notices; model bytes are never included.
    inventory=output/'runtime-inventory.json'
    if inventory.exists():
        value=json.loads(inventory.read_text());files=[]
        for source in sorted(output.rglob('*')):
            if source.is_file() and source!=inventory:
                with source.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
                files.append({'path':source.relative_to(output).as_posix(),'sha256':digest,'size':source.stat().st_size})
        value['files']=files;inventory.write_text(json.dumps(value,indent=2)+'\n')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();stage(a.output)
