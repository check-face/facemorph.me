#!/usr/bin/env python3
"""Stage immutable CPU product assets from preserved research, never modifying sources.
The output is an artifact to serve with HTTPS and COOP/COEP headers. No deployment.
"""
import argparse, hashlib, json, pathlib, shutil
ROOT=pathlib.Path(__file__).resolve().parents[3]
RESEARCH=ROOT.parent/'review-artifacts'
def sha(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--all31',action='store_true');p.add_argument('--encoder',type=pathlib.Path,help='Actual exported encoder.onnx path');p.add_argument('--landmarks',action='store_true');p.add_argument('--webgl',action='store_true');p.add_argument('--webgpu',action='store_true');a=p.parse_args()
    if not a.base_url.startswith('https://'):p.error('HTTPS asset origin required')
    out=a.output.resolve();base=a.base_url.rstrip('/');sources=[]
    def asset(source,folder=None):
        source=pathlib.Path(source);h=sha(source);name=f'assets/{folder or h}/{source.name}';target=out/name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():shutil.copyfile(source,target)
        if sha(target)!=h:raise ValueError(f'Staged asset mismatch: {target}')
        sources.append({'path':name,'source':str(source),'sha256':h,'size':source.stat().st_size})
        return {'url':f'{base}/{name}','sha256':h,'size':source.stat().st_size}
    phase=RESEARCH/'browser-onnx-phase1';meta=json.loads((phase/'manifest.json').read_text());qualification=RESEARCH/'browser-onnx-qualification';q=json.loads((qualification/'manifest.json').read_text())
    runtime=ROOT/'experiment/onnx/node_modules/onnxruntime-web/dist';runtime_files=['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'];runtime_hash=hashlib.sha256(''.join(sha(runtime/f) for f in runtime_files).encode()).hexdigest();runtime_assets=[asset(runtime/f,runtime_hash) for f in runtime_files]
    noise=[dict(asset(phase/n['file']),name=n['name'],shape=n['shape']) for n in meta['noise']]
    cases=q['cases'] if a.all31 else [q['cases'][i] for i in (0,25,26,27,28,29,30)]
    manifest={'schemaVersion':1,'bundleVersion':'next-browser-cpu-v1','releaseQualified':False,'modelSourceSha256':meta['source_sha256'],'runtime':{'version':'1.24.3','moduleUrl':runtime_assets[0]['url'],'wasmPaths':f'{base}/assets/{runtime_hash}/','assets':runtime_assets},'mapping':asset(phase/'mapping.onnx'),'synthesis':asset(RESEARCH/'browser-onnx-energy/synthesis-spatial.onnx'),'average':asset(phase/meta['average']['file']),'noise':noise,'noiseSha256':hashlib.sha256(''.join(x['sha256'] for x in noise).encode()).hexdigest(),'sampleIndices':asset(qualification/q['sampleIndices']),'canaries':[{'name':c['name'],'noise':c['noise'],'w':asset(qualification/c['w']),'samples':asset(qualification/c['samples']),'reference':asset(qualification/c['reference'])} for c in cases]}
    if a.webgl:
        gl=ROOT/'experiment/device-lab/webgl-ladder-v1';gm=json.loads((gl/'manifest.json').read_text());folder=sha(gl/'manifest.json');glassets=[asset(gl/'manifest.json',folder),asset(gl/gm['learnedInput']['file'],folder)]+[asset(gl/b['coefficients']['file'],folder) for b in gm['blocks']]
        manifest['webgl']={'module':asset(pathlib.Path(__file__).parent/'webgl-vector-v1.mjs'),'assetBase':f'{base}/assets/{folder}/','assets':glassets,'manifestSha256':folder}
    if a.webgpu:
        gpu_runtime=ROOT/'experiment/onnx/runtime-122/node_modules/onnxruntime-web/dist';fusion=RESEARCH/'browser-onnx-fusion';mod=RESEARCH/'browser-onnx-mod-fusion'
        manifest['webgpu']={'runtime':{'version':'1.22.0','module':asset(gpu_runtime/'ort.webgpu.min.mjs'),'factory':asset(gpu_runtime/'ort-wasm-simd-threaded.jsep.mjs'),'wasm':asset(gpu_runtime/'ort-wasm-simd-threaded.jsep.wasm')},'prefix':asset(mod/'prefix-segment.onnx'),'suffix':asset(mod/'suffix-segment.onnx'),'split':asset(mod/'split-segment.json'),'metadata':asset(fusion/'manifest.json'),'filter':asset(fusion/'filter.f32'),'bias':asset(fusion/'bias.f32'),'kernel':asset(pathlib.Path(__file__).parent/'fused-resample-v1.mjs')}
    if a.encoder:
        manifest['encoder']=asset(a.encoder)
        photo=a.encoder.parent
        if (photo/'input.png').exists() and (photo/'torch-w.f32').exists():manifest['photoCanary']={'image':asset(photo/'input.png'),'w':asset(photo/'torch-w.f32'),'tensor':asset(photo/'input.f32'),'maxAbs':0.0001,'aligned':True,'preprocessing':'dlib-ffhq-pillow-bilinear-v1'}
    # Independent synthetic photo controls travel with the product repository.
    fixtures=ROOT/'photo-runtime/fixtures'
    if 'photoCanary' in manifest and (fixtures/'seed-1-aligned.w.f32').exists():
        reference=fixtures/'seed-1-aligned.w.f32'
        if sha(reference)!='bf4fd36a75235a1d5bc55e54dedb0862d1dd78883be4db95fb627a23ba3d336b':raise ValueError('Independent seed1 W+ reference changed')
        first=dict(manifest['photoCanary'])
        if (fixtures/'seed-0-torch-reconstructed.png').exists():first['reconstruction']=asset(fixtures/'seed-0-torch-reconstructed.png')
        manifest['photoCanaries']=[first,{'image':asset(ROOT/'self-host/fixtures/seed-1.png'),'w':asset(reference),'maxAbs':0.0001,'aligned':True,'preprocessing':'dlib-ffhq-pillow-bilinear-v1'}]
    codec=ROOT/'experiment/device-lab/node_modules/@ffmpeg/core/dist/esm'
    if (codec/'ffmpeg-core.js').exists():manifest['codec']={'version':'0.12.10','module':asset(codec/'ffmpeg-core.js'),'wasm':asset(codec/'ffmpeg-core.wasm')}
    if a.landmarks:manifest['landmarks']=asset(ROOT/'experiment/hf/models/e4e/shape_predictor_68_face_landmarks.dat')
    out.mkdir(parents=True,exist_ok=True);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(out/'sources.private.json').write_text(json.dumps(sources,indent=2)+'\n')
    print(json.dumps({'manifest':str(out/'manifest.json'),'assets':len(sources),'bytes':sum(x['size'] for x in sources),'releaseQualified':False}))
if __name__=='__main__':main()
