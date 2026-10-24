// The tile action table: one TileActionState variant per row, each allowing only its own commands, so an
// action a state does not offer cannot be written (the commands are part of the variant's type).

export type TileCommand = 'generate' | 'cancel' | 'retry' | 'encode-image' | 'retry-file-preparation' | 'result-actions';

interface Row<S extends string, C extends TileCommand> {
  readonly state: S;
  readonly commands: readonly C[];
}

export type TileActionState =
  /** Empty or invalid input: nothing to generate. */
  | Row<'empty-or-invalid', never>
  /** Valid input with no finished result. */
  | (Row<'ready', 'generate'> & { readonly attemptId?: never })
  /** A verified result: its result actions (Save, Share, Morph...). */
  | (Row<'verified-result', 'result-actions'> & { readonly resultRevision: number })
  /** A static (names picker) selection whose result is still loading. */
  | Row<'static-selection-pending', 'retry'>
  | (Row<'queued', 'cancel'> & { readonly attemptId: string })
  | (Row<'active', 'cancel'> & { readonly attemptId: string })
  /** Non-preemptible work stopping: Cancel shows as disabled "Cancelling". */
  | (Row<'cancelling', never> & { readonly attemptId: string })
  /** Failed or cancelled with its pixels retained: Retry makes a new attempt ID. */
  | (Row<'failed-retryable', 'retry'> & { readonly retryPixels: true })
  /** The retry pixels are gone: the photo has to be encoded again. */
  | (Row<'retry-pixels-lost', 'encode-image'> & { readonly retryPixels: false })
  /** Pixels ready, file being prepared or failed: Preparing file, or file-preparation Retry. */
  | (Row<'file-pending', never> & { readonly resultRevision: number })
  | (Row<'file-failed', 'retry-file-preparation'> & { readonly resultRevision: number });

export type TileState = TileActionState['state'];
export type CommandsOf<S extends TileState> = Extract<TileActionState, { state: S }>['commands'][number];

/** Keyboard behaviour, as properties of the tile rather than ad-hoc handlers. */
export interface TileKeyboard {
  /** Enter in the text field runs the tile's primary command when it has one. */
  readonly enterRunsPrimary: true;
  /** While an IME composition is active, Enter commits the composition and runs nothing. */
  readonly enterDuringCompositionIgnored: true;
}

/** Whether `command` is allowed in `state` (the runtime mirror of the type). */
export function allows(state: TileActionState, command: TileCommand): boolean {
  return (state.commands as readonly TileCommand[]).includes(command);
}
