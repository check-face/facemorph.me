// The video slot and classic's slider (Product.fs nextSlider and videoSlot, lines 1071-1124). One result at a
// time: the slider replaces the video and the video the slider. The slider's position is the caller's state, so
// a visitor who scrubbed, unticked Use Slider and came back finds the same frame; frames not yet stored say so.
// Buttons classic left uncoloured get color="inherit": MUI 4's default Button colour was the text colour, MUI 5+ made it primary.
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import { useEffect, useRef, useState } from 'react';

export function MorphSlider({
  frames,
  dim,
  frame,
  onFrame,
}: {
  frames: readonly string[];
  dim: number;
  frame: number;
  onFrame: (n: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const selected = Math.max(1, Math.min(frame, frames.length));
  const url = frames[selected - 1] ?? '';
  // Drawn in an effect, after the canvas exists, once the frame's image has loaded (classic's first-frame fix).
  useEffect(() => {
    const target = canvas.current;
    if (!url) {
      target?.getContext('2d')?.clearRect(0, 0, dim, dim);
      return;
    }
    const img = new Image(dim, dim);
    img.onload = () => {
      if (!canvas.current) return;
      canvas.current.width = dim;
      canvas.current.height = dim;
      canvas.current.getContext('2d')?.drawImage(img, 0, 0, dim, dim);
    };
    img.src = url;
    return () => {
      img.onload = null;
      img.src = '';
    };
  }, [url, dim]);
  return (
    <div className="next-slider">
      {url === '' && (
        <p role="status">
          This frame is still queued. Scrub to an available frame or wait for generation.
        </p>
      )}
      <canvas
        ref={canvas}
        width={dim}
        height={dim}
        style={{ maxWidth: '100%', height: 'auto' }}
        aria-label="Morph preview, frame by frame"
        role="img"
      />
      <Slider
        min={1}
        max={frames.length}
        value={selected}
        onChange={(_, v) => onFrame(Array.isArray(v) ? (v[0] ?? 1) : v)}
        aria-label="Morph frame"
        className="next-slider-control"
      />
    </div>
  );
}

export interface VideoSlotProps {
  readonly videoUrl: string;
  readonly poster?: string | undefined;
  readonly useSlider: boolean;
  /** Retained frame URLs (bridge sliderFrames), or null when this morph's frames are not stored here. */
  readonly sliderFrames: readonly string[] | null;
  readonly sliderFrame: number;
  readonly busy: boolean;
  readonly videoDim: number;
  readonly onUseSlider: (on: boolean) => void;
  readonly onSliderFrame: (n: number) => void;
  readonly onShare: () => void;
  readonly onSave: () => void;
}

export function VideoSlot(p: VideoSlotProps) {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null);
  if (p.videoUrl === '') return <div className="next-video-slot" />;
  const showSlider = p.useSlider || (p.busy && p.sliderFrames !== null);
  const slider = !p.useSlider ? null : p.sliderFrames ? (
    <MorphSlider
      frames={p.sliderFrames}
      dim={p.videoDim}
      frame={p.sliderFrame}
      onFrame={p.onSliderFrame}
    />
  ) : (
    <p className="next-slider-empty" role="note">
      This morph's frames are not saved on this device yet, so the slider has nothing to scrub.
      Generate the morph again once frame storage is on.
    </p>
  );
  return (
    <div className="next-video-slot">
      {!showSlider && (
        <video
          src={p.videoUrl}
          controls
          loop
          playsInline
          aria-label="Your morph"
          className="next-video"
          onLoadedMetadata={(e) =>
            setSize({
              url: p.videoUrl,
              w: e.currentTarget.videoWidth,
              h: e.currentTarget.videoHeight,
            })
          }
          {...(p.poster ? { poster: p.poster } : {})}
        />
      )}
      <FormControlLabel
        control={
          <Checkbox checked={p.useSlider} onChange={(e) => p.onUseSlider(e.target.checked)} />
        }
        label="Use Slider"
      />
      {showSlider && slider}
      <div className="next-actions">
        {/* The actual encoded resolution, read from the video itself (fm-fy2.9: 512 is never hidden). */}
        {size && size.url === p.videoUrl && size.w > 0 && (
          <span className="next-video-format" data-next-video-width={size.w}>
            {`MP4 · ${size.w} × ${size.h}`}
          </span>
        )}
        <Button color="inherit" variant="text" onClick={p.onShare}>
          Share morph
        </Button>
        <Button color="inherit" variant="text" onClick={p.onSave}>
          Save video
        </Button>
      </div>
    </div>
  );
}
