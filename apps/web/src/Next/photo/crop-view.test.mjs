import test from 'node:test';import assert from 'node:assert/strict';
import {FINE_LIMIT,HANDLES,MIN_SHARE,alignedCrop,createCrop,editorLayout,move,previewFrame,rect,resize,rotate,turnTo} from './crop-view.mjs';
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

test('The first crop is the largest centred square of the preview',()=>{
 const wide=rect(createCrop({previewWidth:4000,previewHeight:3000}));
 assert.deepEqual(wide,{left:500,top:0,width:3000,height:3000});
 const tall=rect(createCrop({previewWidth:3000,previewHeight:4000}));
 assert.deepEqual(tall,{left:0,top:500,width:3000,height:3000});
});

test('Dragging the square moves it 1:1 with the pointer and never off the photo',()=>{
 // 4000 x 3000 in a 400 px editor: 10 photo pixels per editor pixel.
 let state=resize(createCrop({previewWidth:4000,previewHeight:3000,viewport:400}),'se',-100,-100);
 assert.equal(state.side,2000,'the south-east handle pulled in by 100 editor pixels on both axes');
 const before=editorLayout(state);
 state=move(state,37,-12);
 const after=editorLayout(state);
 assert(Math.abs(after.left-before.left-37)<1e-9&&Math.abs(after.top-before.top+0)<1e-9,'already at the top edge: only the horizontal part moves');
 state=move(state,1e6,1e6);
 assert.deepEqual(rect(state),{left:2000,top:1000,width:2000,height:2000});
 state=move(state,-1e6,-1e6);
 assert.deepEqual(rect(state),{left:0,top:0,width:2000,height:2000});
});

test('Each of the eight handles resizes about the opposite side and keeps the square inside the photo',()=>{
 const start=resize(createCrop({previewWidth:2000,previewHeight:2000,viewport:200}),'se',-100,-100);// 1000 at 0,0
 const centred=move(start,50,50);// 500..1500
 assert.deepEqual(rect(centred),{left:500,top:500,width:1000,height:1000});
 const cases={nw:[-10,-10,{left:400,top:400,width:1100,height:1100}],n:[0,-10,{left:450,top:400,width:1100,height:1100}],
  ne:[10,-10,{left:500,top:400,width:1100,height:1100}],e:[10,0,{left:500,top:450,width:1100,height:1100}],
  se:[10,10,{left:500,top:500,width:1100,height:1100}],s:[0,10,{left:450,top:500,width:1100,height:1100}],
  sw:[-10,10,{left:400,top:500,width:1100,height:1100}],w:[-10,0,{left:400,top:450,width:1100,height:1100}]};
 for(const handle of HANDLES){const [dx,dy,want]=cases[handle];assert.deepEqual(rect(resize(centred,handle,dx,dy)),want,handle);}
 // Growing past the photo stops at its edge with the fixed side still fixed; shrinking stops at the minimum.
 assert.deepEqual(rect(resize(centred,'se',1e6,1e6)),{left:500,top:500,width:1500,height:1500});
 assert.deepEqual(rect(resize(centred,'n',0,1e6)).width,2000*MIN_SHARE);
});

test('The rotate button turns a quarter anticlockwise and resets the fine angle; the slider is bounded',()=>{
 let state=createCrop({previewWidth:10,previewHeight:10});
 state=turnTo(state,12);
 assert.equal(state.rotation,12);
 for(const expected of [-90,180,90,0]){state=rotate(state);assert.equal(state.rotation,expected);assert.equal(state.fine,0);}
 assert.equal(turnTo(state,99).fine,FINE_LIMIT);
 assert.equal(turnTo(state,-99).rotation,-FINE_LIMIT);
});

test('A turned photo keeps the square inside its turned box and the drag in screen terms',()=>{
 let state=createCrop({previewWidth:800,previewHeight:1200,viewport:240});
 state=rotate(state);// the box is now 1200 wide and 800 tall
 const layout=editorLayout(state);
 assert(Math.abs(layout.boxWidth-240)<1e-9&&Math.abs(layout.boxHeight-160)<1e-9);
 assert(Math.abs(layout.size-160)<1e-9,'the square fills the shorter side of the turned box');
 const moved=editorLayout(move(state,24,0));
 assert(Math.abs(moved.left-layout.left-24)<1e-9&&Math.abs(moved.top-layout.top)<1e-9,'a rightward drag moves the square right on screen');
 // At 30 degrees the box grows; the square stays inside it.
 const fine=turnTo(createCrop({previewWidth:1000,previewHeight:1000,viewport:200}),30);
 const b=editorLayout(fine);
 assert(b.left>=b.boxX-1e-9&&b.top>=b.boxY-1e-9&&b.left+b.size<=b.boxX+b.boxWidth+1e-9&&b.top+b.size<=b.boxY+b.boxHeight+1e-9);
});

test('An aligned face becomes the proposal with its angle split into quarter turns and a fine angle',()=>{
 const base=createCrop({previewWidth:2000,previewHeight:1500});
 const upright=alignedCrop(base,{cx:900,cy:700,side:600,rotation:-12});
 assert.deepEqual([upright.cx,upright.cy,upright.side,upright.quarter,upright.fine,upright.rotation],[900,700,600,0,-12,-12]);
 const sideways=alignedCrop(base,{cx:900,cy:700,side:600,rotation:95});
 assert.deepEqual([sideways.quarter,sideways.fine,sideways.rotation],[1,5,95]);
 const big=alignedCrop(base,{cx:100,cy:100,side:4000,rotation:0});
 assert.deepEqual(rect(big),{left:0,top:0,width:1500,height:1500},'larger than the photo: the largest square at that edge');
 assert.equal(alignedCrop(base,{cx:NaN,cy:0,side:1,rotation:0}),base);
});

test('The confirmation preview fills its square with exactly the crop',()=>{
 const state=alignedCrop(createCrop({previewWidth:4000,previewHeight:3000}),{cx:1000,cy:1200,side:800,rotation:0});
 const placed=previewFrame(state,300);
 assert.equal(placed.k,300/800);
 assert.match(placed.transform,/translate\(150px,150px\) rotate\(0deg\) scale\(0\.375\) translate\(-1000px,-1200px\)/);
});

test('browser decode neutralizes EXIF without changing JPEG pixels or original bytes',async()=>{
 const {browserDecodeBytes}=await import('./crop.mjs');
 const scan=Uint8Array.from([255,216,255,225,0,10,69,120,105,102,0,0,1,2,255,218,0,2,1,2,3,255,217]);
 const before=scan.slice(),clean=browserDecodeBytes(scan);
 assert.deepEqual(scan,before,'Chosen file is immutable');
 assert.deepEqual(clean,Uint8Array.from([255,216,255,218,0,2,1,2,3,255,217]));
 assert.equal(browserDecodeBytes(clean),clean,'No extra copy for ordinary images');
});
