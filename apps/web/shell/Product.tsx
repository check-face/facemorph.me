// The mounted application: one controller owns effects and state; views dispatch typed messages only.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BlendView } from './render/BlendView.tsx';
import {
  enterBlend,
  inBlend,
  keepViewOnAnchors,
  leaveBlend,
  subscribeRoute,
} from './blend-route.ts';
import { rememberBlend } from './session/blend-store.ts';
import { frameSubscription } from './react-subscription.ts';
import type { Store } from '../src/controller/store.ts';
import { msg } from '../src/controller/msg.ts';
import { rememberVideoQuality } from '../src/controller/preferences.ts';
import {
  estimate,
  faceInputProblem,
  isSlowDevice,
  perFrameText,
} from '../src/controller/derived.ts';
import * as facade from './facade/bridge.ts';
import { describeMeasuredMs, describeMs } from './facade/helpers.ts';
import { Shell } from './Shell.tsx';
import { FaceTile } from './render/FaceTile.tsx';
import { FacesLayout } from './render/FacesLayout.tsx';
import { createUndoCanvas } from './render/undo-canvas.ts';
import { MorphSlot } from './render/MorphSlot.tsx';
import { ProviderSelector } from './render/ProviderSelector.tsx';
import { VideoSlot } from './render/VideoSlot.tsx';
import { NamesDialog, DetectedDialog, CropDialog, DownloadDialog } from './render/Dialogs.tsx';
import { Support, TestingInvite } from './render/Support.tsx';

