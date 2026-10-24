import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './styles.css';
import { FINE_MAX, FINE_MIN, formatDegrees, normalizeDegrees, readExifOrientation, readJpegSize, splitRotation, totalRotation, uprightCropToRaw } from './geometry.js';

export const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function Guide() {
  return (
    <div className="guide-layer">
      <div className="guide" data-testid="guide" />
      <div className="eye left" data-testid="eye-left" />
      <div className="eye right" data-testid="eye-right" />
    </div>
  );
}

const RotateIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3.5v10.5h10.5" /><path d="M3.5 7H14v10.5" /><path d="M18.5 6.5a8 8 0 0 0-6.5-3" /><path d="M5.5 17.5a8 8 0 0 0 6.5 3" />
  </svg>
);

/**
 * Shared modal chrome. `Engine` renders the stage content and implements
 * { getResult(), setCrop(crop), getImageSize() } on its ref; it receives `rotation` (total degrees)
 * and `onRequestRotation(total)`.
 */
export function CropModal({ Engine, name }) {
  const engine = useRef(null);
  const [src, setSrc] = useState(null);
  const [quarter, setQuarter] = useState(0);
  const [fine, setFine] = useState(0);
  const total = totalRotation(quarter, fine);
  const info = useRef({ orientation: 1, rawW: 0, rawH: 0 });
  const readyResolve = useRef(null);
  const ready = useRef(null);
  if (!ready.current) ready.current = new Promise((r) => { readyResolve.current = r; });

  useEffect(() => {
    const img = new URLSearchParams(location.search).get('img') || 'scene-o1.jpg';
    let revoked = false; let url;
    (async () => {
      const bytes = new Uint8Array(await (await fetch(`fixtures/${img}`)).arrayBuffer());
      const sz = readJpegSize(bytes);
      info.current = { orientation: readExifOrientation(bytes), rawW: sz.w, rawH: sz.h };
      if (revoked) return;
      url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      setSrc(url);
    })();
    return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
  }, []);

  const requestRotation = (t) => {
    const s = splitRotation(t);
    flushSync(() => { setQuarter(s.quarter); setFine(s.fine); });
  };

  useEffect(() => {
    window.__cropper = {
      name,
      whenReady: () => ready.current,
      info: () => ({ ...info.current, upright: engine.current?.getImageSize?.() ?? null }),
      /** upright-source {x,y,size,rotation} */
      getResult: () => engine.current.getResult(),
      /** raw stored-pixel {x,y,size,rotation} via the pure mapping */
      getRawResult: () => {
        const { orientation, rawW, rawH } = info.current;
        return uprightCropToRaw(engine.current.getResult(), orientation, rawW, rawH);
      },
      setCrop: (c) => engine.current.setCrop(c),
      raw: () => engine.current.getCropper?.(),
      state: () => ({ quarter, fine, total, readout: formatDegrees(total) }),
    };
  });

  return (
    <div className="backdrop">
      <div className="modal" role="dialog" aria-label="Crop your image" data-testid="modal" data-proto={name}>
        <div className="modal-inner">
        <h2 className="title">Crop your image</h2>
        <div className="content" data-testid="content">
          <div className="stage" data-testid="stage">
            {src && <Engine ref={engine} url={src} rotation={total} onRequestRotation={requestRotation} onReady={() => readyResolve.current?.()} />}
          </div>
          <div className="rotate-row">
            <button type="button" className="rotate-btn" data-testid="rotate-button" aria-label="Rotate 90 degrees" onClick={() => setQuarter((q) => (q + 1) % 4)}>
              <RotateIcon />
            </button>
            <span className="readout" data-testid="rotation-readout" aria-live="polite">{formatDegrees(total)}</span>
          </div>
          <input
            className="slider" type="range" data-testid="rotation-slider" aria-label="Fine rotation"
            min={FINE_MIN} max={FINE_MAX} step="0.5" value={fine}
            onInput={(e) => setFine(Number(e.currentTarget.value))} onChange={(e) => setFine(Number(e.currentTarget.value))}
          />
          <p className="help"><b>Cropping is generally not necessary, as faces are usually auto detected.</b><br />Try to leave a bit above the top of the head and below the chin.<br />Lining up the eyes is most important.</p>
        </div>
        <div className="footer">
          <button type="button" className="btn cancel" data-testid="cancel">Cancel</button>
          <button type="button" className="btn use" data-testid="use-crop">Use crop</button>
        </div>
        </div>
      </div>
    </div>
  );
}
