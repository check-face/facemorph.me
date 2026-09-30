from pathlib import Path
import json,csv,collections,hashlib
R=Path(__file__).resolve().parents[3]/'review-artifacts/browser-onnx-round5';rows=[];dispatches=[]
for p in sorted((R/'local').glob('profile-*.json')):
 doc=json.loads(p.read_text());r=doc['rows'][0]
 if 'trace' not in r:continue
 t=r['trace'];b=r['batch'];tot=collections.defaultdict(float);counts=collections.Counter()
 for d in t['dispatches']:
  prog=t['programs'][d['shader']];label=prog['label'];tot[label]+=d['ms']/b;counts[label]+=1
  dispatches.append({'case':r['name'],'batch':b,'index':d['index'],'shader':label,'sha256':hashlib.sha256(prog['code'].encode()).hexdigest(),'ms':d['ms'],'ms_per_frame':d['ms']/b,'groups':str(d['groups'])})
 rows.append({'case':r['name'],'batch':b,'wallMsPerFrame':r['msPerFace'],'profileGpuMsPerFrame':sum(tot.values()),'dispatches':len(t['dispatches']),'memory':r['memory'],'correctness':r['correctness'],'categories':[{ 'shader':k,'msPerFrame':v,'dispatches':counts[k]} for k,v in sorted(tot.items(),key=lambda kv:-kv[1])]})
(R/'profile-summary.json').write_text(json.dumps(rows,indent=2))
with (R/'per-shader.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(dispatches[0]));w.writeheader();w.writerows(dispatches)
for r in rows:print(r['case'],round(r['profileGpuMsPerFrame'],2),r['dispatches'],[(x['shader'],round(x['msPerFrame'],2)) for x in r['categories'][:8]])