export function Product({ store }: { store: Store }) {
  const subscribe = useMemo(
    () =>
      frameSubscription(
        store.subscribe,
        undefined,
        undefined,
        (type) => type === 'Progressed' || type === 'DownloadsChanged',
      ),
    [store],
  );
  const s = useSyncExternalStore(subscribe, store.getState);
  const undoCanvas = useMemo(() => createUndoCanvas(), []);
  useEffect(() => {
    if (!s.Undo) undoCanvas.release();
  }, [s.Undo, undoCanvas]);
  useEffect(() => () => undoCanvas.release(), [undoCanvas]);
  const dispatch = store.dispatch;
  // The blend view (fm-2kse) is selected by `#blend` alone; the controller seeds it on first open and cancels a
  // pending blend synthesis when it closes.
  const blendOpen = useSyncExternalStore(
    (changed) => subscribeRoute(window, changed),
    () => inBlend(window),
  );
  useEffect(() => dispatch(msg('BlendView', blendOpen)), [blendOpen, dispatch]);
  useEffect(
    () => keepViewOnAnchors(window, (id) => document.getElementById(id)?.scrollIntoView()),
    [],
  );
  const blendState = s.Blend;
  useEffect(() => rememberBlend(blendState), [blendState]);
  const settings = {
    inputs: s.Inputs,
    kind: s.Kind,
    width: s.Width,
    pinch: s.Pinch,
    frames: s.Frames,
    fps: s.Fps,
  };
  const measurements = {
    faceMs: facade.measuredFaceMs(),
    frameMs: facade.measuredFrameMs(),
    videoMs: facade.measuredVideoMs(),
    plannedFrames: facade.plannedFrames(settings),
  };
  const prediction = estimate(s, measurements);
  const morphRemembered = s.LastRun?.type === 'Run' && s.LastRun.args[0] === 'morph';
  const invalidFace = s.Inputs.findIndex((input) => faceInputProblem(input));
  return (
    <Shell
      busy={s.Busy}
      route={s.Route}
      faces={s.Inputs.length}
      onDropFiles={(files) => dispatch(msg('Photos', null, files))}
      intro={<TestingInvite state={s} dispatch={dispatch} url={location.href} />}
      after={
        <>
          {prediction && !s.Busy && (
            <p className="next-estimate" role="note" data-next-estimate="measured">
              {prediction[1] > 0
                ? `On this device a face took ${describeMeasuredMs(prediction[0])}${perFrameText(measurements) ? ` (${perFrameText(measurements)})` : ''}, so a ${prediction[1]}-frame morph should take ${describeMs(prediction[0] * prediction[1])}.`
                : `On this device a face took ${describeMeasuredMs(prediction[0])}.`}
            </p>
          )}
          {isSlowDevice(s, measurements.faceMs) && (
            <div className="next-slow-route box" role="note">
              <p>
                <strong>Generating is slow on this device.</strong>
                {s.Route === 'cpu'
                  ? ' No graphics acceleration qualified here, so it is running on the processor.'
                  : ` It qualified the ${s.Route} route, but this machine is still taking a long time per face.`}
              </p>
              <p>
                You can keep using the page while work is queued. Try a shorter morph, or compare
                available processing routes with the Processing control above the faces. A capable
                desktop browser may help if you are using a phone.
              </p>
            </div>
          )}
          <Support
            state={s}
            dispatch={dispatch}
            report={facade.reportStatus()}
            reference={facade.reportReference()}
          />
          {!s.Crop && !s.PhotoChoice && !s.Gate && <NamesDialog state={s} dispatch={dispatch} />}
          {!s.Crop && !s.Gate && <DetectedDialog state={s} dispatch={dispatch} />}
          <CropDialog state={s} dispatch={dispatch} />
          <DownloadDialog state={s} dispatch={dispatch} />
        </>
      }
    >
      {blendOpen ? (
        <BlendView state={s} dispatch={dispatch} onBack={() => leaveBlend(window)} />
      ) : (
        <>
          <ProviderSelector
            provider={s.Provider}
            busy={s.Busy}
            onProvider={(provider) => dispatch(msg('Provider', provider))}
            encoderSetup={{
              available: s.Downloads.known && s.Downloads.photoAvailable && !s.Downloads.photoReady,
              active: s.EncoderSetup === 'active',
              onPrepare: () => dispatch(msg('PrepareEncoder')),
              onCancel: () => dispatch(msg('CancelEncoderSetup')),
            }}
          />
          <FacesLayout
            inputs={s.Inputs}
            onAddAt={(at) => dispatch(msg('AddAt', at))}
            undo={s.Undo}
            onUndo={() => {
              if (s.Inputs.length <= 2)
                for (const input of s.Inputs)
                  undoCanvas.retain(
                    input.id,
                    facade.exportResultRevision(input.id),
                    document.querySelector<HTMLCanvasElement>(
                      `[data-next-face="${CSS.escape(input.id)}"] canvas.next-face-img`,
                    ),
                  );
              dispatch(msg('Undo'));
            }}
            tile={(item, _index, label) => (
              <FaceTile
                key={item.id}
                item={item}
                label={label}
                face={s.Faces.find((face) => face.id === item.id)}
                preview={s.Previews.find(
                  (preview) =>
                    preview.id === item.id &&
                    preview.mode === item.mode &&
                    preview.value === item.value,
                )}
                active={s.ActiveFace === item.id}
                queued={s.PendingFaces.includes(item.id)}
                preparing={s.PreparingFaces.has(item.id)}
                fraction={s.Fraction}
                status={s.Status}
                stopping={s.ActiveFace === item.id && s.Stage === 'cancelling'}
                retry={
                  s.LastRun?.type === 'RunFace' &&
                  s.LastRun.args[0] === item.id &&
                  s.RunInputs.some(
                    (input) =>
                      input.id === item.id &&
                      input.mode === item.mode &&
                      input.value === item.value &&
                      input.file === item.file,
                  )
                }
                photoEncodingAvailable={!s.Downloads.known || s.Downloads.photoAvailable}
                onNotice={(message) => dispatch(msg('PhotoError', message))}
                onResultNotice={(message) => dispatch(msg('Notice', message))}
                removable={s.Inputs.length > 1}
                onEdit={(value) => dispatch(msg('Edit', item.id, value))}
                onMode={(mode) => dispatch(msg('Mode', item.id, mode))}
                onBrowse={() => dispatch(msg('BrowseNames', item.id))}
                onPhoto={(files) => dispatch(msg('PickPhoto', item.id, files))}
                onRequestCrop={() => dispatch(msg('RequestCrop', item.id))}
                onResumePhoto={
                  s.PausedPhotos?.has(item.id)
                    ? () => dispatch(msg('ResumePhoto', item.id))
                    : undefined
                }
                onPhotos={(files) => dispatch(msg('Photos', item.id, files))}
                onRun={() => dispatch(msg('RunFace', item.id))}
                onCancel={() => dispatch(msg('CancelFace', item.id))}
                onRemove={() => {
                  undoCanvas.release();
                  // At these boundaries the layout also remounts the remaining siblings.
                  for (const id of s.Inputs.length <= 3
                    ? s.Inputs.map((input) => input.id)
                    : [item.id])
                    undoCanvas.retain(
                      id,
                      facade.exportResultRevision(id),
                      document.querySelector<HTMLCanvasElement>(
                        `[data-next-face="${CSS.escape(id)}"] canvas.next-face-img`,
                      ),
                    );
                  dispatch(msg('Remove', item.id));
                }}
                onShare={() => dispatch(msg('Share', item.id))}
                onSave={() => dispatch(msg('Save', item.id))}
                resultRevision={facade.exportResultRevision(item.id)}
                resultFiles={
                  s.Held?.get(item.id)?.url
                    ? undefined
                    : {
                        prepare: (format) => facade.prepareMedia(item.id, format),
                        rename: facade.renamePreparedMedia,
                        save: (file) => facade.handPreparedMedia(item.id, file, 'save'),
                        share: (file) => facade.handPreparedMedia(item.id, file, 'share'),
                      }
                }
                held={s.Held?.get(item.id)}
                onUseAsPhoto={() => dispatch(msg('UseAsPhoto', item.id))}
                drawFace={(canvas, id) => {
                  if (canvas && !undoCanvas.draw(canvas, id, facade.exportResultRevision(id)))
                    facade.drawFace(canvas, id);
                }}
                displayMilestone={facade.displayMilestone}
              />
            )}
            morphSlot={
              <MorphSlot
                kind={s.Kind}
                frames={s.Frames}
                pinch={s.Pinch}
                provider={s.Provider}
                faces={s.Inputs.length}
                busy={s.Busy}
                accepting={s.Accepting === true}
                morphActive={s.Busy && morphRemembered}
                awaitingDecision={s.Gate?.[1].type === 'Run' && s.Gate[1].args[0] === 'morph'}
                inputProblem={
                  invalidFace < 0
                    ? ''
                    : `Face ${invalidFace + 1}: ${faceInputProblem(s.Inputs[invalidFace]!)}`
                }
                retry={
                  morphRemembered &&
                  (s.Stage === 'error' ||
                    s.Status === 'Cancelled. Your completed faces are still available.')
                }
                onRetry={() => dispatch(msg('Retry'))}
                stage={s.Stage}
                pendingMorph={s.PendingMorph}
                overflow={s.Overflow}
                route={s.Route}
                rejected={s.Rejected ?? undefined}
                status={s.Status}
                disclosure={s.Disclosure ?? ''}
                fraction={s.Fraction}
                faceActive={s.ActiveFace !== null}
                preparing={s.Preparing}
                perFrame={perFrameText(measurements)}
                remaining={s.Remaining}
                warning={s.Warn ?? undefined}
                plannedFrames={measurements.plannedFrames}
                quality={s.Quality ?? 'standard'}
                fps={s.Fps}
                frameMs={measurements.frameMs}
                testingInvited={new URL(location.href).searchParams.has('testing')}
                onRun={(what) => dispatch(msg('Run', what))}
                onCancel={() => dispatch(msg('Cancel'))}
                onOverflow={(open) => dispatch(msg('OverflowToggle', open))}
                onAddFace={() => dispatch(msg('AddAt', s.Inputs.length))}
                onStartOver={() => {
                  undoCanvas.release();
                  // Retain only canvases already allocated by the rendered layout,
                  // including its bounded virtual window, never every hidden face.
                  for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
                    'section.next-face[data-next-face] canvas.next-face-img',
                  )) {
                    const id = canvas.closest<HTMLElement>('section.next-face')?.dataset.nextFace;
                    if (id) undoCanvas.retain(id, facade.exportResultRevision(id), canvas);
                  }
                  dispatch(msg('StartOver'));
                }}
                onSettings={(change) => {
                  if (change.kind !== undefined) dispatch(msg('Kind', change.kind));
                  if (change.frames !== undefined) dispatch(msg('Frames', change.frames));
                  if (change.quality !== undefined) {
                    rememberVideoQuality(change.quality);
                    dispatch(msg('Quality', change.quality));
                  }
                  if (change.pinch !== undefined) dispatch(msg('PinchToggle', change.pinch));
                  if (change.provider !== undefined) dispatch(msg('Provider', change.provider));
                }}
                onDismissWarning={() => dispatch(msg('DismissWarn'))}
                onBlend={() => enterBlend(window)}
              />
            }
            videoSlot={
              <VideoSlot
                videoUrl={s.VideoUrl}
                disclosure={s.Disclosure ?? ''}
                poster={s.Faces[0]?.url}
                useSlider={s.UseSlider}
                sliderFrames={s.SliderFrames}
                sliderFrame={s.SliderFrame}
                busy={s.Busy}
                videoDim={512}
                onUseSlider={(enabled) => dispatch(msg('UseSliderToggle', enabled))}
                onSliderFrame={(frame) => dispatch(msg('SliderFrameSet', frame))}
                onShare={() => dispatch(msg('Share', 'video'))}
                onSave={() => dispatch(msg('Save', 'video'))}
                resultFiles={{
                  prepare: (format) => facade.prepareMedia('video', format),
                  rename: facade.renamePreparedMedia,
                  save: (file) => facade.handPreparedMedia('video', file, 'save'),
                  share: (file) => facade.handPreparedMedia('video', file, 'share'),
                }}
                onNotice={(message) => dispatch(msg('Notice', message))}
              />
            }
          />
        </>
      )}
    </Shell>
  );
}
