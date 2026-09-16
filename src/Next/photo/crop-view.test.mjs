import test from 'node:test';import assert from 'node:assert/strict';
import {MAX_ZOOM,MIN_ZOOM,createCrop,frame,pan,rect,rotate,zoomTo} from './crop-view.mjs';
import {cropPhoto,previewPhoto} from './crop.mjs';

/** The Elmish view passes no options at all, so null must behave like an absent argument. */
test('Preview and crop accept a missing options argument',async()=>{
 const saved={bitmap:globalThis.createImageBitmap,canvas:globalThis.OffscreenCanvas,url:globalThis.URL};
 globalThis.createImageBitmap=async(source,options)=>({width:options?.resizeWidth??source.width??5000,height:options?.resizeHeight??source.height??4000,close(){}});
 globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage(){},save(){},restore(){},translate(){},rotate(){}};}async convertToBlob(){return new Blob([new Uint8Array(64)]);}};
 globalThis.URL={createObjectURL:()=> 'blob:x',revokeObjectURL(){}};
 try{
  const photo=new Blob([new Uint8Array(64)]);
  const preview=await previewPhoto(photo,null);
  assert.equal(preview.sourceWidth,5000);
  assert.equal(Math.max(preview.previewWidth,preview.previewHeight),4096,'The preview is bounded to the long edge');
  const cropped=await cropPhoto(photo,{left:0,top:0,width:100,height:100},null);
  assert.equal(cropped.name,'cropped.png');assert.equal(cropped.type,'image/png');
 }finally{globalThis.createImageBitmap=saved.bitmap;globalThis.OffscreenCanvas=saved.canvas;globalThis.URL=saved.url;}
});

test('An unzoomed crop is the largest centred square of the preview',()=>{
 const wide=rect(createCrop({previewWidth:4000,previewHeight:3000}));
 assert.deepEqual(wide,{left:500,top:0,width:3000,height:3000});
 const tall=rect(createCrop({previewWidth:3000,previewHeight:4000}));
 assert.deepEqual(tall,{left:0,top:500,width:3000,height:3000});
});

test('Panning cannot move the square off the photo',()=>{
 let state=createCrop({previewWidth:4000,previewHeight:3000});
 state=pan(state,-100000,-100000);
 let area=rect(state);
 assert.equal(area.left+area.width<=4000,true);assert.equal(area.top,0,'A square that already fills the height cannot pan vertically');
 assert.equal(area.left,1000,'Panning stops at the right edge');
 state=pan(state,100000,100000);
 area=rect(state);
 assert.equal(area.left,0,'Panning stops at the left edge');
});

test('Zoom is bounded and shrinks the crop about the current centre',()=>{
 const start=createCrop({previewWidth:2000,previewHeight:2000});
 assert.equal(zoomTo(start,0.1).zoom,MIN_ZOOM);
 assert.equal(zoomTo(start,999).zoom,MAX_ZOOM);
 const zoomed=rect(zoomTo(start,2));
 assert.deepEqual(zoomed,{left:500,top:500,width:1000,height:1000});
});

test('Zooming in then panning to a corner stays inside the photo',()=>{
 let state=zoomTo(createCrop({previewWidth:2000,previewHeight:1000}),4);
 state=pan(state,-99999,-99999);
 const area=rect(state);
 assert.equal(area.width,250);
 assert.equal(area.left+area.width,2000);
 assert.equal(area.top+area.height,1000);
});

test('Rotation steps through right angles only',()=>{
 let state=createCrop({previewWidth:10,previewHeight:10});
 assert.equal(state.rotation,0);
 for(const expected of [90,180,270,0])assert.equal((state=rotate(state)).rotation,expected);
});

test('The rendered frame places the chosen square under the viewport',()=>{
 const state=zoomTo(createCrop({previewWidth:4000,previewHeight:3000}),2);
 const placed=frame(state,300);
 const area=rect(state);
 assert.equal(placed.width/4000,300/area.width,'The preview scales so the crop fills the viewport');
 assert.equal(placed.x,-area.left*(300/area.width));
 assert.equal(placed.y,-area.top*(300/area.width));
});
