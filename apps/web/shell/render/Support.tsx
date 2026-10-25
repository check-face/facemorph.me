import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import type { ReactNode } from 'react';
import { msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import { testingInvited } from '../../src/controller/init.ts';
import { megabytes, type Dispatch } from './Dialogs.tsx';
import { Explain } from './Explain.tsx';

interface Props {
  readonly state: State;
  readonly dispatch: Dispatch;
  readonly stagedReports: number;
  readonly reference: string;
}

export function TestingInvite({
  state,
  dispatch,
  url,
}: Pick<Props, 'state' | 'dispatch'> & { url: string }) {
  if (!testingInvited(new URL(url)) || !state.Invite || state.Debug) return null;
  return (
    <section className="next-invite box" role="region" aria-label="Help us with this test">
      <h2>Thanks for testing FaceMorph</h2>
      <p>
        If anything is slow, wrong or broken, a debug report tells us what happened without you
        having to describe it.
      </p>
      <p>
        Reports contain a random device ID, app and browser versions, processing stages, timings and
        safe error codes. They never contain your photos, the words you type, the faces you make, or
        anything identifying you. They go to our private diagnostics service and are deleted after
        30 days.
      </p>
      <div className="next-actions">
        <Button variant="contained" onClick={() => dispatch(msg('Consent', true, 'invite'))}>
          Turn on debug reporting
        </Button>
        <Button onClick={() => dispatch(msg('DismissInvite'))}>Not now</Button>
      </div>
      <p className="next-invite-note">
        You can turn it off at any time in the testing area below. Generating works exactly the same
        either way.
      </p>
    </section>
  );
}

export function ErrorBox({ state, dispatch, stagedReports, reference }: Props) {
  if (state.Error === null) return null;
  return (
    <div className="next-error box" role="alert">
      <p>{state.Error}</p>
      {reference && (
        <p className="next-error-reference" role="note">
          Report reference: {reference}
        </p>
      )}
      <div className="next-actions">
        {!state.Debug && stagedReports > 0 && (
          <Button onClick={() => dispatch(msg('SendReportOnce'))}>Send this report</Button>
        )}
        {state.LastRun && (
          <Button className="next-error-retry" onClick={() => dispatch(msg('Retry'))}>
            Try again
          </Button>
        )}
        <Button onClick={() => dispatch(msg('DismissError'))}>Dismiss</Button>
      </div>
      <p className="next-error-classic">
        <a href="https://facemorph.me">Use classic FaceMorph</a> while we fix this.
      </p>
    </div>
  );
}

export function DebugArea({ state, dispatch, stagedReports }: Omit<Props, 'reference'>) {
  return (
    <section className="next-debug box" role="region" aria-label="For testing">
      <h2>For testing</h2>
      <label className="next-debug-report">
        <Checkbox
          checked={state.Debug}
          onChange={(_, checked) => dispatch(msg('Debug', checked))}
        />
        <span>Send debug reports until I turn this off</span>
      </label>
      <p role="status">{state.DebugStatus}</p>
      {stagedReports > 0 && !state.Debug && (
        <p>{stagedReports} staged report(s) from this session are ready to send if you agree.</p>
      )}
      <p>
        <a href="mailto:checkfaceml@gmail.com">Email us</a>
      </p>
    </section>
  );
}

/** Exactly one toast. Modal acquisition has priority; a one-shot report never grants standing consent. */
export function Toasts({ state, dispatch }: Pick<Props, 'state' | 'dispatch'>) {
  const downloads = state.Downloads;
  const photoOffer = downloads.photoAvailable && !downloads.photoReady;
  const model =
    !state.ModelToastHidden &&
    downloads.known &&
    ((downloads.phase === 'idle' && !downloads.routeReady) ||
      ['downloading', 'waiting', 'failed', 'done'].includes(downloads.phase));
  const failure = state.FailureToast && !state.Debug && state.Error !== null;
  let content: ReactNode = null;
  let actions: ReactNode = null;
  let kind = '';
  if (state.Gate) return null;
  if (model) {
    kind = 'next-model-toast';
    switch (downloads.phase) {
      case 'downloading':
        content = (
          <>
            <span>
              <strong>
                {downloads.scope === 'photo'
                  ? 'Downloading the photo encoder… '
                  : 'Downloading the face model… '}
              </strong>
              {megabytes(downloads.loaded)} of {megabytes(downloads.total)}
            </span>
            <LinearProgress
              variant="determinate"
              value={
                downloads.total > 0 ? Math.min(100, (downloads.loaded / downloads.total) * 100) : 0
              }
              className="next-model-progress"
              aria-label="Model download progress"
            />
          </>
        );
        break;
      case 'waiting':
        content = (
          <span>
            <strong>Download paused. </strong>It picks up again once this face is done.
          </span>
        );
        break;
      case 'failed':
        content = (
          <span>
            <strong>The download stopped. </strong>Check your connection or free up some space, then
            try again. Anything already downloaded is kept.
          </span>
        );
        break;
      case 'done':
        content = (
          <span>
            <strong>Ready. </strong>The models are saved on this device, so you won’t download them
            again.
          </span>
        );
        break;
      default:
        content = (
          <span>
            <strong>Faces are made on this device.</strong> It needs the face model once (
            {megabytes(downloads.routeBytes)})
            {photoOffer
              ? `, and using your own photos needs the photo encoder (${megabytes(downloads.photoBytes)})`
              : ''}
            . It stays on this device; your browser may ask whether to keep it.
          </span>
        );
    }
    actions = ['downloading', 'waiting', 'done'].includes(downloads.phase) ? (
      <Button color="inherit" onClick={() => dispatch(msg('HideModelToast'))}>
        Hide
      </Button>
    ) : (
      <>
        {downloads.phase === 'failed' ? (
          <Button color="inherit" onClick={() => dispatch(msg('DownloadNow', photoOffer))}>
            Try again
          </Button>
        ) : (
          <>
            <Button
              color="inherit"
              variant="outlined"
              onClick={() => dispatch(msg('DownloadNow', false))}
            >
              Download · {megabytes(downloads.routeBytes)}
            </Button>
            {photoOffer && (
              <Button color="inherit" onClick={() => dispatch(msg('DownloadNow', true))}>
                Plus photo encoder · {megabytes(downloads.routeBytes + downloads.photoBytes)}
              </Button>
            )}
          </>
        )}
        <Button color="inherit" onClick={() => dispatch(msg('HideModelToast'))}>
          Not now
        </Button>
      </>
    );
  } else if (failure) {
    kind = 'next-failure-toast';
    content = (
      <span>
        <strong>Something went wrong.</strong> Send a debug report so we can fix it? Timings, device
        type and error codes only. Never your photos, words or faces. Deleted after 30 days.
      </span>
    );
    actions = (
      <>
        <Button
          color="inherit"
          onClick={() => {
            dispatch(msg('SendReportOnce'));
            dispatch(msg('DismissFailureToast'));
          }}
        >
          Send report
        </Button>
        <Button color="inherit" onClick={() => dispatch(msg('DismissFailureToast'))}>
          Not now
        </Button>
      </>
    );
  } else if (state.ConsentPrompt) {
    content = (
      <span>
        <strong>Help us test?</strong> Send debug reports: timings, device type and error codes.
        Never your photos, words or faces. Deleted after 30 days.
      </span>
    );
    actions = (
      <>
        <Button color="inherit" onClick={() => dispatch(msg('Consent', true, 'toast'))}>
          Turn on
        </Button>
        <Button color="inherit" onClick={() => dispatch(msg('Consent', false, 'toast'))}>
          No thanks
        </Button>
        <IconButton
          color="inherit"
          size="small"
          aria-label="Ask me later"
          onClick={() => dispatch(msg('DismissConsentPrompt'))}
        >
          ×
        </IconButton>
      </>
    );
  }
  return (
    <Snackbar
      open={content !== null}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      {...(model && downloads.phase === 'done' ? { autoHideDuration: 5000 } : {})}
      onClose={(_, reason) => {
        if (reason === 'timeout' && model && downloads.phase === 'done')
          dispatch(msg('HideModelToast'));
      }}
      slotProps={{ content: { className: `next-consent-toast ${kind}` } }}
      message={<div className="next-consent-message">{content}</div>}
      action={actions}
    />
  );
}

export function Support(props: Props) {
  return (
    <>
      <ErrorBox {...props} />
      <Explain route={props.state.Route} reference={props.reference} />
      <DebugArea {...props} />
      <Toasts {...props} />
    </>
  );
}
