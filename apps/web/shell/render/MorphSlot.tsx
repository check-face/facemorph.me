// The morph slot and its settings (classic Product.fs shapeOptions .. morphSlot, lines 978-1070): Create morph,
// More options (shape, length, pinch, and the Advanced processing mode), Add face, Cancel, the reason a single
// face cannot morph, the route caption, the status line with its progress and the slow-video warning.
// Declared change: the processing mode offers Automatic, CPU and WebGPU; WebGL execution is removed.
// Buttons classic left uncoloured get color="inherit": MUI 4's default Button colour was the text colour, MUI 5+ made it primary.
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
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

export interface MorphSettings {
  readonly kind: Shape;
  readonly frames: number;
  readonly pinch: boolean;
  readonly provider: Provider;
}

export interface MorphSlotProps extends MorphSettings {
  readonly faces: number;
  readonly busy: boolean;
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
  /** The testing link was opened (shows Generate faces). */
  readonly testingInvited: boolean;
  readonly onRun: (what: 'morph' | 'faces') => void;
  readonly onCancel: () => void;
  readonly onOverflow: (open: boolean) => void;
  readonly onAddFace: () => void;
  readonly onSettings: (change: Partial<MorphSettings>) => void;
  readonly onDismissWarning: () => void;
}

function Overflow(p: MorphSlotProps) {
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
            value={String(p.frames)}
            disabled={p.busy}
            aria-label="Morph length"
            onChange={(e) => p.onSettings({ frames: Number(e.target.value) })}
          >
            {LENGTHS.map(([value, label]) => (
              <option
                key={value}
                value={String(value)}
              >{`${label} · ${value} frames per segment`}</option>
            ))}
          </select>
        </label>
        <span className="next-frame-count">{`${p.plannedFrames ?? p.faces * p.frames} frames total`}</span>
      </div>
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
      <details className="next-advanced">
        <summary>Advanced</summary>
        <label className="next-overflow-field">
          <span>Processing mode</span>
          <select
            value={p.provider}
            disabled={p.busy}
            aria-label="Processing mode"
            onChange={(e) => p.onSettings({ provider: e.target.value as Provider })}
          >
            {PROVIDERS.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <p>
          Leave processing on automatic unless you are comparing routes. Forced routes still need to
          pass this device’s checks.
        </p>
      </details>
    </div>
  );
}

export function MorphSlot(p: MorphSlotProps) {
  const canMorph = p.faces >= 2;
  const cpu = p.route === 'cpu' || p.route === 'native-cpu';
  return (
    <div className="next-morph-slot">
      <FancyButton
        variant="contained"
        size="large"
        className="next-primary-action"
        data-next-primary="true"
        type="button"
        disabled={!canMorph}
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
        <Button
          color="inherit"
          variant="text"
          disabled={!canMorph || p.faces >= 64}
          onClick={p.onAddFace}
        >
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
      {!canMorph && (
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
          <Overflow {...p} />
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
