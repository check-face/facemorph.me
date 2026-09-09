"""Create/update only the isolated Facemorph trial; never configure paid hardware."""
from pathlib import Path
import json,os,sys
from huggingface_hub import HfApi, SpaceHardware, create_bucket

ROOT=Path(__file__).resolve().parents[1]
SPACE='cdilga/facemorph-next'
BUCKET='cdilga/facemorph-trial-public'
mode_file = ROOT / 'frontend/build-mode.json'
if not mode_file.exists() or json.loads(mode_file.read_text()).get('review', True):
    raise SystemExit('Refusing to deploy local review assets. Build without FACEMORPH_REVIEW after hosted integration review.')
api=HfApi()
identity=api.whoami()
if identity['name']!='cdilga':raise SystemExit('Expected cdilga HF identity; refusing a different owner.')
# Files and compilation/tests must already be complete before uploading.
for name in ['app.py','models/generator.pkl','models/provenance.json','archive/manifest.json','frontend/index.html']:
    if not (ROOT/name).is_file():raise SystemExit('Missing required artifact: '+name)
print('Creating isolated ZeroGPU trial:',SPACE)
api.create_repo(SPACE,repo_type='space',space_sdk='gradio',space_hardware=SpaceHardware.ZERO_A10G,
                private=False,exist_ok=True)
create_bucket(BUCKET,private=False,exist_ok=True)
api.add_space_variable(SPACE,'TRIAL_BUCKET',BUCKET)
api.add_space_variable(SPACE,'TRIAL_BASE_URL','https://cdilga-facemorph-next.hf.space')
# Prefer a token scoped just to this bucket; never embed it in committed files.
storage_token=os.getenv('FACEMORPH_STORAGE_TOKEN')
if storage_token:
    api.add_space_secret(SPACE,'TRIAL_STORAGE_TOKEN',storage_token)
else:
    print('Storage writer secret not supplied. Generation will fail closed until it is configured.')
result=api.upload_folder(repo_id=SPACE,repo_type='space',folder_path=ROOT,
    ignore_patterns=['.venv/**','.git/**','**/.git/**','**/.git','**/__pycache__/**','.pytest_cache/**',
                     'generated/**','models/legacy-*.pkl','models/converted-*.pkl','evidence/**','*.log','.env*'],
    commit_message='Launch isolated archive-first Facemorph community trial')
record={'space':SPACE,'url':'https://huggingface.co/spaces/'+SPACE,'app_url':'https://cdilga-facemorph-next.hf.space',
        'bucket':BUCKET,'commit':result.oid,'classic_changed':False}
(ROOT/'evidence/deployment.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
