// The Choose faces view (fm-zigt, fm-id4c item 12, fm-q5b9; mock facemorph-crop-mocks section C): one view for a
// pick, drop or paste of several files, or one photo with two or more detected faces. Every file shows side by side:
// a photo with a box on each detected face (or the whole photo when faces were not looked for or none was found), a
// saved FaceMorph face ready as it is, a still from another model selectable with compute disabled, a damaged still
// with an explicit Use as photo, an unreadable file left out. Picks are numbered in one global tap order across
// files; the tray shows each pick's crop in that order with a quiet Adjust under each photo face (the crop editor,
// titled "Face N of M", for that pick only). CANCEL discards everything; OK adds them all at once: the tray is the
// confirmation, so no crop prompt follows.
import Button from '@mui/material/Button';
import type { Msg } from '../../src/controller/msg.ts';
import { msg } from '../../src/controller/msg.ts';
import type { State } from '../../src/controller/state.ts';
import type { BatchGroup } from '../../src/controller/reducers/batch.ts';
import type { CandidateId } from '../../src/contracts/batch.ts';
import { Modal } from './Dialogs.tsx';
import { CropEditor } from './CropEditor.tsx';
import { pickView } from '../../src/controller/reducers/batch.ts';
import { cropPreview } from '../facade/helpers.ts';
import Logo from '../../src/public/logo.svg?react';
import './batch.css';

type Dispatch = (message: Msg) => void;

const fileLabel = (group: BatchGroup, n: number) => {
  switch (group.role) {
    case 'recovered':
      return `File ${n}: saved FaceMorph face`;
    case 'held':
      return `File ${n}: saved face from another model`;
    case 'damaged':
      return group.asPhoto ? `File ${n}: used as a photo` : `File ${n}: damaged saved face`;
    case 'photo':
      return `File ${n}: photo`;
  }
};

function note(group: BatchGroup, setup: boolean): string | null {
  if (group.status === 'unreadable') return 'This file could not be read, so it is left out.';
  if (group.status === 'unavailable')
    return 'Photo encoding is not available in this browser, so this photo cannot be added. Saved FaceMorph faces still can.';
  if (group.status === 'loading') return 'Opening…';
  if (group.role === 'held')
    return `${group.entry.reason?.text ?? ''} Added as it is: nothing is computed with it.`.trim();
  if (group.role === 'damaged' && !group.asPhoto)
    return `${group.entry.reason?.text ?? 'Its saved face data is damaged.'} It is left out${group.entry.decodes ? ' unless you use it as a photo' : ''}.`;
  if (group.role === 'recovered') return 'Saved face: ready as it is, nothing to encode.';
  if (group.detection === 'running') return 'Finding faces…';
  if (group.faces.length > 1) return `${group.faces.length} faces. Tap each one you want.`;
  if (group.faces.length === 1) return '1 face. Tap it to add it.';
  if (group.detection === 'done')
    return 'Unable to auto align a face. Tap the photo to add it, then Adjust its crop below.';
  return setup
    ? "Face detection didn't run. Tap the photo to add it, then Adjust its crop below. To find faces, set up photo processing."
    : "Face detection didn't run. Tap the photo to add it, then Adjust its crop below.";
}

