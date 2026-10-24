import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Cropper, StencilWrapper, BoundingBox, DraggableElement, StencilOverlay, createAspectRatio, getStencilCoordinates,
} from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { CropModal, Guide } from './shared.jsx';
import { normalizeDegrees } from './geometry.js';

const rad = (d) => (d * Math.PI) / 180;

// react-advanced-cropper's RectangleStencil has no children slot, so the oval guide and eye markers
// need a stencil of our own: this is RectangleStencil's body (copied from 0.20.1) plus <Guide/>.
const GuideStencil = forwardRef(function GuideStencil({ cropper, aspectRatio, handlerComponent, lineClassNames }, ref) {
  const state = cropper.getState();
  const transitions = cropper.getTransitions();
  useImperativeHandle(ref, () => ({ aspectRatio: createAspectRatio(aspectRatio) }));
  if (!state) return null;
  const { width, height, left, top } = getStencilCoordinates(state);
  return (
    <StencilWrapper className="advanced-cropper-rectangle-stencil" width={width} height={height} left={left} top={top} transitions={transitions}>
      <BoundingBox
        reference={state.coordinates} className="advanced-cropper-rectangle-stencil__bounding-box"
        handlerComponent={handlerComponent} lineClassNames={lineClassNames}
        onResize={(anchor, directions, options) => cropper.resizeCoordinates(anchor, directions, options)}
        onResizeEnd={() => cropper.resizeCoordinatesEnd()}
      >
        <DraggableElement className="advanced-cropper-rectangle-stencil__draggable-area" onMove={(d) => cropper.moveCoordinates(d)} onMoveEnd={() => cropper.moveCoordinatesEnd()}>
          <StencilOverlay className="advanced-cropper-rectangle-stencil__overlay rac-overlay"><Guide /></StencilOverlay>
        </DraggableElement>
      </BoundingBox>
    </StencilWrapper>
  );
});

function Handle({ wrapperClassName, horizontalPosition: h, verticalPosition: v, disabled, onMove, onMoveEnd }) {
  const dir = (v ? (v === 'north' ? 'n' : 's') : '') + (h ? (h === 'east' ? 'e' : 'w') : '');
  return (
    <div className={`${wrapperClassName} rac-handle`} data-testid={`handle-${dir}`}>
      <DraggableElement className="hit" disabled={disabled} onMove={onMove} onMoveEnd={onMoveEnd} activationDistance={0} />
    </div>
  );
}

// ?zoom=1 enables wheel/pinch image transforms and ?restrict=none lets the stencil leave the photo: extras probes only.
const Q = new URLSearchParams(location.search);
const RacEngine = forwardRef(function RacEngine({ url, rotation, onRequestRotation, onReady }, ref) {
  const cr = useRef(null);
  const base = useRef(0);

  // keep the library's image rotation in step with the shared slider/button state
  useEffect(() => {
    const c = cr.current; const st = c?.getState?.();
    if (!c || !st) return;
    const delta = normalizeDegrees(base.current + rotation - c.getTransforms().rotate);
    if (Math.abs(delta) > 1e-6) c.rotateImage(delta, { immediately: true });
  }, [rotation]);

  // The library models EXIF orientation as an initial image rotation (base), so its imageSize is the
  // RAW stored size and transforms.rotate = base + the person's rotation.
  const frame = () => {
    const st = cr.current.getState();
    const rw = st.imageSize.width, rh = st.imageSize.height;
    const R = rad(st.transforms.rotate), B = rad(base.current);
    const box = (w, h, a) => [Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))];
    const [uw, uh] = box(rw, rh, B); // upright size
    const [bw, bh] = box(rw, rh, R); // bounding box the coordinates live in
    return { st, uw, uh, u: st.transforms.rotate - base.current, bw, bh };
  };

  useImperativeHandle(ref, () => ({
    getCropper: () => cr.current,
    getImageSize: () => { const s = cr.current?.getState(); if (!s) return null; const f = frame(); return { w: Math.round(f.uw), h: Math.round(f.uh) }; },
    getResult() {
      const { st, uw, uh, u, bw, bh } = frame();
      const c = st.coordinates;
      const vx = c.left + c.width / 2 - bw / 2, vy = c.top + c.height / 2 - bh / 2;
      const t = rad(-u);
      const sx = vx * Math.cos(t) - vy * Math.sin(t), sy = vx * Math.sin(t) + vy * Math.cos(t);
      return { x: uw / 2 + sx - c.width / 2, y: uh / 2 + sy - c.width / 2, size: c.width, rotation: normalizeDegrees(u) };
    },
    async setCrop(crop) {
      onRequestRotation(crop.rotation); // shared state; effect above rotates the library
      const c = cr.current;
      const delta = normalizeDegrees(base.current + crop.rotation - c.getTransforms().rotate);
      if (Math.abs(delta) > 1e-6) c.rotateImage(delta, { immediately: true });
      const { uw, uh, u, bw, bh } = frame();
      const sx = crop.x + crop.size / 2 - uw / 2, sy = crop.y + crop.size / 2 - uh / 2;
      const t = rad(u);
      const vx = sx * Math.cos(t) - sy * Math.sin(t), vy = sx * Math.sin(t) + sy * Math.cos(t);
      c.setCoordinates({ left: bw / 2 + vx - crop.size / 2, top: bh / 2 + vy - crop.size / 2, width: crop.size, height: crop.size }, { immediately: true });
    },
  }));

  return (
    <Cropper
      ref={cr} className="rac" src={url}
      stencilComponent={GuideStencil}
      stencilProps={{ aspectRatio: 1, handlerComponent: Handle, lineClassNames: { default: 'rac-line' } }}
      transitions={false}
      transformImage={Q.get('zoom') ? { touch: true, mouse: true, wheel: true } : { touch: false, mouse: false, wheel: false }}
      imageRestriction={Q.get('restrict') === 'none' ? 'none' : 'fitArea'}
      defaultCoordinates={({ visibleArea, imageSize }) => {
        const a = visibleArea || { left: 0, top: 0, width: imageSize.width, height: imageSize.height };
        const size = 0.8 * Math.min(a.width, a.height);
        return { width: size, height: size, left: a.left + 0.1 * a.width, top: a.top + 0.1 * a.height };
      }}
      onReady={(c) => {
        base.current = c.getTransforms().rotate;
        // stencil = 80% of the stage at a 10% offset (locked design), expressed in the library's visible-area units
        const va = c.getVisibleArea();
        if (va) c.setCoordinates({ left: va.left + 0.1 * va.width, top: va.top + 0.1 * va.height, width: 0.8 * va.width, height: 0.8 * va.width }, { immediately: true });
        onReady();
      }}
    />
  );
});

createRoot(document.getElementById('root')).render(<CropModal Engine={RacEngine} name="rac" />);
