// Morph | Blend (fm-56e6): the two modes of one session, right after the processing selector on every width. Morph
// is the default; Blend is `#blend`. Switching keeps each mode's faces (the blend slots are their own copies).
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import './mode-switch.css';

export type Mode = 'morph' | 'blend';

export function ModeSwitch({
  mode,
  onMode,
}: {
  readonly mode: Mode;
  readonly onMode: (mode: Mode) => void;
}) {
  const item = (value: Mode, label: string) => (
    <Button
      className={`next-mode-${value}`}
      variant={mode === value ? 'contained' : 'outlined'}
      aria-pressed={mode === value}
      disableElevation
      onClick={() => {
        if (mode !== value) onMode(value);
      }}
    >
      {label}
    </Button>
  );
  return (
    <div className="next-mode-row">
      <ButtonGroup className="next-mode-switch" role="group" aria-label="Mode">
        {item('morph', 'Morph')}
        {item('blend', 'Blend')}
      </ButtonGroup>
    </div>
  );
}
