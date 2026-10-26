// Prepared result controls (fm-qh1s). File preparation is separate from the click
// gesture: the adapter hands an already prepared file to Save or the system share sheet.
import Button from '@mui/material/Button';
import { useEffect, useRef, useState } from 'react';

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

export function ResultActions({
  kind,
  state,
  files,
  onNotice,
  resolution,
}: {
  readonly kind: 'image' | 'video';
  readonly state: ResultFileState;
  readonly files: ResultFiles;
  readonly onNotice?: ((message: string) => void) | undefined;
  readonly resolution?: { readonly width: number; readonly height: number } | undefined;
}) {
  const [edit, setEdit] = useState<{ digest: string; name: string }>();
  const file = state.file;
  const name = edit?.digest === file?.digest ? (edit?.name ?? '') : (file?.filename ?? '');
  const ready = state.status === 'ready' && !!file;
  const share = file
    ? canShare(file)
    : typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
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
  return (
    <>
      {share && (
        <Button
          color="inherit"
          variant={share ? 'contained' : 'text'}
          disabled={!ready}
          onClick={() => hand(true)}
        >
          {kind === 'image' ? 'Share image' : 'Share morph'}
        </Button>
      )}
      <Button
        color="inherit"
        variant={share ? 'text' : 'contained'}
        disabled={!ready}
        onClick={() => hand(false)}
      >
        {kind === 'image' ? 'Save image' : 'Save video'}
      </Button>
      {kind === 'image' ? (
        <label className="next-result-format">
          Format{' '}
          <select
            aria-label="Image format"
            value={file?.mime === 'image/png' ? 'png' : state.format}
            onChange={(event) => {
              const format = event.target.value as StillFormat;
              if (format === state.format) state.retry();
              else state.setFormat(format);
            }}
          >
            <option value="webp">WebP</option>
            <option value="png">PNG (lossless)</option>
          </select>
        </label>
      ) : (
        <span className="next-video-format" data-next-video-width={resolution?.width}>
          MP4{resolution ? ` · ${resolution.width} × ${resolution.height}` : ''}
        </span>
      )}
      <label
        className="next-result-filename"
        style={{ minWidth: 0, flex: '1 1 100%', maxWidth: '100%' }}
      >
        Filename{' '}
        <input
          aria-label={kind === 'image' ? 'Image filename' : 'Video filename'}
          value={name}
          disabled={!ready}
          style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
          onChange={(event) => file && setEdit({ digest: file.digest, name: event.target.value })}
          onBlur={() => {
            const named = state.rename(name);
            if (named) setEdit({ digest: named.digest, name: named.filename });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <span className="next-result-format-help" style={{ flexBasis: '100%', fontSize: '.8rem' }}>
        {kind === 'image'
          ? 'Includes editable face data'
          : 'Video; reopening this file as a project is not available in this release.'}
      </span>
      {state.status === 'preparing' && <span role="status">Preparing file…</span>}
      {state.status === 'failed' && (
        <span role="alert">The file could not be prepared. Your result is still here.</span>
      )}
    </>
  );
}
