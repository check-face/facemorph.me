// Explicit research entry only. Capability does not imply correctness.
export function gpuDiagnosticPlan(config,device){
 const candidates=config.experiments.filter(e=>['iphone-unshared-gpu','iphone-ort-format-gpu','iphone-no-prepack-gpu'].includes(e.id)),candidate=candidates.length===1?candidates[0]:null;
 if(!candidate)throw Error('GPU diagnostic configuration is missing');
 const gpu=!!device.gpu,limit=device.gpu?.limits?.maxStorageBufferBindingSize;
 const supported=gpu&&Number.isFinite(limit)&&limit>=134217728;
 return {facts:{ios:device.browserIdentity?.ios===true,gpu,bindingBytes:limit??null,classification:candidate.id==='iphone-unshared-gpu'?'explicit-unshared-gpu-diagnostic':candidate.id==='iphone-ort-format-gpu'?'explicit-ort-format-gpu-diagnostic':'explicit-onnx-no-prepack-gpu-diagnostic',recoveryMode:'explicit-gpu-check'},decisions:[{id:candidate.id,name:candidate.name,status:supported?'selected':'skipped',reason:supported?(candidate.id==='iphone-unshared-gpu'?'Explicit unshared GPU diagnostic. Canary success does not qualify face inference.':candidate.id==='iphone-ort-format-gpu'?'Explicit ORT-format diagnostic using the existing shared GPU runtime. All31 face references must pass.':'Explicit ONNX prepacking-disabled control using the existing shared GPU runtime. All31 face references must pass.'):'WebGPU with a 128 MiB storage binding is unavailable in this browser. CPU remains available on the main lab.'}]};
}
