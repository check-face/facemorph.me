// Host-opted-in installed-artifact rehearsal through the real product controls.
(async()=>{
 const steps=[],started=Date.now(),pause=ms=>new Promise(r=>setTimeout(r,ms));
 let unlisten;const native=[];const downloads=[];
 const originalClick=HTMLAnchorElement.prototype.click;
 async function saved(kind,type){for(let i=0;i<100;i++){try{const data=await window.__TAURI__.core.invoke('desktop_test_saved_media',{kind});return new Blob([data instanceof ArrayBuffer?data:new Uint8Array(data)],{type});}catch{await pause(100);}}throw Error('Native file save did not finish');}
 function button(label){const value=[...document.querySelectorAll('button')].find(x=>x.textContent===label);if(!value||value.disabled)throw Error(`Unavailable control: ${label}`);value.click();}
 const set=(element,value)=>{const proto=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));};
 async function ready(predicate,timeout=900000){const begin=Date.now();await pause(150);while(Date.now()-begin<timeout){const error=document.querySelector('.next-error');if(error)throw Error(error.innerText);if(!document.querySelector('.next-status progress')&&predicate())return;await pause(200);}throw Error('Installed workflow timed out');}
 async function images(){const values=[...document.querySelectorAll('.next-face-image img')];if(values.length!==2)throw Error('Expected two generated faces');for(const value of values){await value.decode();if(value.naturalWidth!==1024||value.naturalHeight!==1024)throw Error('Full1024 output missing');}return values;}
 const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
 try{
  await ready(()=>!!document.querySelector('.next-product'),30000);
  unlisten=await window.__TAURI__.event.listen('native-event',({payload:e})=>{if(e.type==='qualified'||e.type==='completed'||e.type==='failed')native.push(e);});
  HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:'))downloads.push(fetch(this.href).then(x=>x.blob()));else originalClick.call(this);};
  set(document.querySelectorAll('select[aria-label="Face source"]')[0],'seed');await pause(100);
  set(document.querySelectorAll('select[aria-label="Face source"]')[1],'text');await pause(100);
  set(document.querySelector('input[aria-label="Numeric seed"]'),'0');set(document.querySelector('input[aria-label="Name or words"]'),'oliver');
  button('Generate faces');await ready(()=>document.querySelectorAll('.next-face-image img').length===2);await images();steps.push('seed-text-full1024');
  button('Generate faces');await ready(()=>document.querySelectorAll('.next-face-image img').length===2);await images();steps.push('repeat-cache');
  const photo=await window.__TAURI__.core.invoke('desktop_test_photo');
  set(document.querySelectorAll('select[aria-label="Face source"]')[0],'photo');await pause(100);
  const transfer=new DataTransfer();transfer.items.add(new File([photo instanceof ArrayBuffer?photo:new Uint8Array(photo)],'synthetic-fixture.png',{type:'image/png'}));
  const photoInput=document.querySelector('input[aria-label="Choose photo"]');photoInput.files=transfer.files;photoInput.dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
  button('Generate faces');await ready(()=>document.querySelectorAll('.next-face-image img').length===2);await images();steps.push('actual-photo-e4e');
  button('Export project');await pause(100);const project=await saved('project','application/json');const parsed=JSON.parse(await project.text());if(parsed.morph.controls.length!==2||parsed.morph.controls.some(x=>x.latent.values.length!==9216))throw Error('Editable project is incomplete');
  const imported=new DataTransfer();imported.items.add(new File([project],'project.json',{type:'application/json'}));const input=document.querySelector('input[aria-label="Open project"]');input.files=imported.files;input.dispatchEvent(new Event('change',{bubbles:true}));await ready(()=>document.querySelectorAll('.next-face-image img').length===2);await images();steps.push('project-export-reopen');
  button('Create morph');await ready(()=>!!document.querySelector('.next-result video'));const video=document.querySelector('.next-result video');await new Promise((resolve,reject)=>{if(video.readyState>=1)return resolve();video.addEventListener('loadedmetadata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('Exported video cannot open')),{once:true});setTimeout(()=>reject(Error('Video metadata timeout')),30000);});if(!Number.isFinite(video.duration)||video.duration<=0||video.videoWidth!==512)throw Error('Invalid morph video');steps.push('figure-eight-video-playback');
  button('Save video');await pause(100);const media=await saved('video','video/mp4');if(media.type!=='video/mp4'||media.size<1000)throw Error('Video save did not contain the morph');steps.push('actual-video-save');
  if(!native.some(x=>x.type==='qualified'&&x.deviceValidated&&x.provider==='native-cpu')||!native.some(x=>x.cached===true))throw Error('Native admission/cache evidence missing');
  await window.__TAURI__.core.invoke('desktop_workflow_result',{result:{passed:true,steps,native,seconds:(Date.now()-started)/1000,video:{sha256:await digest(media),bytes:media.size,width:video.videoWidth,height:video.videoHeight,duration:video.duration},projectSha256:await digest(project)}});
 }catch(error){await window.__TAURI__.core.invoke('desktop_workflow_result',{result:{passed:false,steps,native,error:String(error.message),seconds:(Date.now()-started)/1000}});}
 finally{HTMLAnchorElement.prototype.click=originalClick;unlisten?.();}
})();
