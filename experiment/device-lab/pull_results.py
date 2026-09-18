"""Operator retrieval: no tester JSON handoff, no public read access to reports."""
import subprocess,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[3];out=root/'review-artifacts/device-lab-runs';out.mkdir(parents=True,exist_ok=True)
script="import pathlib,json; p=pathlib.Path('/mnt/vessel/files/facemorph-device-lab/results'); print(json.dumps({f.name:json.loads(f.read_text()) for f in p.glob('*.json')}))"
import shlex
reports=json.loads(subprocess.check_output(['ssh','truenas','sudo -n python3 -c '+shlex.quote(script)]))
# Keep raw history; mark recovered originals so analysts do not count them twice.
replacements={d['recoveredFromRunId']:d['runId'] for d in reports.values() if d.get('recoveredFromRunId') and d.get('runId')}
summary=[]
for name,data in reports.items():
 (out/name).write_text(json.dumps(data,indent=2))
 if data.get('test'):continue
 for row in data.get('results',[]):summary.append({'runId':data['runId'],'recoveredFromRunId':data.get('recoveredFromRunId'),'supersededByRunId':replacements.get(data['runId']),'deviceId':data.get('deviceId'),'userAgent':data.get('userAgent'),'browserProduct':data.get('browserIdentity',{}).get('product'),'browserVersion':data.get('browserIdentity',{}).get('version'),'engineFamilyInferred':data.get('browserIdentity',{}).get('engineFamily'),'executionEnvironment':data.get('executionEnvironment',{}).get('kind','unclassified-browser'),'started':data.get('started'),'label':data.get('label'),'id':row['id'],'singleMs':row.get('singleMedianMs',row.get('medianInferenceMs')),'sequenceMsPerFace':row.get('msPerFace'),'video':row.get('video'),'ffmpegEncodeMs':row.get('encodeMs'),'ffmpegDecodeMs':row.get('decodeMs'),'mp4Bytes':row.get('encodedBytes'),'browserPlaybackPassed':row.get('browserPlayback',{}).get('passed'),'completed':row.get('completed'),'error':row.get('error'),'hidden':any(v.get('state')=='hidden' for v in data.get('visibility',[])),'timingVisibility':('backgrounded' if any(v.get('state')=='hidden' for v in data.get('visibility',[])) else 'foreground-recorded' if data.get('visibility') and all(v.get('state')=='visible' for v in data['visibility']) else 'unknown')})
(out/'summary.json').write_text(json.dumps(summary,indent=2))
import csv
if summary:
 with (out/'summary.csv').open('w',newline='') as f:
  writer=csv.DictWriter(f,fieldnames=list(summary[0]));writer.writeheader();writer.writerows(summary)
# Add scope-aware inventory without rewriting raw reports or inventing missing metrics.
# Existing summary/stdout remain compatible with older consumers.
campaign=root/'autoresearch/benchmark-campaign-v2/campaign.py'
if campaign.exists():
 subprocess.run([sys.executable,str(campaign),'inventory','--reports',str(out),'--output',str(out/'benchmark-v2-inventory.json')],check=True,stdout=subprocess.DEVNULL)
print(json.dumps(summary,indent=2))