export function BatchDialog({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const batch = state.Batch;
  if (!batch || state.Gate) return null;
  const editing = batch.editing;
  if (editing) {
    const group = batch.groups.find((g) => editing.candidate.startsWith(`${g.id}#`));
    const n = batch.order.indexOf(editing.candidate) + 1;
    return (
      <Modal
        label="Crop your image"
        className="next-crop-dialog next-encode-dialog"
        backReturnsToDialog
        close={() => dispatch(msg('CropCancel'))}
      >
        <CropEditor
          url={group?.url ?? ''}
          view={editing.view}
          dispatch={dispatch}
          faceLabel={`Face ${n} of ${batch.order.length}`}
        />
      </Modal>
    );
  }
  const position = (candidate: CandidateId) => batch.order.indexOf(candidate) + 1;
  const setup =
    state.Downloads.known && state.Downloads.photoAvailable && !state.Downloads.photoReady;
  const offerSetup =
    setup &&
    batch.groups.some(
      (group) =>
        (group.role === 'photo' || group.asPhoto) &&
        group.status === 'ready' &&
        group.detection === 'not-run',
    );
  const badge = (candidate: CandidateId) => {
    const n = position(candidate);
    return n > 0 ? (
      <span className="next-batch-badge" aria-hidden="true">
        {n}
      </span>
    ) : null;
  };
  const pickLabel = (what: string, candidate: CandidateId) => {
    const n = position(candidate);
    return n > 0 ? `${what}, picked ${n}` : what;
  };
  const count = batch.order.length;
  const close = () => dispatch(msg('BatchCancel'));
  const thumb = (candidate: CandidateId) => {
    const group = batch.groups.find((g) => candidate.startsWith(`${g.id}#`))!;
    const view = pickView(batch, candidate);
    if (!group.url) return <span className="next-batch-thumb next-batch-thumb-empty" />;
    if (!view) return <img className="next-batch-thumb" src={group.url} alt="" draggable={false} />;
    // The pick's crop, exactly as it will be encoded.
    return (
      <span className="next-batch-thumb">
        <img
          src={group.url}
          alt=""
          draggable={false}
          style={{
            width: view.previewWidth,
            height: view.previewHeight,
            transformOrigin: '0 0',
            transform: cropPreview(view, 64),
          }}
        />
      </span>
    );
  };
  return (
    <Modal label="Choose faces" className="next-crop-dialog next-batch-dialog" close={close}>
      <div className="next-batch">
        <header className="next-batch-header">
          <h2>Choose faces</h2>
          <Logo aria-label="FaceMorph logo" />
          <p>Tap faces in the order you want them in your morph. Tap again to take one out.</p>
        </header>
        <div className="next-batch-groups">
          {batch.groups.map((group, i) => {
            const label = fileLabel(group, i + 1);
            const text = note(group, offerSetup);
            const detected = group.faces.length > 0;
            return (
              <section
                key={group.id}
                className="next-batch-group"
                aria-label={label}
                data-next-batch-file={group.id}
                data-next-batch-role={group.asPhoto ? 'photo' : group.role}
                data-next-batch-status={group.status}
              >
                <h3>{label}</h3>
                {detected ? (
                  <div className="next-batch-image">
                    <img src={group.url} alt={`Photo ${i + 1}`} draggable={false} />
                    {group.faces.map((box, k) => {
                      const candidate = group.candidates[k]!;
                      return (
                        <button
                          key={candidate}
                          type="button"
                          className="next-batch-box"
                          data-next-candidate={candidate}
                          aria-pressed={position(candidate) > 0}
                          aria-label={pickLabel(
                            group.faces.length > 1
                              ? `Face ${k + 1} in file ${i + 1}`
                              : `Face in file ${i + 1}`,
                            candidate,
                          )}
                          onClick={() => dispatch(msg('BatchPick', candidate))}
                          style={{
                            left: `${box.x * 100}%`,
                            top: `${box.y * 100}%`,
                            width: `${box.width * 100}%`,
                            height: `${box.height * 100}%`,
                          }}
                        >
                          {badge(candidate)}
                        </button>
                      );
                    })}
                  </div>
                ) : group.candidates.length ? (
                  <button
                    type="button"
                    className="next-batch-whole"
                    data-next-candidate={group.candidates[0]}
                    aria-pressed={position(group.candidates[0]!) > 0}
                    aria-label={pickLabel(
                      group.role === 'photo' || group.asPhoto
                        ? `Photo in file ${i + 1}`
                        : `Saved face in file ${i + 1}`,
                      group.candidates[0]!,
                    )}
                    onClick={() => dispatch(msg('BatchPick', group.candidates[0]!))}
                  >
                    {group.url ? (
                      <img src={group.url} alt="" draggable={false} />
                    ) : (
                      <span className="next-batch-noimage">No preview</span>
                    )}
                    {badge(group.candidates[0]!)}
                  </button>
                ) : (
                  <div className="next-batch-none">
                    {group.url ? <img src={group.url} alt="" draggable={false} /> : null}
                  </div>
                )}
                {text ? <p className="next-batch-note">{text}</p> : null}
                {group.role === 'damaged' && !group.asPhoto && group.entry.decodes ? (
                  <Button
                    className="next-batch-use-photo"
                    variant="outlined"
                    color="inherit"
                    onClick={() => dispatch(msg('BatchUseAsPhoto', group.id))}
                  >
                    Use as photo
                  </Button>
                ) : null}
              </section>
            );
          })}
        </div>
        {offerSetup && state.EncoderSetup === 'active' ? (
          <p className="next-batch-note" role="status">
            Setting up photo processing… Faces in your photos are found here when it is ready.
          </p>
        ) : offerSetup ? (
          <Button
            className="next-batch-setup"
            color="inherit"
            onClick={() => dispatch(msg('PrepareEncoder'))}
          >
            Set up photo processing to find faces
          </Button>
        ) : null}
        <div className="next-batch-tray" aria-label="Picked faces, in order">
          {count ? (
            <ol>
              {batch.order.map((candidate, k) => (
                <li key={candidate} data-next-picked={candidate}>
                  {thumb(candidate)}
                  <span className="next-batch-tray-n">{k + 1}</span>
                  {pickView(batch, candidate) ? (
                    <button
                      type="button"
                      className="next-batch-adjust"
                      aria-label={`Adjust face ${k + 1}`}
                      onClick={() => dispatch(msg('BatchAdjust', candidate))}
                    >
                      Adjust
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p id="next-batch-none" className="next-batch-empty">
              Pick at least one face to add.
            </p>
          )}
        </div>
        {batch.refused ? (
          <p className="next-batch-refused" role="alert">
            {batch.refused}
          </p>
        ) : null}
        <footer className="next-batch-footer">
          <Button className="next-batch-cancel" onClick={close}>
            CANCEL
          </Button>
          <Button
            className="next-batch-ok"
            variant="contained"
            disabled={!count}
            aria-describedby={count ? undefined : 'next-batch-none'}
            onClick={() => dispatch(msg('BatchOk'))}
          >
            {count > 1 ? `Add ${count} faces` : 'OK'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
