import sys,json,statistics as st
for line in sys.stdin:
  line=line.strip()
  try:d=json.loads(line)
  except: print(line[:300]);continue
  if 'rows' not in d: print(d);continue
  r=d['rows']
  if 'perFrame' in r[0]: print(d['label'],'perFrame',round(r[0]['perFrame'],1),'hashes',len([h for h in r[0]['hashes'] if h]));continue
  r=[x for x in r if not x.get('warmup')];keys=[k for k in r[0] if k!='marks' and isinstance(r[0][k],(int,float))]
  print(d['label'],'n=%d'%len(r),{k:round(st.median([x[k] for x in r]),1) for k in keys})
  ms={};[ms.setdefault(n,[]).append(t) for x in r for n,t in x.get('marks',[])]
  if ms:print('  marks',{n:round(st.median(v),1) for n,v in ms.items()})
