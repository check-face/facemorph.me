// The per-face field (classic Product.fs setpointField, lines 799-865): one outlined, centre-aligned text field
// with a mode menu at the start and, at the end, Browse names (words) or Choose another photo (photo).
import DialpadIcon from '@mui/icons-material/Dialpad';
import ImageSearchIcon from '@mui/icons-material/ImageSearch';
import MenuIcon from '@mui/icons-material/Menu';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import RefreshIcon from '@mui/icons-material/Refresh';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useState, type ReactNode } from 'react';
import type { FaceMode, Input } from './types.ts';
import { faceInputProblem } from '../../src/controller/derived.ts';

export interface FaceFieldProps {
  readonly item: Input;
  readonly label: string;
  readonly disabled: boolean;
  readonly onEdit: (value: string) => void;
  readonly onMode: (mode: FaceMode) => void;
  readonly onBrowse: () => void;
  readonly onPick: () => void;
  readonly onRun?: () => void;
  readonly canRun?: boolean;
  readonly onPhoto?: (files: File[]) => void;
  readonly onNotice?: (message: string) => void;
  readonly photoEncodingAvailable?: boolean;
  /** Warms the photo tools when a person reaches for a photo (classic warmPhotoTools). */
  readonly onWarmPhotoTools?: () => void;
}

export function FaceField({
  item,
  label,
  disabled,
  onEdit,
  onMode,
  onBrowse,
  onPick,
  onRun,
  canRun = false,
  onPhoto,
  onNotice,
  photoEncodingAvailable = true,
  onWarmPhotoTools,
}: FaceFieldProps) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null); // the start adornment the menu opens from
  const [open, setOpen] = useState(false);
  // Choosing Encode image opens the picker without replacing the existing face.
  const entry = (kind: FaceMode, icon: ReactNode, text: string) => (
    <MenuItem
      selected={item.mode === kind}
      onClick={() => {
        setOpen(false);
        if (kind === 'photo') {
          onWarmPhotoTools?.();
          onPick();
        } else onMode(kind);
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{text}</ListItemText>
    </MenuItem>
  );
  const end =
    item.mode === 'photo' ? (
      <InputAdornment position="end">
        <Tooltip title={photoEncodingAvailable ? 'Encode image' : 'Open saved image'}>
          <IconButton
            className="next-adornment"
            tabIndex={-1}
            aria-label={photoEncodingAvailable ? 'Encode image' : 'Open saved image'}
            edge="end"
            onClick={onPick}
          >
            <PhotoCameraIcon />
          </IconButton>
        </Tooltip>
      </InputAdornment>
    ) : item.mode === 'seed' ? (
      <InputAdornment position="end">
        <></>
      </InputAdornment>
    ) : (
      <InputAdornment position="end">
        <Tooltip title="Browse names">
          <IconButton
            className="next-adornment"
            tabIndex={-1}
            aria-label="Browse names"
            edge="end"
            onClick={onBrowse}
          >
            <ImageSearchIcon />
          </IconButton>
        </Tooltip>
      </InputAdornment>
    );
  const placeholder =
    item.mode === 'project' ? '' : item.mode === 'seed' ? '0 to 4294967295' : 'Just type anything';
  const problem = faceInputProblem(item);
  return (
    <>
      <Menu anchorEl={anchor} keepMounted open={open} onClose={() => setOpen(false)}>
        {entry('text', <TextFieldsIcon />, 'Name or words')}
        {entry('seed', <DialpadIcon />, 'Numeric seed')}
        {entry(
          'photo',
          <PhotoCameraIcon />,
          photoEncodingAvailable ? 'Encode image' : 'Open saved image',
        )}
        {item.mode === 'project' && entry('project', <RefreshIcon />, 'Restored face')}
      </Menu>
      <div className="next-field">
        <TextField
          value={
            item.mode === 'photo' ? (item.file instanceof File ? item.file.name : '') : item.value
          }
          placeholder={placeholder}
          disabled={disabled || item.mode === 'photo' || item.mode === 'project'}
          variant="outlined"
          label={label}
          onChange={(e) => onEdit(e.target.value)}
          error={problem !== null}
          helperText={problem}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.repeat &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229 &&
              canRun
            ) {
              e.preventDefault();
              onRun?.();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.items].filter((item) => item.kind === 'file');
            if (!files.length) return;
            e.preventDefault();
            if (files.length !== 1 || !/^image\/(png|jpeg|webp)$/.test(files[0]!.type)) {
              onNotice?.('Paste one PNG, JPEG or WebP image. Your text is unchanged.');
              return;
            }
            const file = files[0]!.getAsFile();
            if (file) onPhoto?.([file]);
          }}
          className="focuswithin-parent"
          slotProps={{
            htmlInput: {
              style: { textAlign: 'center' },
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
              ...(item.mode === 'seed' ? { inputMode: 'numeric' as const } : {}),
            },
            input: {
              startAdornment: (
                <InputAdornment position="start" ref={setAnchor}>
                  <Tooltip title="Change mode">
                    <IconButton
                      className="next-adornment"
                      tabIndex={-1}
                      aria-label="Change mode"
                      edge="start"
                      onClick={() => setOpen(true)}
                    >
                      <MenuIcon />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
              endAdornment: end,
            },
          }}
        />
      </div>
    </>
  );
}
