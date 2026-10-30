// Prepared result controls (fm-qh1s). File preparation is separate from the click
// gesture: the adapter hands an already prepared file to Save or the system share sheet.
// Layout (fm-7u7z): one row — Save with its format on the button, Share beside it when the browser can
// share — and the filename as quiet text underneath that becomes an inline field when tapped.
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useEffect, useId, useRef, useState } from 'react';
import './result-actions.css';

export type StillFormat = 'webp' | 'png';
export interface PreparedResult {
  readonly blob: Blob;
  readonly filename: string;
  readonly mime: string;
  readonly digest: string;
}
export interface ResultFiles {
  readonly prepare: (format: StillFormat) => Promise<PreparedResult>;
  readonly rename: (file: PreparedResult, name: string) => PreparedResult;
  readonly save: (file: PreparedResult) => Promise<string>;
  readonly share: (file: PreparedResult) => Promise<string>;
}
interface FileState {
  readonly source: unknown;
  readonly format: StillFormat;
  readonly attempt: number;
  readonly file?: PreparedResult;
  readonly error?: string;
}

/** Source is the result identity, independent of unrelated controller progress. */
export function useResultFile(source: unknown, files: ResultFiles | undefined) {
  const [format, setFormat] = useState<StillFormat>('webp');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FileState>();
  // Drop the previous result's bytes when the slot is emptied or replaced.
  if (state && state.source !== source) setState(undefined);
  const api = useRef(files);
  useEffect(() => {
    api.current = files;
  }, [files]);
  const enabled = files !== undefined;
  const pending = useRef<
    | {
        source: unknown;
        format: StillFormat;
        attempt: number;
        work: Promise<PreparedResult>;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (source === null || !api.current) {
      pending.current = undefined;
      return;
    }
    let current = true;
    // React's effect replay joins the same preparation instead of encoding twice.
    let request = pending.current;
    if (
      !request ||
      request.source !== source ||
      request.format !== format ||
      request.attempt !== attempt
    ) {
      const adapter = api.current;
      request = {
        source,
        format,
        attempt,
        work: Promise.resolve().then(() => adapter.prepare(format)),
      };
      pending.current = request;
    }
    void request.work.then(
      (file) => {
        if (current) setState({ source, format, attempt, file });
      },
      (error: unknown) => {
        if (current)
          setState({
            source,
            format,
            attempt,
            error:
              error instanceof Error ? error.message : 'The file could not be prepared. Try again.',
          });
      },
    );
    return () => {
      current = false;
    };
  }, [source, format, attempt, enabled]);
  const current =
    state && state.source === source && state.format === format && state.attempt === attempt
      ? state
      : undefined;
  const status =
    source === null || !files
      ? 'idle'
      : current?.file
        ? 'ready'
        : current?.error
          ? 'failed'
          : 'preparing';
  return {
    status,
    file: current?.file,
    error: current?.error,
    format,
    setFormat,
    retry: () => setAttempt((value) => value + 1),
    rename: (name: string) => {
      if (!current?.file || !api.current) return;
      const file = api.current.rename(current.file, name);
      setState({ source, format, attempt, file });
      return file;
    },
  };
}
export type ResultFileState = ReturnType<typeof useResultFile>;

function canShare(file: PreparedResult | undefined): boolean {
  if (!file || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({
      files: [new File([file.blob], file.filename, { type: file.mime })],
    });
  } catch {
    return false;
  }
}

const FORMATS: readonly {
  readonly value: StillFormat;
  readonly name: string;
  readonly note: string;
}[] = [
  { value: 'webp', name: 'WebP', note: 'smaller' },
  { value: 'png', name: 'PNG', note: 'lossless' },
];

