// The morph slot and its settings (classic Product.fs shapeOptions .. morphSlot, lines 978-1070): Create morph,
// More options (shape, length, pinch, and the Advanced processing mode), Add face, Cancel, the reason a single
// face cannot morph, the route caption, the status line with its progress and the slow-video warning.
// Declared change: the processing mode offers Automatic, CPU and WebGPU; WebGL execution is removed.
// Buttons classic left uncoloured get color="inherit": MUI 4's default Button colour was the text colour, MUI 5+ made it primary.
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { useState } from 'react';
import {
  customFramesProblem,
  morphLengthSummary,
  targetVideoSize,
  type VideoQuality,
} from '../../src/controller/morph-options.ts';
import { FancyButton } from './FancyButton.tsx';
import { ProgressBar } from './progress.tsx';

// Smooth figure eight, pinched, is the default shape (operator, 22 September) and leads the list.
export const SHAPES = [
  ['full-smooth-figure8', 'Smooth figure eight'],
  ['full-smooth-ellipse', 'Smooth ellipse'],
  ['pairwise-figure8', 'Figure eight'],
  ['pairwise-ellipse', 'Ellipse'],
  ['linear', 'Classic linear'],
] as const;
export const LENGTHS = [
  [8, 'Length: short'],
  [16, 'Length: standard'],
  [32, 'Length: long'],
] as const;
export const PROVIDERS = [
  ['auto', 'Automatic processing'],
  ['cpu', 'CPU'],
  ['webgpu', 'WebGPU'],
] as const;
export type Shape = (typeof SHAPES)[number][0];
export type Provider = (typeof PROVIDERS)[number][0];

export function lengthLabel(frames: number): string {
  return LENGTHS.find(([value]) => value === frames)?.[1] ?? `Length: ${frames} frames`;
}

const preset = (frames: number) => LENGTHS.some(([value]) => value === frames);

export interface MorphSettings {
  readonly kind: Shape;
  readonly frames: number;
  readonly pinch: boolean;
  readonly provider: Provider;
  readonly quality?: VideoQuality;
}

export interface MorphSlotProps extends MorphSettings {
  readonly faces: number;
  readonly busy: boolean;
  /** Morph's pre-checks are answering; Create morph waits for them. */
  readonly accepting?: boolean;
  /** 'cancelling' disables Cancel. */
  readonly stage: string;
  readonly pendingMorph: boolean;
  readonly overflow: boolean;
  /** The admitted route ('' before one ran) and any route this device refused. */
  readonly route: string;
  readonly rejected?: string | undefined;
  readonly status: string;
  /** The MP4 size disclosure for the current morph; stays while frames run and beside the result. */
  readonly disclosure?: string;
  readonly fraction: number;
  /** A face (not the morph) is running: its tile shows the progress instead. */
  readonly faceActive: boolean;
  readonly preparing: string;
  readonly perFrame: string;
  readonly remaining: string;
  readonly warning?: string | undefined;
  /** Frames the morph will have, from the bridge's planner, or null when it cannot tell. */
  readonly plannedFrames: number | null;
  /** Video frame rate, for the length shown beside the frame count. */
  readonly fps?: number;
  /** The model's output size in pixels (1024 for FFHQ); Full quality never goes above it. */
  readonly modelSize?: number;
  /** Measured milliseconds per morph frame on this device, when known. */
  readonly frameMs?: number | null;
  /** The testing link was opened (shows Generate faces). */
  readonly testingInvited: boolean;
  readonly onRun: (what: 'morph' | 'faces') => void;
  readonly onCancel: () => void;
  readonly onOverflow: (open: boolean) => void;
  readonly onAddFace: () => void;
  readonly onSettings: (change: Partial<MorphSettings>) => void;
  readonly onDismissWarning: () => void;
}

interface Custom {
  /** The typed Custom frame count, or null when a preset length is chosen. */
  readonly text: string | null;
  readonly problem: string;
  readonly onText: (text: string | null) => void;
}

