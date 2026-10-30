// The video slot and classic's slider (Product.fs nextSlider and videoSlot, lines 1071-1124). One result at a
// time: the slider replaces the video and the video the slider. The slider's position is the caller's state, so
// a visitor who scrubbed, unticked Use Slider and came back finds the same frame; frames not yet stored say so.
// Buttons classic left uncoloured get color="inherit": MUI 4's default Button colour was the text colour, MUI 5+ made it primary.
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import { useEffect, useRef, useState } from 'react';
import { ResultActions, useResultFile, type ResultFiles } from './ResultActions.tsx';

/** The scrubbed frame, drawn in the video's own box (fm-2if3); its rail is {@link MorphRail}, under Use Slider. */
export function MorphSlider({
  frames,
  dim,
  frame,
}: {
  frames: readonly string[];
  dim: number;
  frame: number;
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
        // The video's box: the slot's width up to 512 px, square, so swapping the two moves nothing.
        style={{ display: 'block', width: '100%', height: 'auto' }}
        aria-label="Morph preview, frame by frame"
        role="img"
      />
    </div>
  );
}

/** The slider's rail, below Use Slider, so ticking it adds the rail without moving the picture or the checkbox. */
export function MorphRail({
  frames,
  frame,
  onFrame,
}: {
  frames: readonly string[];
  frame: number;
  onFrame: (n: number) => void;
}) {
  return (
    <Slider
      min={1}
      max={frames.length}
      value={Math.max(1, Math.min(frame, frames.length))}
      onChange={(_, v) => onFrame(Array.isArray(v) ? (v[0] ?? 1) : v)}
      aria-label="Morph frame"
      className="next-slider-control"
      sx={{ width: '100%', maxWidth: 512 }}
    />
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
  readonly resultFiles?: ResultFiles | undefined;
  readonly onNotice?: ((message: string) => void) | undefined;
  readonly disclosure?: string | undefined;
}

export function VideoSlot(p: VideoSlotProps) {
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null);
  const resultFile = useResultFile(p.videoUrl || null, p.resultFiles);
  useEffect(() => {
    if (!p.videoUrl) return;
    // Read metadata even when the person has kept Use Slider selected. No playback.
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      setSize({ url: p.videoUrl, w: video.videoWidth, h: video.videoHeight });
    video.src = p.videoUrl;
    return () => {
      video.onloadedmetadata = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [p.videoUrl]);
  if (p.videoUrl === '') return <div className="next-video-slot" />;
  const frames = p.sliderFrames ?? [];
  const framesAvailable = frames.length > 0;
  // A restored video remains playable when its optional scrub frames were evicted.
  const showSlider = framesAvailable && (p.useSlider || p.busy);
  const slider = showSlider ? (
    <MorphSlider frames={frames} dim={p.videoDim} frame={p.sliderFrame} />
  ) : null;
  return (
    <div className="next-video-slot">
      {/* The slider's frame takes the video's place and box, above Use Slider, and its rail goes below the checkbox,
          so ticking Use Slider moves neither the picture nor the checkbox (fm-2if3). */}
      {showSlider ? (
        slider
      ) : (
        <video
          src={p.videoUrl}
          controls
          loop
          playsInline
          aria-label="Your morph"
          className="next-video"
          // Its box is the morph's shape from the first paint (frames are square), so it never grows when the
          // metadata arrives and pushes Use Slider away from where it was drawn.
          style={{
            aspectRatio:
              size && size.url === p.videoUrl && size.w > 0 ? `${size.w} / ${size.h}` : '1 / 1',
          }}
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
          <Checkbox
            checked={showSlider}
            disabled={!framesAvailable}
            onChange={(e) => p.onUseSlider(e.target.checked)}
          />
        }
        label="Use Slider"
      />
      {showSlider && <MorphRail frames={frames} frame={p.sliderFrame} onFrame={p.onSliderFrame} />}
      {p.useSlider && !framesAvailable && (
        <p className="next-slider-empty" role="note">
          The scrub frames are not saved here. Your video is ready to play.
        </p>
      )}
      {p.disclosure && <p className="next-video-disclosure">{p.disclosure}</p>}
      <div className="next-actions">
        {/* The actual encoded resolution, read from the video itself (fm-fy2.9: 512 is never hidden). */}
        {!p.resultFiles && size && size.url === p.videoUrl && size.w > 0 && (
          <span className="next-video-format" data-next-video-width={size.w}>
            {`MP4 · ${size.w} × ${size.h}`}
          </span>
        )}
        {p.resultFiles ? (
          <>
            <ResultActions
              kind="video"
              state={resultFile}
              files={p.resultFiles}
              onNotice={p.onNotice}
              resolution={
                size?.url === p.videoUrl && size.w > 0
                  ? { width: size.w, height: size.h }
                  : undefined
              }
              inlineRetry
            />
          </>
        ) : (
          <>
            <Button color="inherit" variant="text" onClick={p.onShare}>
              Share morph
            </Button>
            <Button color="inherit" variant="text" onClick={p.onSave}>
              Save video
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
