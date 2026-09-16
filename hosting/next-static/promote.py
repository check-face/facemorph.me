#!/usr/bin/env python3
"""Promote retained CI bytes only after matching real-workflow qualification."""
import argparse, hashlib, json, subprocess, sys
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
REMOTE='check-face/facemorph.me'
def command(*args):return subprocess.check_output(list(args),cwd=REPO,text=True)
def passed_run(run,path):
    data=json.loads(command('gh','api',f'repos/{REMOTE}/actions/runs/{run}'))
    if data['conclusion']!='success' or data['path']!=path or data['head_repository']['full_name']!=REMOTE:
        raise ValueError('Required successful workflow/source is missing')
    return data
p=argparse.ArgumentParser();p.add_argument('--build-run',type=int,required=True);p.add_argument('--qualification-run',type=int,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--catalogue',type=Path,required=True);p.add_argument('--work',type=Path,required=True);p.add_argument('--publish',action='store_true');a=p.parse_args()
build=passed_run(a.build_run,'.github/workflows/next-site.yml')
# The artifact build calls the qualification as a reusable workflow, so the usual case is one
# run that both built and qualified these bytes. A separate run is still accepted when the
# qualification was pointed at an earlier artifact by hand.
qualified=build if a.qualification_run==a.build_run else passed_run(a.qualification_run,'.github/workflows/next-e2e.yml')
work=a.work.resolve();work.mkdir(parents=True,exist_ok=False)
web=work/'web';proof=work/'qualification'
command('gh','run','download',str(a.build_run),'-R',REMOTE,'-n','next-site-'+build['head_sha'],'-D',str(web))
command('gh','run','download',str(a.qualification_run),'-R',REMOTE,'-n','next-e2e-'+str(a.qualification_run),'-D',str(proof))
command(sys.executable,'desktop/scripts/verify-web-artifact.py','--artifact',str(web),'--revision',build['head_sha'],'--receipt',str(work/'web-receipt.json'))
report=json.loads((proof/'report.json').read_text());source=json.loads((proof/'source-run.json').read_text())
required={'nameSeed','repeatOriginal','syntheticPhotoE4e','localCrop','projectSaveReopen','morphPlayableMp4'}
if report.get('passed') is not True or not all(report.get('checks',{}).get(k,{}).get('passed') is True for k in required):raise ValueError('Required real-workflow evidence is missing')
if source['id']!=a.build_run or source['head_sha']!=build['head_sha'] or (proof/'next-site-SHA256SUMS').read_bytes()!=(web/'next-site-SHA256SUMS').read_bytes():raise ValueError('Qualification tested a different artifact')
manifest_sha=hashlib.sha256((a.runtime/'manifest.json').read_bytes()).hexdigest()
if manifest_sha!=report['runtimeSha256']:raise ValueError('Runtime differs from qualified bundle')
command(sys.executable,'hosting/next-static/stage.py','--runtime',str(a.runtime.resolve()),'--frontend',str(web/'deploy-next'),'--catalogue',str(a.catalogue.resolve()),'--output',str(work/'public'))
receipt={'buildRun':a.build_run,'qualificationRun':a.qualification_run,'source':build['head_sha'],'runtimeSha256':manifest_sha,'published':False}
(work/'promotion.json').write_text(json.dumps(receipt,indent=2)+'\n')
if a.publish:
    subprocess.run(['npx','wrangler','whoami'],cwd=REPO,check=True)
    subprocess.run(['npx','wrangler','deploy','--config','hosting/next-static/wrangler.jsonc','--assets',str(work/'public')],cwd=REPO,check=True)
    receipt['published']=True
    (work/'promotion.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
