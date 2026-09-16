// Pan/zoom maths for the square crop stencil. Kept free of the DOM so the geometry can be
// checked directly: the view only has to render what `frame` returns and report pointer moves.
export const MIN_ZOOM=1,MAX_ZOOM=8;

export function clamp(value,low,high){return value<low?low:value>high?high:value;}

/** The largest square that fits the preview, and the zoom at which the square is filled. */
export function baseSquare(previewWidth,previewHeight){
 const side=Math.min(previewWidth,previewHeight);
 return {side,maxOffsetX:(previewWidth-side)/2,maxOffsetY:(previewHeight-side)/2};
}

export function createCrop({previewWidth,previewHeight,scale=1}){
 return {previewWidth,previewHeight,scale,zoom:MIN_ZOOM,offsetX:0,offsetY:0,rotation:0};
}

/** Offsets are in preview pixels, measured from the centre, and always keep the square covered. */
export function limit(state){
 const {side}=baseSquare(state.previewWidth,state.previewHeight);
 const visible=side/state.zoom;
 const spareX=(state.previewWidth-visible)/2,spareY=(state.previewHeight-visible)/2;
 return {...state,offsetX:clamp(state.offsetX,-spareX,spareX),offsetY:clamp(state.offsetY,-spareY,spareY)};
}

export function pan(state,dx,dy){return limit({...state,offsetX:state.offsetX-dx/state.zoom,offsetY:state.offsetY-dy/state.zoom});}
export function zoomTo(state,zoom){return limit({...state,zoom:clamp(zoom,MIN_ZOOM,MAX_ZOOM)});}
export function rotate(state){return {...state,rotation:(state.rotation+90)%360};}

/** The crop rectangle in preview coordinates, ready for cropPhoto. */
export function rect(state){
 const {side}=baseSquare(state.previewWidth,state.previewHeight);
 const visible=side/state.zoom;
 const centreX=state.previewWidth/2+state.offsetX,centreY=state.previewHeight/2+state.offsetY;
 const left=clamp(centreX-visible/2,0,Math.max(0,state.previewWidth-visible));
 const top=clamp(centreY-visible/2,0,Math.max(0,state.previewHeight-visible));
 return {left,top,width:visible,height:visible};
}

/** CSS transform placing the preview behind a fixed square viewport of `viewport` pixels. */
export function frame(state,viewport){
 const area=rect(state);
 const factor=viewport/area.width;
 return {width:state.previewWidth*factor,height:state.previewHeight*factor,x:-area.left*factor,y:-area.top*factor,rotation:state.rotation};
}
