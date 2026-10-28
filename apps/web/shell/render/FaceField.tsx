// The per-face field (classic Product.fs setpointField, lines 799-865): one outlined, centre-aligned text field
// with a mode menu at the start and, at the end, Encode image (photo). Browse names is an entry of that face's own
// mode menu (the burger), which Tab reaches; the declared change from the field adornment (PLAN.md, fm-5kpx).
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
import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
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
  readonly onRequestCrop?: () => void;
  readonly onRun?: () => void;
  readonly canRun?: boolean;
  readonly onPhoto?: (files: File[]) => void;
  readonly onNotice?: (message: string) => void;
  readonly photoEncodingAvailable?: boolean;
}

/** Image clipboard data wins over coincident text and enters the same dispatch as the chooser. */
export function pastedPhoto(
  e: ClipboardEvent,
  onPhoto?: (files: File[]) => void,
  onNotice?: (message: string) => void,
) {
  const files = [...e.clipboardData.items].filter((item) => item.kind === 'file');
  if (!files.length) return;
  e.preventDefault();
  if (files.length !== 1 || !/^image\/(png|jpeg|webp)$/.test(files[0]!.type)) {
    onNotice?.('Paste one PNG, JPEG or WebP image. Your text is unchanged.');
    return;
  }
  const file = files[0]!.getAsFile();
  if (file) onPhoto?.([file]);
}

export function FaceField({
  item,
  label,
  disabled,
  onEdit,
  onMode,
  onBrowse,
  onPick,
  onRequestCrop,
  onRun,
  canRun = false,
  onPhoto,
  onNotice,
  photoEncodingAvailable = true,
}: FaceFieldProps) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null); // the start adornment the menu opens from
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement | null>(null);
  // Choosing Encode image opens this card's file chooser without replacing the existing face.
  const entry = (kind: FaceMode, icon: ReactNode, text: string) => (
    <MenuItem
      selected={item.mode === kind}
      onClick={() => {
        setOpen(false);
        if (kind === 'photo') {
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
    ) : (
      <InputAdornment position="end">
        <></>
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
        <MenuItem
          onClick={() => {
            setOpen(false);
            // The names dialog returns focus to what had it when it opened: this face's burger, once the menu
            // has closed and released its focus trap.
            requestAnimationFrame(() => {
              burger.current?.focus();
              onBrowse();
            });
          }}
        >
          <ListItemIcon>
            <ImageSearchIcon />
          </ListItemIcon>
          <ListItemText>Browse names</ListItemText>
        </MenuItem>
        {item.mode === 'photo' && item.file && onRequestCrop && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRequestCrop();
            }}
          >
            Crop photo
          </MenuItem>
        )}
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
            // Only Enter in the text itself runs Generate; Enter on the burger opens its menu.
            if (
              e.key === 'Enter' &&
              e.target instanceof HTMLInputElement &&
              !e.repeat &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229 &&
              canRun
            ) {
              e.preventDefault();
              onRun?.();
            }
          }}
          onPaste={(e) => pastedPhoto(e, onPhoto, onNotice)}
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
                      ref={burger}
                      className="next-adornment"
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
