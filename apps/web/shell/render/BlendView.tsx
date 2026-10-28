// The blend view (face.blend-view, fm-2kse): any number of slots built from the compact face tile, a weight per
// slot, and one large result shown and exported like any other face. The view only dispatches typed messages;
// the controller owns the slots, the weights and the one-synthesis blend.
import Button from '@mui/material/Button';
import { useEffect, useRef, useState } from 'react';
import { msg, type Msg } from '../../src/controller/msg.ts';
import type { Face, State } from '../../src/controller/state.ts';
import {
  BLEND_RESULT,
  formatWeight,
  shuffleWeights,
  stepWeight,
  sumLine,
  weightSum,
  WEIGHT_STEP,
} from '../../src/controller/blend.ts';
import * as facade from '../facade/bridge.ts';
import { FaceTile } from './FaceTile.tsx';
import { FancyButton } from './FancyButton.tsx';
import { ResultActions, useResultFile } from './ResultActions.tsx';
import './blend.css';

type Dispatch = (message: Msg) => void;

export const slotLabel = (index: number): string => `Blend face ${index + 1}`;

/** A slot's weight: a 0-1 slider in steps of 0.05 and its value as text. Dragging only moves the thumb; the
 *  released slider (or a committed keyboard step) is the one change that regenerates. */
function Weight({
  label,
  weight,
  onCommit,
}: {
  readonly label: string;
  readonly weight: number;
  readonly onCommit: (weight: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // The native change event fires once on release and once per committed keyboard step, never per drag tick.
    const changed = () => {
      setDraft(null);
      commit.current(stepWeight(Number(el.value)));
    };
    el.addEventListener('change', changed);
    return () => el.removeEventListener('change', changed);
  }, []);
  const shown = draft ?? weight;
  return (
    <label className="next-blend-weight">
      <span className="next-blend-weight-name">Weight</span>
      <input
        ref={input}
        type="range"
        min={0}
        max={1}
        step={WEIGHT_STEP}
        value={shown}
        aria-label={`Weight for ${label}`}
        aria-valuetext={formatWeight(shown)}
        onChange={(event) => setDraft(Number(event.target.value))}
      />
      <output className="next-blend-weight-value">{formatWeight(shown)}</output>
    </label>
  );
}

function ResultImage({ face, revision }: { readonly face: Face; readonly revision: number }) {
  return face.raw ? (
    <canvas
      key={revision}
      ref={(el) => {
        if (el) facade.drawFace(el, BLEND_RESULT);
      }}
      width={1024}
      height={1024}
      className="next-face-img next-blend-image"
      role="img"
      aria-label={face.label || 'Blended face'}
    />
  ) : (
    <img
      key={revision}
      src={face.url}
      width={1024}
      height={1024}
      className="next-face-img next-blend-image"
      alt={face.label || 'Blended face'}
    />
  );
}

