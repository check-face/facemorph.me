import CloseIcon from '@mui/icons-material/Close';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import { testingInvited } from '../../src/controller/init.ts';
import type { Dispatch } from './Dialogs.tsx';
import { downloadMegabytes as megabytes } from '../../src/controller/derived.ts';
import { Explain } from './Explain.tsx';
import { refusalForText } from '../../src/admission/route-admission.ts';
import { setUsageStats, switchState } from '../facade/usage-stats.ts';
import type { ReportStatus } from '../facade/bridge.ts';

interface Props {
  readonly state: State;
  readonly dispatch: Dispatch;
  /** The reporter's own status: whether the choice persisted, and what "Send this report" would send. */
  readonly report: ReportStatus;
  readonly reference: string;
}

/** The debug-report disclosure (fm-szbf). Footer and FAQ links to it expand it and focus its checkbox. */
export const DEBUG_REPORTING = 'debug-reporting';
const RETENTION =
  'Reports go to our private diagnostics service and are kept, with no deletion date.';

/** The failure toast is the one contextual prompt; the error box offers the same one-shot only once it is gone. */
const failureToastShown = (state: State, report: ReportStatus): boolean =>
  state.FailureToast && !state.Debug && state.Error !== null && report.sendable > 0;

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
        anything identifying you. They go to our private diagnostics service and are kept with no
        deletion date.
      </p>
      <div className="next-actions">
        <Button variant="contained" onClick={() => dispatch(msg('Consent', true, 'invite'))}>
          Turn on debug reporting
        </Button>
        <Button onClick={() => dispatch(msg('DismissInvite'))}>Not now</Button>
      </div>
      <p className="next-invite-note">
        You can turn it off at any time under Debug reports at the bottom of the page. Generating
        works exactly the same either way.
      </p>
    </section>
  );
}

