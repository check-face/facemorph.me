// The mounted application: one controller owns effects and state; views dispatch typed messages only.
import { useSyncExternalStore } from 'react';
import type { Store } from '../src/controller/store.ts';
import { msg } from '../src/controller/msg.ts';
import { estimate, isSlowDevice, perFrameText } from '../src/controller/derived.ts';
import * as facade from './facade/bridge.ts';
import { describeMeasuredMs, describeMs } from './facade/helpers.ts';
import { Shell } from './Shell.tsx';
import { FaceTile } from './render/FaceTile.tsx';
import { FacesLayout } from './render/FacesLayout.tsx';
import { MorphSlot } from './render/MorphSlot.tsx';
import { VideoSlot } from './render/VideoSlot.tsx';
import { NamesDialog, DetectedDialog, CropDialog, DownloadDialog } from './render/Dialogs.tsx';
import { Support, TestingInvite } from './render/Support.tsx';

export function Product({ store }: { store: Store }) {
  const s = useSyncExternalStore(store.subscribe, store.getState);
  const dispatch = store.dispatch;
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
                available processing routes under More options → Advanced. A capable desktop browser
                may help if you are using a phone.
              </p>
            </div>
          )}
          <Support
            state={s}
            dispatch={dispatch}
            stagedReports={facade.stagedReportCount()}
            reference={facade.reportReference()}
          />
          {!s.Encode && !s.Crop && !s.PhotoChoice && !s.Gate && (
            <NamesDialog state={s} dispatch={dispatch} />
          )}
          {!s.Encode && !s.Crop && !s.Gate && <DetectedDialog state={s} dispatch={dispatch} />}
          <CropDialog state={s} dispatch={dispatch} />
          <DownloadDialog state={s} dispatch={dispatch} />
        </>
      }
    >
      <FacesLayout
        inputs={s.Inputs}
        onAddAt={(at) => dispatch(msg('AddAt', at))}
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
            removable={s.Inputs.length > 1}
            onEdit={(value) => dispatch(msg('Edit', item.id, value))}
            onMode={(mode) => dispatch(msg('Mode', item.id, mode))}
            onBrowse={() => dispatch(msg('BrowseNames', item.id))}
            onPhoto={(files) => dispatch(msg('PickPhoto', item.id, files))}
            onOpenEncode={() => dispatch(msg('OpenEncode', item.id))}
            onRequestCrop={() => dispatch(msg('RequestCrop', item.id))}
            onPhotos={(files) => dispatch(msg('Photos', item.id, files))}
            onRun={() => dispatch(msg('RunFace', item.id))}
            onCancel={() => dispatch(msg('CancelFace', item.id))}
            onRemove={() => dispatch(msg('Remove', item.id))}
            onShare={() => dispatch(msg('Share', item.id))}
            onSave={() => dispatch(msg('Save', item.id))}
            drawFace={(canvas, id) => {
              if (canvas) facade.drawFace(canvas, id);
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
            stage={s.Stage}
            pendingMorph={s.PendingMorph}
            overflow={s.Overflow}
            route={s.Route}
            rejected={s.Rejected ?? undefined}
            status={s.Status}
            fraction={s.Fraction}
            faceActive={s.ActiveFace !== null}
            preparing={s.Preparing}
            perFrame={perFrameText(measurements)}
            remaining={s.Remaining}
            warning={s.Warn ?? undefined}
            plannedFrames={measurements.plannedFrames}
            testingInvited={new URL(location.href).searchParams.has('testing')}
            onRun={(what) => dispatch(msg('Run', what))}
            onCancel={() => dispatch(msg('Cancel'))}
            onOverflow={(open) => dispatch(msg('OverflowToggle', open))}
            onAddFace={() => dispatch(msg('AddAt', s.Inputs.length))}
            onSettings={(change) => {
              if (change.kind !== undefined) dispatch(msg('Kind', change.kind));
              if (change.frames !== undefined) dispatch(msg('Frames', change.frames));
              if (change.pinch !== undefined) dispatch(msg('PinchToggle', change.pinch));
              if (change.provider !== undefined) dispatch(msg('Provider', change.provider));
            }}
            onDismissWarning={() => dispatch(msg('DismissWarn'))}
          />
        }
        videoSlot={
          <VideoSlot
            videoUrl={s.VideoUrl}
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
          />
        }
      />
    </Shell>
  );
}