function Overflow(p: MorphSlotProps & { readonly custom: Custom }) {
  const custom = p.custom.text !== null;
  const total = p.plannedFrames ?? p.faces * p.frames;
  return (
    <div className="next-overflow">
      <div className="next-shape-controls">
        <label className="next-overflow-field">
          <span>Shape</span>
          <select
            aria-label="Morph shape"
            value={p.kind}
            disabled={p.busy}
            onChange={(e) => p.onSettings({ kind: e.target.value as Shape })}
          >
            {SHAPES.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="next-overflow-field">
          <span>Length</span>
          <select
            value={custom ? 'custom' : String(p.frames)}
            disabled={p.busy}
            aria-label="Morph length"
            onChange={(e) => {
              if (e.target.value === 'custom') return p.custom.onText(String(p.frames));
              p.custom.onText(null);
              p.onSettings({ frames: Number(e.target.value) });
            }}
          >
            {LENGTHS.map(([value, label]) => (
              <option
                key={value}
                value={String(value)}
              >{`${label} · ${value} frames per face`}</option>
            ))}
            <option value="custom">Custom · choose frames per face</option>
          </select>
        </label>
        {custom && (
          <label className="next-overflow-field next-custom-frames">
            <span>Frames per face</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={p.custom.text ?? ''}
              disabled={p.busy}
              aria-invalid={p.custom.problem !== ''}
              aria-describedby="next-custom-frames-note"
              onChange={(e) => p.custom.onText(e.target.value)}
            />
          </label>
        )}
        {custom && p.custom.problem !== '' ? (
          <span id="next-custom-frames-note" className="next-field-problem" role="alert">
            {p.custom.problem}
          </span>
        ) : (
          <span id="next-custom-frames-note" className="next-frame-count" aria-live="polite">
            {morphLengthSummary(total, p.fps ?? 16, p.frameMs)}
          </span>
        )}
      </div>
      {(() => {
        const full = targetVideoSize('full', p.modelSize ?? 1024);
        const standard = targetVideoSize('standard', full);
        if (full <= standard) return null; // a 512-native model has no separate Full quality
        return (
          <div className="next-shape-controls">
            <label className="next-overflow-field">
              <span>Video</span>
              <select
                value={p.quality ?? 'standard'}
                disabled={p.busy}
                aria-label="Video size"
                aria-describedby="next-video-quality-note"
                onChange={(e) => p.onSettings({ quality: e.target.value as VideoQuality })}
              >
                <option value="standard">{`Standard · ${standard} × ${standard}`}</option>
                <option value="full">{`Full quality · up to ${full} × ${full}`}</option>
              </select>
            </label>
            <span id="next-video-quality-note" className="next-frame-count">
              {(p.quality ?? 'standard') === 'full'
                ? 'Full quality takes longer and makes larger files.'
                : 'Quicker, smaller files that play everywhere.'}
            </span>
          </div>
        );
      })()}
      <FormControlLabel
        control={
          <Checkbox
            checked={p.pinch}
            disabled={p.busy}
            slotProps={{ input: { 'aria-label': 'Pinch centre' } }}
            onChange={(e) => p.onSettings({ pinch: e.target.checked })}
          />
        }
        label="Pinch centre"
      />
    </div>
  );
}

export function MorphSlot(p: MorphSlotProps) {
  // A Custom count lives here until it is valid; only a valid count reaches the settings (fm-36ag).
  const [text, setText] = useState<string | null>(null);
  const customText = text ?? (preset(p.frames) ? null : String(p.frames));
  const problem = customText === null ? '' : customFramesProblem(customText, p.faces);
  const custom: Custom = {
    text: customText,
    problem,
    onText: (next) => {
      setText(next);
      if (next !== null && !customFramesProblem(next, p.faces))
        p.onSettings({ frames: Number(next.trim()) });
    },
  };
  const twoFaces = p.faces >= 2;
  const canMorph = twoFaces && problem === '';
  const cpu = p.route === 'cpu' || p.route === 'native-cpu';
  return (
    <div className="next-morph-slot">
      <FancyButton
        variant="contained"
        size="large"
        className="next-primary-action"
        data-next-primary="true"
        type="button"
        disabled={!canMorph || p.accepting === true}
        onClick={() => p.onRun('morph')}
      >
        {p.pendingMorph ? 'Morph queued' : 'Create morph'}
      </FancyButton>
      <div className="next-actions next-generate">
        {p.testingInvited && (
          <Button
            color="inherit"
            variant="outlined"
            disabled={p.busy}
            onClick={() => p.onRun('faces')}
          >
            Generate faces
          </Button>
        )}
        <Button
          color="inherit"
          variant="text"
          aria-expanded={p.overflow}
          aria-controls="next-overflow"
          onClick={() => p.onOverflow(!p.overflow)}
        >
          More options
        </Button>
        <Button color="inherit" variant="text" onClick={p.onAddFace}>
          Add face
        </Button>
        {p.busy && (
          <Button
            color="inherit"
            variant="text"
            disabled={p.stage === 'cancelling'}
            onClick={p.onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
      {!twoFaces && (
        <p className="next-morph-reason" role="note">
          Add a second face to create a morph — a single face still generates.
        </p>
      )}
      {p.route !== '' && (
        <p className="next-route-caption" data-next-route={p.route}>
          {`Ready · ${cpu ? 'this device’s CPU' : `this device’s GPU (${p.route})`}.${p.rejected ? ` The ${p.rejected} route failed its device check on this device.` : ''}`}
        </p>
      )}
      {p.overflow && (
        <div id="next-overflow">
          <Overflow {...p} custom={custom} />
        </div>
      )}
      {/* Status, progress and the measured time remaining live next to the action they describe. */}
      <div className="next-status" role="status" aria-live="polite">
        {p.busy && (
          <progress
            className="next-sr"
            max={1}
            {...(p.fraction > 0 ? { value: p.fraction } : {})}
          />
        )}
        {p.busy && !p.faceActive && <ProgressBar fraction={p.fraction > 0 ? p.fraction : -1} />}
        <span>{p.status}</span>
        {p.disclosure && p.disclosure !== p.status && (
          <span className="next-disclosure">{p.disclosure}</span>
        )}
        {!p.busy && p.preparing !== '' && <span className="next-preparing">{p.preparing}</span>}
        {p.busy && p.perFrame !== '' && <span className="next-remaining">{p.perFrame}</span>}
        {p.busy && p.remaining !== '' && <span className="next-remaining">{p.remaining}</span>}
      </div>
      {/* The slow-video warning names the measured estimate, never blocks, and can be dismissed (U-12). */}
      {p.warning && (
        <div className="next-slow-warning box" role="note">
          <p>{p.warning}</p>
          <Button color="inherit" variant="text" onClick={p.onDismissWarning}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
