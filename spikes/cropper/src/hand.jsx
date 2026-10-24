import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CropModal, Guide, HANDLE_DIRS } from './shared.jsx';
import { containScale, cropToViewStencil, moveSquare, resizeSquare, viewStencilToCrop } from './geometry.js';

const POS = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
const MIN = 56;

const HandEngine = forwardRef(function HandEngine({ url, rotation, onRequestRotation, onReady }, ref) {
  const stageRef = useRef(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [img, setImg] = useState(null);
  // stencil kept as fractions of the (square) stage so it survives resizes
  const [frac, setFrac] = useState({ left: 0.1, top: 0.1, size: 0.8 });
  const drag = useRef(null);

  useLayoutEffect(() => {
    const el = stageRef.current.parentElement; // .stage
    const measure = () => { const r = el.getBoundingClientRect(); setStage({ w: r.width, h: r.height }); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = { left: frac.left * stage.w, top: frac.top * stage.w, size: frac.size * stage.w };
  const commit = (st) => setFrac({ left: st.left / stage.w, top: st.top / stage.w, size: st.size / stage.w });

  useImperativeHandle(ref, () => ({
    getImageSize: () => img,
    getResult: () => viewStencilToCrop(px, rotation, img, stage),
    async setCrop(crop) {
      onRequestRotation(crop.rotation);
      commit(cropToViewStencil(crop, img, stage));
    },
  }));

  const scale = img ? containScale(img.w, img.h, stage.w, stage.h) : 1;
  const down = (kind) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, start: px };
  };
  const move = (e) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    commit(d.kind === 'move' ? moveSquare(d.start, dx, dy, stage) : resizeSquare(d.start, d.kind, dx, dy, stage, MIN));
  };
  const up = (e) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0 }} data-testid="hand-root">
      <img
        className="hand-img" alt="" src={url}
        onLoad={(e) => { setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); onReady(); }}
        style={img ? {
          width: img.w * scale, height: img.h * scale,
          left: (stage.w - img.w * scale) / 2, top: (stage.h - img.h * scale) / 2,
          transform: `rotate(${rotation}deg)`,
        } : { visibility: 'hidden' }}
      />
      {img && (
        <div className="stencil" data-testid="stencil" style={{ left: px.left, top: px.top, width: px.size, height: px.size }}
          onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <Guide />
          {HANDLE_DIRS.map((d) => (
            <div key={d} className="handle" data-testid={`handle-${d}`} style={{ left: `${POS[d][0]}%`, top: `${POS[d][1]}%` }}
              onPointerDown={(e) => { e.stopPropagation(); down(d)(e); }} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          ))}
        </div>
      )}
    </div>
  );
});

createRoot(document.getElementById('root')).render(<CropModal Engine={HandEngine} name="hand" />);
