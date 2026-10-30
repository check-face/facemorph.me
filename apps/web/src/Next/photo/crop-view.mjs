// The crop editor's geometry (fm-k09b, locked crop 2.png): a square stencil over the whole photo, moved by drag and
// resized from eight handles, with the photo turned underneath by 90-degree steps and a fine angle. Kept free of the
// DOM so the maths can be checked directly; the view renders `editorLayout` and `previewFrame` and reports pointer
// moves in its own CSS pixels.
//
// Coordinates. The photo is the decoded preview (previewWidth x previewHeight, its own pixels). The square's centre
// (cx, cy) and side are in those pixels. Turning the photo by `rotation` degrees (clockwise on screen) about its own
// centre gives the "turned frame", whose bounding box is what the editor shows; the square is axis-aligned there and
// always stays inside that box. The confirmed crop is the square's centre and side in preview pixels plus the angle:
// encoder pixel (u, v) of an output of `out` pixels takes the photo point c + R(-rotation)((u, v) - out/2) * side/out.
export const FINE_LIMIT=45;
/** The smallest square, as a share of the photo's shorter side (a far face in a group photo still fits). */
export const MIN_SHARE=0.04;

export function clamp(value,low,high){return value<low?low:value>high?high:value;}
const radians=degrees=>degrees*Math.PI/180;
/** -180 < degrees <= 180. */
export function normalise(degrees){let d=((degrees%360)+360)%360;if(d>180)d-=360;return Object.is(d,-0)?0:d;}
const round=value=>Math.abs(value)<1e-9?0:value;

/** The turned photo's bounding box and the maps between photo pixels and the turned frame. */
export function turned(state){
 const a=radians(state.rotation),c=Math.cos(a),s=Math.sin(a),W=state.previewWidth,H=state.previewHeight;
 const width=Math.abs(W*c)+Math.abs(H*s),height=Math.abs(W*s)+Math.abs(H*c);
 return {width,height,
  to:(x,y)=>{const dx=x-W/2,dy=y-H/2;return {x:c*dx-s*dy+width/2,y:s*dx+c*dy+height/2};},
  from:(x,y)=>{const dx=x-width/2,dy=y-height/2;return {x:c*dx+s*dy+W/2,y:-s*dx+c*dy+H/2};}};
}
const minSide=state=>Math.max(1,Math.min(state.previewWidth,state.previewHeight)*MIN_SHARE);

/** The square kept inside the turned photo's box, its side between the minimum and the box's shorter side. */
export function limit(state){
 const box=turned(state);
 const side=clamp(state.side,Math.min(minSide(state),Math.min(box.width,box.height)),Math.min(box.width,box.height));
 const at=box.to(state.cx,state.cy);
 const x=clamp(at.x,side/2,box.width-side/2),y=clamp(at.y,side/2,box.height-side/2);
 const back=box.from(x,y);
 return {...state,side,cx:round(back.x),cy:round(back.y)};
}

export function createCrop({previewWidth,previewHeight,scale=1,viewport=320}){
 // viewport: the editor's square in CSS pixels (the editor reports its measured width).
 const side=Math.min(previewWidth,previewHeight);
 return {previewWidth,previewHeight,scale,viewport,cx:previewWidth/2,cy:previewHeight/2,side,rotation:0,quarter:0,fine:0};
}

/** CSS pixels per turned-frame pixel in an editor of `viewport` pixels, and where the turned box sits in it. */
export function editorScale(state,viewport=state.viewport){
 const box=turned(state),k=viewport/Math.max(box.width,box.height);
 return {k,x:(viewport-box.width*k)/2,y:(viewport-box.height*k)/2,box};
}

/** Moves the square by a pointer move of (dx, dy) editor pixels. */
export function move(state,dx,dy){
 const {k,box}=editorScale(state);
 const at=box.to(state.cx,state.cy),back=box.from(at.x+dx/k,at.y+dy/k);
 return limit({...state,cx:back.x,cy:back.y});
}