export function BlendView({
  state: s,
  dispatch,
  onBack,
}: {
  readonly state: State;
  readonly dispatch: Dispatch;
  readonly onBack: () => void;
}) {
  const blend = s.Blend;
  const slots = blend?.slots ?? [];
  const result = blend?.faces.find((face) => face.id === BLEND_RESULT);
  const updating = blend?.running != null;
  const resultRevision = result ? facade.exportResultRevision(BLEND_RESULT) : 0;
  // While a newer blend is pending, Share and Save are off until its pixels and file are ready.
  const resultFile = useResultFile(
    result && !updating
      ? `${BLEND_RESULT}:${resultRevision}:${result.url}:${blend?.revision}`
      : null,
    result
      ? {
          prepare: (format) => facade.prepareMedia(BLEND_RESULT, format),
          rename: facade.renamePreparedMedia,
          save: (file) => facade.handPreparedMedia(BLEND_RESULT, file, 'save'),
          share: (file) => facade.handPreparedMedia(BLEND_RESULT, file, 'share'),
        }
      : undefined,
  );
  const sum = weightSum(slots);
  const line = sumLine(slots);
  const photoEncodingAvailable = !s.Downloads.known || s.Downloads.photoAvailable;
  return (
    <section
      className="next-blend"
      aria-label="Blend faces"
      data-next-blend-slots={slots.length}
      data-next-blend-running={String(updating)}
    >
      <div className="next-blend-head">
        <Button color="inherit" variant="outlined" className="next-blend-back" onClick={onBack}>
          Back to morph
        </Button>
        <h2 className="next-blend-title">Blend faces</h2>
      </div>
      <div className="next-blend-body">
        <div className="next-blend-result box" data-next-blend-result={result ? 'shown' : 'empty'}>
          <div className="next-blend-frame">
            {result ? (
              <ResultImage face={result} revision={resultRevision} />
            ) : (
              <p className="next-blend-placeholder">
                Press Blend to make one face from the weighted faces.
              </p>
            )}
            {updating && result && (
              <span className="next-blend-updating" role="status">
                Updating…
              </span>
            )}
          </div>
          <div className="next-blend-run">
            <FancyButton
              variant="contained"
              className="next-blend-action"
              disabled={updating}
              onClick={() => dispatch(msg('BlendRun'))}
            >
              {updating ? 'Blending…' : result ? 'Blend again' : 'Blend'}
            </FancyButton>
          </div>
          <div className="next-status next-blend-status" role="status" aria-live="polite">
            {updating && !result && <span>Blending faces…</span>}
            {blend?.error && <span className="next-blend-error">{blend.error}</span>}
            {blend?.error && blend.retry && !updating && (
              <Button
                color="inherit"
                variant="outlined"
                className="next-blend-retry"
                onClick={() => dispatch(msg('BlendRun'))}
              >
                Retry
              </Button>
            )}
          </div>
          {result && (
            <div className="next-actions next-blend-actions">
              <ResultActions
                kind="image"
                state={resultFile}
                files={{
                  prepare: (format) => facade.prepareMedia(BLEND_RESULT, format),
                  rename: facade.renamePreparedMedia,
                  save: (file) => facade.handPreparedMedia(BLEND_RESULT, file, 'save'),
                  share: (file) => facade.handPreparedMedia(BLEND_RESULT, file, 'share'),
                }}
                onNotice={(message) => dispatch(msg('Notice', message))}
              />
            </div>
          )}
        </div>
        <div className="next-blend-panel">
          <div className="next-blend-controls">
            <span className="next-blend-sum" data-next-blend-sum={formatWeight(sum)}>
              Sum {formatWeight(sum)}
            </span>
            <Button color="inherit" variant="text" onClick={() => dispatch(msg('BlendReset'))}>
              Reset
            </Button>
            <Button
              color="inherit"
              variant="text"
              className="next-blend-shuffle"
              disabled={!slots.length}
              onClick={() =>
                dispatch(msg('BlendWeights', shuffleWeights(slots.length, Math.random)))
              }
            >
              Shuffle weights
            </Button>
            <Button color="inherit" variant="text" onClick={() => dispatch(msg('BlendAdd'))}>
              Add face
            </Button>
          </div>
          {line && (
            <p className="next-blend-sum-line" role="note">
              <span>{line}</span>
              <Button
                color="inherit"
                variant="outlined"
                size="small"
                onClick={() => dispatch(msg('BlendNormalize'))}
              >
                Make it 1
              </Button>
            </p>
          )}
          <div className="next-blend-slots" role="list" aria-label="Faces to blend">
            {slots.map((slot, index) => {
              const item = slot.input;
              const label = slotLabel(index);
              const found = blend?.faces.find((face) => face.id === item.id);
              // A compact thumbnail: the face's file when it has one, so a hundred slots hold no full canvases.
              const face = found && found.url ? { ...found, raw: false } : found;
              return (
                <div className="next-blend-slot" role="listitem" key={item.id}>
                  <FaceTile
                    item={item}
                    label={label}
                    face={face}
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
                      s.Stage === 'error'
                    }
                    photoEncodingAvailable={photoEncodingAvailable}
                    onNotice={(message) => dispatch(msg('PhotoError', message))}
                    onResultNotice={(message) => dispatch(msg('Notice', message))}
                    removable={slots.length > 1}
                    onEdit={(value) => dispatch(msg('Edit', item.id, value))}
                    onMode={(mode) => dispatch(msg('Mode', item.id, mode))}
                    onBrowse={() => dispatch(msg('BrowseNames', item.id))}
                    onPhoto={(files) => dispatch(msg('PickPhoto', item.id, files.slice(0, 1)))}
                    onRequestCrop={() => dispatch(msg('RequestCrop', item.id))}
                    onResumePhoto={
                      s.PausedPhotos?.has(item.id)
                        ? () => dispatch(msg('ResumePhoto', item.id))
                        : undefined
                    }
                    // One slot takes one photo; filling many slots from one batch is not this view's entry.
                    onPhotos={(files) => dispatch(msg('PickPhoto', item.id, files.slice(0, 1)))}
                    onRun={() => dispatch(msg('RunFace', item.id))}
                    onCancel={() => dispatch(msg('CancelFace', item.id))}
                    onRemove={() => dispatch(msg('BlendRemove', item.id))}
                    onShare={() => dispatch(msg('Share', item.id))}
                    onSave={() => dispatch(msg('Save', item.id))}
                    drawFace={(canvas, id) => {
                      if (canvas) facade.drawFace(canvas, id);
                    }}
                  />
                  <Weight
                    label={label}
                    weight={slot.weight}
                    onCommit={(weight) => dispatch(msg('BlendWeight', item.id, weight))}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
