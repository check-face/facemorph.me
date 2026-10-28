// Render-check's modal surfaces from plain inputs. Exercises rendering and reducer messages, never I/O effects.
import { useCallback, useState } from 'react';
import phoneCpuCheck from '../../test/fixtures/phone-cpu-check.json';
import { init, testingInvited } from '../../src/controller/init.ts';
import { msg, type Msg } from '../../src/controller/msg.ts';
import { reduce } from '../../src/controller/reducers/index.ts';
import type { State } from '../../src/controller/state.ts';
import { createCrop } from '../facade/helpers.ts';
import { Shell } from '../Shell.tsx';
import { CropDialog, DetectedDialog, DownloadDialog, NamesDialog } from './Dialogs.tsx';
import { Support, TestingInvite } from './Support.tsx';

const image = '/preview/hello-1024.webp';
const query = new URLSearchParams(location.search);
const n = Math.max(1, Number(query.get('faces') ?? 2));
// Rendering inputs only: exercise a package larger than the browser's reported quota
// without replacing Storage APIs or allocating model bytes.
const downloadBytes = Number(query.get('downloadBytes'));
const names = ['Charlotte', 'Olivia', 'Amelia', 'Isla', 'Mia', 'Ava', 'Grace', 'Willow'];
function initial(): State {
  const state = init({
    today: '2026-10-25',
    url: location.href,
    consentAnswered: !query.has('firstVisit'),
    sliderPreference: false,
    sliderPosition: 1,
  }).state;
  return {
    ...state,
    Names: Array.from({ length: Number(query.get('nameCount') ?? 100) }, (_, i) => ({
      name: `${names[i % names.length]} ${i}`,
      value: `name-${i}`,
      image,
      full: image,
    })),
    Downloads: {
      ...state.Downloads,
      known: true,
      phase:
        query.get('phase') === 'done'
          ? 'done'
          : query.get('phase') === 'failed'
            ? 'failed'
            : 'idle',
      scope: query.get('scope') ?? state.Downloads.scope,
      routeBytes:
        Number.isSafeInteger(downloadBytes) && downloadBytes > 0
          ? downloadBytes
          : phoneCpuCheck.cpuPackageBytes,
      photoBytes: 1024 * 1024 * 1024,
      photoAvailable: true,
    },
    ModelToastHidden: true,
    ...(query.has('namesFailed') ? { Names: [] } : {}),
  };
}

export function DialogCheck() {
  const [state, setState] = useState(initial);
  const [last, setLast] = useState<Msg | null>(null);
  const dispatch = useCallback((message: Msg) => {
    setLast(message);
    setState((s) => {
      const transition = reduce(message, s, { photoRevision: 0 });
      if (!transition) throw new Error(`No reducer for ${message.type}`);
      // No bridge runs here: with ?namesFailed the name-list load answers as a rejected loadNames does.
      if (query.has('namesFailed') && transition.effects.some((e) => e.type === 'loadNames'))
        return (
          reduce(msg('NamesFailed', 'The name gallery is unavailable.'), transition.state, {
            photoRevision: 0,
          })?.state ?? transition.state
        );
      return transition.state;
    });
  }, []);
  return (
    <Shell
      faces={2}
      route={state.Route}
      intro={<TestingInvite state={state} dispatch={dispatch} url={location.href} />}
      after={
        <>
          <Support
            state={state}
            dispatch={dispatch}
            report={{ persisted: true, sendable: 1 }}
            reference="12345678-1234-1234-1234-123456789abc"
          />
          <DetectedDialog state={state} dispatch={dispatch} />
          <CropDialog state={state} dispatch={dispatch} />
          <NamesDialog state={state} dispatch={dispatch} />
          <DownloadDialog state={state} dispatch={dispatch} />
        </>
      }
    >
      <div className="next-actions">
        <button onClick={() => dispatch(msg('BrowseNames', 'face-1'))}>Browse names</button>
        <button
          onClick={() =>
            setState((s) => ({
              ...s,
              Crop: {
                faceId: 'face-1',
                url: image,
                file: new Blob(['photo']),
                scale: 1,
                view: createCrop({ previewWidth: 1024, previewHeight: 1024, viewport: 320 }),
              },
            }))
          }
        >
          Crop photo
        </button>
        <button
          onClick={() =>
            setState((s) => ({
              ...s,
              PhotoChoice: {
                id: 'face-1',
                url: image,
                file: new Blob(['photo']),
                previewWidth: 1024,
                previewHeight: 1024,
                scale: 1,
                boxes: Array.from({ length: n }, (_, i) => ({
                  x: (i % 5) * 0.19,
                  y: Math.floor(i / 5) * 0.19,
                  width: 0.17,
                  height: 0.17,
                })),
              },
            }))
          }
        >
          Pick face
        </button>
        <button
          onClick={() => setState((s) => ({ ...s, Gate: ['route', msg('RunFace', 'face-1')] }))}
        >
          Offer face model
        </button>
        <button
          onClick={() => setState((s) => ({ ...s, Gate: ['photo', msg('RunFace', 'face-1')] }))}
        >
          Offer photo encoder
        </button>
        <button
          onClick={() =>
            setState((s) => ({
              ...s,
              Error: 'The operation failed.',
              LastRun: msg('RunFace', 'face-1'),
              FailureToast: true,
            }))
          }
        >
          Show error
        </button>
        <button onClick={() => setState((s) => ({ ...s, ModelToastHidden: false }))}>
          Show model toast
        </button>
        {testingInvited(new URL(location.href)) && (
          <button onClick={() => dispatch(msg('Run', 'faces'))}>Generate faces</button>
        )}
      </div>
      <output data-dialog-message={last?.type ?? ''}>{JSON.stringify(last)}</output>
      <output data-debug-enabled={String(state.Debug)} />
    </Shell>
  );
}