/** Handle names: the compass point of the square it sits on. */
export const HANDLES=['nw','n','ne','e','se','s','sw','w'];
const direction=handle=>({x:handle.includes('e')?1:handle.includes('w')?-1:0,y:handle.includes('s')?1:handle.includes('n')?-1:0});

/**
 * Resizes from one handle by a pointer move of (dx, dy) editor pixels: the opposite corner (or edge) stays where it
 * is and the square stays square and inside the photo.
 */
export function resize(state,handle,dx,dy){
 if(!HANDLES.includes(handle))return state;
 const f=direction(handle),{k,box}=editorScale(state),at=box.to(state.cx,state.cy);
 const px=at.x-f.x*state.side/2,py=at.y-f.y*state.side/2;// the fixed point
 const grow=(f.x&&f.y?(f.x*dx+f.y*dy)/2:f.x?f.x*dx:f.y*dy)/k;
 const room=(fixed,dir,extent)=>dir>0?extent-fixed:dir<0?fixed:2*Math.min(fixed,extent-fixed);
 const most=Math.min(room(px,f.x,box.width),room(py,f.y,box.height));
 const side=clamp(state.side+grow,Math.min(minSide(state),most),most);
 const back=box.from(px+f.x*side/2,py+f.y*side/2);
 return limit({...state,cx:back.x,cy:back.y,side});
}

const withAngle=(state,quarter,fine)=>limit({...state,quarter,fine,rotation:normalise(quarter*90+fine)});
/** The rotate button: a quarter turn anticlockwise (EncodeImageDialog.fs rotateCrop), resetting the fine angle. */
export function rotate(state){return withAngle(state,(state.quarter+3)%4,0);}
/** The fine-rotation slider, -45 to 45 degrees on top of the quarter turns. */
export function turnTo(state,fine){return withAngle(state,state.quarter,clamp(Number(fine)||0,-FINE_LIMIT,FINE_LIMIT));}
export function resizeViewport(state,viewport){return {...state,viewport:Math.max(1,viewport)};}

/**
 * The proposal for an aligned face: its square's centre and side (photo pixels) and the angle that stands it upright,
 * split into quarter turns and a fine angle within +-45 degrees.
 */
export function alignedCrop(state,{cx,cy,side,rotation}){
 if(![cx,cy,side,rotation].every(Number.isFinite)||!(side>0))return state;
 const quarter=((Math.round(rotation/90)%4)+4)%4,fine=clamp(normalise(rotation-Math.round(rotation/90)*90),-FINE_LIMIT,FINE_LIMIT);
 return withAngle({...state,cx,cy,side},quarter,fine);
}

/** The crop in preview coordinates for cropPhoto: the square about its centre, with the angle beside it. */
export function rect(state){return {left:state.cx-state.side/2,top:state.cy-state.side/2,width:state.side,height:state.side};}

/**
 * The editor layout in its own CSS pixels: the photo's CSS transform (origin 0 0, the image at its preview size) and
 * the stencil square.
 */
export function editorLayout(state,viewport=state.viewport){
 const {k,x,y,box}=editorScale(state,viewport),at=box.to(state.cx,state.cy);
 return {k,boxX:x,boxY:y,boxWidth:box.width*k,boxHeight:box.height*k,
  transform:`translate(${x+box.width*k/2}px,${y+box.height*k/2}px) rotate(${state.rotation}deg) scale(${k}) translate(${-state.previewWidth/2}px,${-state.previewHeight/2}px)`,
  left:x+(at.x-state.side/2)*k,top:y+(at.y-state.side/2)*k,size:state.side*k};
}

/** The confirmation preview: the photo's CSS transform (origin 0 0) that fills a `size` pixel square with the crop. */
export function previewFrame(state,size){
 const k=size/state.side;
 return {k,transform:`translate(${size/2}px,${size/2}px) rotate(${state.rotation}deg) scale(${k}) translate(${-state.cx}px,${-state.cy}px)`};
}
