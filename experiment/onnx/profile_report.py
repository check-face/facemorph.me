from pathlib import Path
import json,collections
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'review-artifacts/browser-onnx-profile'
r=json.loads((OUT/'browser.json').read_text());row=r['rows'][0];t=row['trace'];tot=collections.defaultdict(float);counts=collections.Counter()
def kind(c):
 if 'get_dy_by_indices' in c:return 'Transposed convolution (upsampling)'
 if ('get_x_by_indices' in c and 'get_w_by_indices' in c) or 'filter_dims' in c or 'mm_readA' in c and 'uniforms.strides' in c:return 'Convolution / filtering'
 if 'mm_readA' in c:return 'Affine / 1×1 matrix multiplication'
 if 'lower_pads' in c:return 'Padding / zero insertion'
 if 'uniforms.signs' in c:return 'Slice / crop'
 if 'tile_size' in c or 'perm' in c:return 'Layout / transpose'
 if 'DIV_CEIL' in c:return 'Reduction'
 return 'Elementwise / indexing / other'
for d in t['dispatches']:
 d['category']=kind(t['programs'][d['shader']]['code']);tot[d['category']]+=d['ms'];counts[d['category']]+=1
summary={'started':r['started'],'profile_wall_ms':row['instrumentedWallMs'],'gpu_ms':sum(tot.values()),'uninstrumented_ms_per_face':row['msPerFace'],'dispatch_count':len(t['dispatches']),'categories':[{'name':k,'ms':v,'dispatches':counts[k]} for k,v in sorted(tot.items(),key=lambda p:-p[1])],'uniform_upload_bytes':sum(x['bytes'] for x in t['copies'] if x['kind']=='writeBuffer'),'memory':t['memory'],'top_dispatches':sorted(t['dispatches'],key=lambda d:-d['ms'])[:15]}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['top_dispatches']},indent=2))
