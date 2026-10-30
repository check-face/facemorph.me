import json,sys,statistics as st,collections
D=collections.defaultdict(list);H=collections.defaultdict(set)
for l in open(sys.argv[1]):
  if not l.startswith('{'):continue
  r=json.loads(l)
  if 'pass' not in r:continue
  k=(r.get('engine',r.get('cell')),r['img'],r['pass'])
  D[k+(r['v'],)].append(r);H[(r['img'])].add(r['rgb'])
stages=['wall','alignment-runtime','alignment-model','alignment-model-deserialize','face-landmarks','photo-warp-resize']
print('cell img pass | '+' | '.join(f'{s} orig->fast' for s in stages))
for k in sorted({k[:3] for k in D}):
  o,f=D[k+('orig',)],D[k+('fast',)]
  print(' '.join(k),'n=%d/%d'%(len(o),len(f)),'|',' | '.join('%d->%d'%(st.median([x[s] for x in o]),st.median([x[s] for x in f])) for s in stages),'| ratio %.2f'%(st.median([x['wall'] for x in o])/st.median([x['wall'] for x in f])), '| fast builds',sorted({x['build'] for x in f}),'orig range %d-%d fast range %d-%d'%(min(x['wall'] for x in o),max(x['wall'] for x in o),min(x['wall'] for x in f),max(x['wall'] for x in f)))
print('unique prepared hashes per image',{k:len(v) for k,v in H.items()})
