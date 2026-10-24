// The rendering port mounted in the real shell from plain state, for the browser tests: ?faces=N (default 2),
// &active=<index>&fraction=<0..1> for a running tile, &queued=<index>. Edits, mode changes, Remove and the
// connectors change this page's own list, so the controls can be operated; generation, photos and the morph
// belong to the candidate controller (fm-qkke, fm-j16n) and do nothing here.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.scss';
import { FaceTile } from './render/FaceTile.tsx';
import { FacesLayout } from './render/FacesLayout.tsx';
import { ProgressBar } from './render/progress.tsx';
import type { FaceMode, Input } from './render/types.ts';
import { Shell } from './Shell.tsx';

const query = new URLSearchParams(location.search);
const count = Math.max(1, Number(query.get('faces') ?? 2));
const active = query.has('active') ? Number(query.get('active')) : -1;
const queued = query.has('queued') ? Number(query.get('queued')) : -1;
const fraction = Number(query.get('fraction') ?? 0);
let next = 0;
const fresh = (): Input => ({ id: `f${next++}`, mode: 'text', value: '', file: null });

function RenderCheck() {
  const [inputs, setInputs] = useState<Input[]>(() => Array.from({ length: count }, fresh));
  const change = (id: string, f: (item: Input) => Input) => setInputs((all) => all.map((item) => (item.id === id ? f(item) : item)));
  const tile = (item: Input, index: number, label: string) => (
    <FaceTile key={item.id} item={item} label={label} active={index === active} queued={index === queued} preparing={false}
      fraction={fraction} status={index === active ? 'Generating…' : ''} removable={inputs.length > 1} comparing={false} sourcePhotoUrl=""
      onEdit={(value) => change(item.id, (i) => ({ ...i, value }))} onMode={(mode: FaceMode) => change(item.id, (i) => ({ ...i, mode }))}
      onBrowse={() => {}} onPhoto={() => {}} onPhotos={() => {}} onRun={() => {}} onCancel={() => {}}
      onRemove={() => setInputs((all) => all.filter((i) => i.id !== item.id))} onRequestCrop={() => {}} onCompare={() => {}} onShare={() => {}} onSave={() => {}} />
  );
  return (
    <Shell faces={inputs.length}>
      <FacesLayout inputs={inputs} tile={tile} onAddAt={(at) => setInputs((all) => [...all.slice(0, at), fresh(), ...all.slice(at)])}
        morphSlot={<div className="next-morph-slot" data-render-check="morph-slot"><ProgressBar fraction={fraction > 0 ? fraction : -1} /></div>}
        videoSlot={<div className="next-video-slot" data-render-check="video-slot" />} />
    </Shell>
  );
}

const root = document.getElementById('elmish-app');
if (!root) throw new Error('No #elmish-app element');
createRoot(root).render(<StrictMode><RenderCheck /></StrictMode>);