export function ResultActions({
  kind,
  state,
  files,
  onNotice,
  resolution,
  inlineRetry = false,
}: {
  readonly kind: 'image' | 'video';
  readonly state: ResultFileState;
  readonly files: ResultFiles;
  readonly onNotice?: ((message: string) => void) | undefined;
  readonly resolution?: { readonly width: number; readonly height: number } | undefined;
  /** Show Retry in this row on failure; the face tile keeps its own Retry in the operation slot. */
  readonly inlineRetry?: boolean;
}) {
  const [edit, setEdit] = useState<{ digest: string; name: string }>();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const cancelled = useRef(false);
  const menuId = useId();
  const file = state.file;
  const name = edit?.digest === file?.digest ? (edit?.name ?? '') : (file?.filename ?? '');
  const ready = state.status === 'ready' && !!file;
  const preparing = state.status === 'preparing';
  const share = file
    ? canShare(file)
    : typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  const format = file?.mime === 'image/png' ? 'png' : state.format;
  const formatName = FORMATS.find((f) => f.value === format)?.name ?? 'WebP';
  const hand = (sharing: boolean) => {
    if (!ready) return;
    const failed = () =>
      onNotice?.('The file could not be handed over. Your result is still ready; try Save.');
    try {
      const named = state.rename(name) ?? file;
      setEdit({ digest: named.digest, name: named.filename });
      // No await before the adapter's share call: user activation belongs to this click.
      void (sharing ? files.share(named) : files.save(named)).then(onNotice, failed);
    } catch {
      failed();
    }
  };
  const choose = (next: StillFormat) => {
    setMenu(null);
    if (next !== state.format) state.setFormat(next);
    else if (state.status === 'failed') state.retry();
  };
  const noun = kind === 'image' ? 'image' : 'video';
  // The accessible name stays "Save image" / "Save video" through preparation; only the visible label
  // carries the state, so the control a person or test is holding never changes identity.
  const saveLabel = (
    <>
      {preparing ? (
        <span aria-hidden="true">Saving…</span>
      ) : kind === 'image' ? (
        'Save'
      ) : (
        'Save video'
      )}
      {(preparing || kind === 'image') && (
        <span className="next-sr">{preparing ? `Save ${noun}` : ' image'}</span>
      )}
    </>
  );
  return (
    <div className="next-result-actions" data-next-result-status={state.status}>
      <div className="next-result-row">
        {kind === 'image' ? (
          <ButtonGroup
            variant="contained"
            disableElevation
            className="next-result-save"
            aria-label="Save"
          >
            <Button disabled={!ready} onClick={() => hand(false)}>
              {saveLabel}
            </Button>
            <Button
              className="next-result-format"
              aria-label={`Image format: ${formatName}`}
              aria-haspopup="menu"
              aria-expanded={menu ? 'true' : undefined}
              aria-controls={menu ? menuId : undefined}
              disabled={state.status === 'idle'}
              onClick={(event) => setMenu(event.currentTarget)}
            >
              {formatName}
              <ArrowDropDownIcon fontSize="small" aria-hidden="true" />
            </Button>
          </ButtonGroup>
        ) : (
          <Button
            variant="contained"
            disableElevation
            className="next-result-save"
            disabled={!ready}
            onClick={() => hand(false)}
          >
            {saveLabel}
          </Button>
        )}
        {share && (
          <Button
            color="inherit"
            variant="outlined"
            className="next-result-share"
            disabled={!ready}
            onClick={() => hand(true)}
          >
            Share<span className="next-sr">{kind === 'image' ? ' image' : ' morph'}</span>
          </Button>
        )}
        {kind === 'video' && (
          <span className="next-video-format" data-next-video-width={resolution?.width}>
            MP4{resolution ? ` · ${resolution.width} × ${resolution.height}` : ''}
          </span>
        )}
        {state.status === 'failed' && (
          <span className="next-result-failed">
            <span role="alert">Couldn’t prepare the file.</span>
            {inlineRetry && (
              <Button
                size="small"
                color="inherit"
                aria-label="Retry file preparation"
                onClick={state.retry}
              >
                Retry
              </Button>
            )}
          </span>
        )}
      </div>
      {kind === 'image' && (
        <Menu
          id={menuId}
          anchorEl={menu}
          open={!!menu}
          onClose={() => setMenu(null)}
          slotProps={{ list: { 'aria-label': 'Image format', dense: true } }}
          className="next-result-format-menu"
        >
          {FORMATS.map((f) => (
            <MenuItem key={f.value} selected={f.value === format} onClick={() => choose(f.value)}>
              <span className="next-result-format-name">{f.name}</span>
              <span className="next-result-format-note">{f.note}</span>
            </MenuItem>
          ))}
        </Menu>
      )}
      <label className="next-result-filename" data-next-ready={ready ? 'true' : undefined}>
        <input
          aria-label={kind === 'image' ? 'Image filename' : 'Video filename'}
          value={name}
          disabled={!ready}
          spellCheck={false}
          autoComplete="off"
          size={Math.max(8, Math.min(name.length + 1, 64))}
          onChange={(event) => file && setEdit({ digest: file.digest, name: event.target.value })}
          onBlur={() => {
            if (cancelled.current) {
              cancelled.current = false;
              if (file) setEdit({ digest: file.digest, name: file.filename });
              return;
            }
            const named = state.rename(name);
            if (named) setEdit({ digest: named.digest, name: named.filename });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        <EditOutlinedIcon className="next-result-filename-pencil" aria-hidden="true" />
      </label>
    </div>
  );
}