export function ErrorBox({ state, dispatch, report, reference }: Props) {
  if (state.Error === null) return null;
  const refusal = refusalForText(state.Error);
  const inMorphStatus =
    state.LastRun?.type === 'Run' &&
    state.LastRun.args[0] === 'morph' &&
    state.Status === state.Error;
  return (
    <div className="next-error box" role="alert">
      {!inMorphStatus && <p>{state.Error}</p>}
      {refusal && (
        <p className="next-error-help">
          <a href={refusal.helpAnchor} data-next-reason={refusal.reasonKey}>
            Why, and what to try
          </a>
        </p>
      )}
      {reference && (
        <p className="next-error-reference" role="note">
          Report reference: {reference}
        </p>
      )}
      <div className="next-actions">
        {!state.Debug && report.sendable > 0 && !failureToastShown(state, report) && (
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

/** Opens the disclosure and moves focus to its checkbox, for every same-page link to #debug-reporting. */
function useDisclosureLinks(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const reveal = () => {
      const details = ref.current;
      if (!details) return;
      details.open = true;
      details.querySelector<HTMLInputElement>('input[type=checkbox]')?.focus();
      details.scrollIntoView({ block: 'center' });
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.(`a[href="#${DEBUG_REPORTING}"]`);
      if (!a) return;
      e.preventDefault();
      history.replaceState(history.state, '', `#${DEBUG_REPORTING}`);
      reveal();
    };
    const hash = () => {
      if (location.hash === `#${DEBUG_REPORTING}`) reveal();
    };
    hash();
    document.addEventListener('click', click);
    addEventListener('hashchange', hash);
    return () => {
      document.removeEventListener('click', click);
      removeEventListener('hashchange', hash);
    };
  }, [ref]);
}

export function DebugArea({ state, dispatch, report, reference }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState(false);
  useDisclosureLinks(ref);
  return (
    <section className="next-debug box" role="region" aria-label="Reports and statistics">
      <details id={DEBUG_REPORTING} className="next-debug-disclosure" ref={ref}>
        <summary>Debug reports: {state.Debug ? 'On' : 'Off'}</summary>
        <label className="next-debug-report">
          <Checkbox
            checked={state.Debug}
            slotProps={{ input: { 'aria-describedby': 'next-debug-note' } }}
            onChange={(_, checked) => dispatch(msg('Debug', checked))}
          />
          <span>Send debug reports until I turn this off.</span>
        </label>
        <p id="next-debug-note">
          Timings, browser/device details and safe error codes. Never photos, typed words, seeds,
          faces or videos. {RETENTION}
        </p>
        {!report.persisted && (
          <p className="next-debug-unsaved" role="alert">
            {`Reporting is ${state.Debug ? 'on' : 'off'} for this tab; this choice could not be saved.`}
          </p>
        )}
        <p role="status">{state.DebugStatus}</p>
        {reference && (
          <p className="next-debug-reference">
            Report reference: <code>{reference}</code>{' '}
            <Button
              size="small"
              onClick={() => {
                void navigator.clipboard?.writeText(reference).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </p>
        )}
        {report.sendable > 0 && !state.Debug && (
          <p>
            A report of the last failure is kept on this device. It is sent only if you choose Send
            this report.
          </p>
        )}
        <p>
          Turning this off stops sending at once and discards anything not yet sent. Usage
          statistics have their own switch below. <a href="#privacy">Everything this page sends</a>.
        </p>
      </details>
      <UsageStatsSwitch />
      <p>
        <a href="mailto:checkfaceml@gmail.com">Email us</a>
      </p>
    </section>
  );
}

/**
 * The changeover statistics switch (fm-5yqq), one line beside the debug-report control. Off saves the opt-out,
 * drops what is queued and sends nothing more from this tab; On removes it. When the browser's own setting rules
 * statistics out, it shows Off, disabled, with that reason.
 */
export function UsageStatsSwitch() {
  const [view, setView] = useState(switchState);
  return (
    <div className="next-usage-stats">
      <label className="next-debug-report">
        <Checkbox
          checked={view.on}
          disabled={view.reason !== null}
          slotProps={{ input: { 'aria-describedby': 'next-usage-stats-note' } }}
          onChange={(_, checked) => setView(setUsageStats(checked))}
        />
        <span>Usage statistics: {view.on ? 'On' : 'Off'}</span>
      </label>
      <p id="next-usage-stats-note" className="next-usage-stats-note">
        {view.reason ??
          (view.saved
            ? 'Anonymous counts of visits, jobs and timings. See “What do you count?”.'
            : `Usage statistics are ${view.on ? 'on' : 'off'} for this tab; this choice could not be saved.`)}
      </p>
    </div>
  );
}

/** Exactly one toast. Modal acquisition has priority; a one-shot report never grants standing consent. */
export function Toasts({ state, dispatch, report }: Pick<Props, 'state' | 'dispatch' | 'report'>) {
  const downloads = state.Downloads;
  const photoOffer = downloads.photoAvailable && !downloads.photoReady;
  const model =
    !state.ModelToastHidden &&
    downloads.known &&
    ['downloading', 'waiting', 'failed', 'done'].includes(downloads.phase);
  const failure = failureToastShown(state, report);
  let content: ReactNode = null;
  let actions: ReactNode = null;
  let kind = '';
  if (state.Gate || state.Crop) return null;
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
        <strong>Something went wrong.</strong> Send this one report so we can fix it? Timings,
        device type and error codes only. Never your photos, words or faces. Kept with no deletion
        date. Reporting stays off.
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
          Send this report
        </Button>
        <Button color="inherit" onClick={() => dispatch(msg('DismissFailureToast'))}>
          Not now
        </Button>
      </>
    );
  } else if (state.ConsentPrompt && !state.Debug) {
    kind = 'next-consent-prompt';
    content = (
      <>
        <strong>Help us test?</strong>
        {
          ' Debug reporting sends timings, device type and error codes from now on, until you turn it off. Never your photos, words or faces. Kept with no deletion date.'
        }
      </>
    );
    actions = (
      <>
        <Button color="inherit" onClick={() => dispatch(msg('Consent', true, 'toast'))}>
          Turn on debug reporting
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
          <CloseIcon />
        </IconButton>
      </>
    );
  }
  // An unsolicited first-visit prompt (the model offer, the reporting question) sits in the page after the
  // morph controls, never over them (defect 16). A prompt answering something the person just did (download
  // progress, a failure's report) is the one bottom-edge toast, and the page reserves room to scroll clear of it.
  if (content !== null && ((model && downloads.phase === 'idle') || kind === 'next-consent-prompt'))
    return (
      <aside
        className={`next-consent-toast next-first-visit ${kind}`}
        role="region"
        aria-label={model ? 'Face model download' : 'Debug reporting'}
      >
        <div className="next-consent-message">{content}</div>
        <div className="next-first-visit-actions">{actions}</div>
      </aside>
    );
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
      <Toasts {...props} />
      <ErrorBox {...props} />
      <Explain route={props.state.Route} reference={props.reference} />
      <DebugArea {...props} />
    </>
  );
}
