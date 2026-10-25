// The rendering port mounted in the real shell from plain state, for the browser tests: ?faces=N (default 2),
// &active=<index>&fraction=<0..1> for a running tile, &queued=<index>; &busy=1 for a running morph, &route=cpu,
// &video=<url> for a finished morph, &frames=<url,url,...> for its retained frames (an empty entry is a frame
// still queued). Edits, mode changes, Remove, the connectors, More options, the settings, Use Slider and the
// slider change this page's own state, so the controls can be operated; generation, photos and the morph itself
// belong to the candidate controller (fm-qkke, fm-j16n) and do nothing here.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.scss';
import { FaceTile } from './render/FaceTile.tsx';
import { FacesLayout } from './render/FacesLayout.tsx';
import { MorphSlot, type MorphSettings } from './render/MorphSlot.tsx';
import { VideoSlot } from './render/VideoSlot.tsx';
import type { FaceMode, Input } from './render/types.ts';
import { Shell } from './Shell.tsx';
import { DialogCheck } from './render/DialogCheck.tsx';

const query = new URLSearchParams(location.search);
const count = Math.max(1, Number(query.get('faces') ?? 2));
const active = query.has('active') ? Number(query.get('active')) : -1;
const queued = query.has('queued') ? Number(query.get('queued')) : -1;
const fraction = Number(query.get('fraction') ?? 0);
const busy = query.get('busy') === '1';
const videoUrl = query.get('video') ?? '';
const frames = query.has('frames') ? (query.get('frames') ?? '').split(',') : null;
let next = 0;
const fresh = (): Input => ({ id: `f${next++}`, mode: 'text', value: '', file: null });

function RenderCheck() {
  const [inputs, setInputs] = useState<Input[]>(() => Array.from({ length: count }, fresh));
  const [settings, setSettings] = useState<MorphSettings>({
    kind: 'full-smooth-figure8',
    frames: 16,
    pinch: true,
    provider: 'auto',
  });
  const [overflow, setOverflow] = useState(false);
  const [useSlider, setUseSlider] = useState(false);
  const [sliderFrame, setSliderFrame] = useState(1);
  const change = (id: string, f: (item: Input) => Input) =>
    setInputs((all) => all.map((item) => (item.id === id ? f(item) : item)));
  const tile = (item: Input, index: number, label: string) => (
    <FaceTile
      key={item.id}
      item={item}
      label={label}
      active={index === active}
      queued={index === queued}
      preparing={false}
      fraction={fraction}
      status={index === active ? 'Generating…' : ''}
      removable={inputs.length > 1}
      onEdit={(value) => change(item.id, (i) => ({ ...i, value }))}
      onMode={(mode: FaceMode) => change(item.id, (i) => ({ ...i, mode }))}
      onBrowse={() => {}}
      onPhoto={() => {}}
      onOpenEncode={() => {}}
      onPhotos={() => {}}
      onRun={() => {}}
      onCancel={() => {}}
      onRemove={() => setInputs((all) => all.filter((i) => i.id !== item.id))}
      onShare={() => {}}
      onSave={() => {}}
    />
  );
  return (
    <Shell faces={inputs.length}>
      <FacesLayout
        inputs={inputs}
        tile={tile}
        onAddAt={(at) => setInputs((all) => [...all.slice(0, at), fresh(), ...all.slice(at)])}
        morphSlot={
          <MorphSlot
            {...settings}
            faces={inputs.length}
            busy={busy}
            stage=""
            pendingMorph={false}
            overflow={overflow}
            route={query.get('route') ?? ''}
            status={busy ? 'Generating frame 3 of 16' : ''}
            fraction={busy ? fraction : 0}
            faceActive={active >= 0}
            preparing=""
            perFrame=""
            remaining=""
            plannedFrames={null}
            testingInvited={false}
            onRun={() => {}}
            onCancel={() => {}}
            onOverflow={setOverflow}
            onAddFace={() => setInputs((all) => [...all, fresh()])}
            onSettings={(change) => setSettings((s) => ({ ...s, ...change }))}
            onDismissWarning={() => {}}
          />
        }
        videoSlot={
          <VideoSlot
            videoUrl={videoUrl}
            useSlider={useSlider}
            sliderFrames={frames}
            sliderFrame={sliderFrame}
            busy={busy}
            videoDim={256}
            onUseSlider={setUseSlider}
            onSliderFrame={setSliderFrame}
            onShare={() => {}}
            onSave={() => {}}
          />
        }
      />
    </Shell>
  );
}

const root = document.getElementById('elmish-app');
if (!root) throw new Error('No #elmish-app element');
createRoot(root).render(
  <StrictMode>{query.has('dialogs') ? <DialogCheck /> : <RenderCheck />}</StrictMode>,
);
