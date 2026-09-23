/**
 * Every stage this product emits has a meaning here, or is deliberately silent.
 *
 * Nothing falls through to a generic word. The operator watched the status line say "Working…"
 * at exactly the moments a phase had just finished — including the moment the product gave up
 * on the GPU and dropped to the route that costs seconds per face. A stage with nothing written
 * about it is a defect, so `stage-labels.test.mjs` enumerates the stages emitted across the
 * shipped tree and fails when one is missing from this file. Silence is a decision recorded
 * here, never an accident.
 */

/** Stages whose text the emitter produces itself: a frame count, a face number, a route name. */
export const SELF_TEXT_STAGES = new Set(['face', 'morph', 'export', 'route-admitted']);

/**
 * Stages that deliberately change nothing on screen. Each is an internal boundary immediately
 * followed by a labelled stage, and announcing it only makes the line flicker.
 */
export const SILENT_STAGES = new Set([
  'gpu-stage',
  // Repeats once per morph frame inside the synthesis phase; the phase's own stages speak.
  'transient-frame',
  'alignment-manifest-complete', 'alignment-runtime-complete', 'alignment-model-complete',
  'alignment-model-deserialize-complete', 'alignment-model-download-complete',
  'photo-decode-complete', 'face-landmarks-complete', 'photo-warp-resize-complete',
  // R2-15: photo-preparation and storage stages are diagnostics-only. The UI already speaks
  // about these moments in its own words (preparing your crop, reading your photo); the
  // records just need the stage named. 'storage' is a facts row, never a user message.
  'photo-select', 'photo-preview', 'photo-crop', 'photo-align', 'photo-encode', 'storage',
  // The background warm-up finished acquiring the likely route's models. It is recorded so a
  // report can show a first face was fast because the bytes were already here, but it is not
  // spoken: nothing was asked for, so there is no status line it belongs in, and announcing a
  // finished download the visitor never started only raises a question it cannot answer.
  'models-prefetched',
  // Byte progress of a download the visitor asked for; the model toast shows it, not the job line.
  'models-download',
  // Diagnostics-only: a visitor cannot act on a storage status mid-download, and acquisition
  // already speaks. It exists so a report can say why a gigabyte was fetched twice.
  'cache-trouble'
]);

/** Stages that carry bytes and deserve a byte count rather than an indeterminate bar. */
export const BYTE_STAGES = new Set(['asset-acquisition', 'alignment-model-download', 'photo-acquisition']);

/**
 * Stages that repeat inside one phase and carry a step count. Their `-complete` is a tick,
 * not a phase boundary, so it is still written in the present tense on purpose: the photo
 * encoder runs 108 of them and the user is waiting through all of them.
 */
export const STEP_STAGES = new Set(['encoder-shard-acquisition', 'encoder-shard-complete']);

export const STAGE_LABELS = {
  // Acquisition and engine start-up.
  'asset-acquisition': 'Downloading model files…',
  // Reaching for a photo starts the face detector and the 1 GB encoder immediately, so the
  // wait overlaps choosing and cropping instead of following them. Unlike the silent route
  // warm-up this one speaks: the visitor asked for it, and it is the largest thing the
  // product ever fetches.
  'photo-acquisition': 'Getting photo tools ready…',
  'photo-tools-ready': 'Photo tools ready on this device.',
  'runtime-loading': 'Starting the local engine…',
  'model-loading': 'Loading the model…',
  'model-loaded': 'Model ready.',
  'mapping-loading': 'Loading face mapping…',
  'mapping': 'Preparing your face…',
  'mapping-complete': 'Face prepared.',
  'canary': 'Checking this device…',
  // A canary that failed after the face it gated was delivered: the route cannot be trusted,
  // and the user is told rather than left with unproven output (C-03).
  'canary-invalidated': 'A background device check failed, so this route was dropped and your last face may be unreliable.',
  // The bridge renames every refused route (route-admitted with a non-admitted outcome, and a
  // background canary failure) to this stage for the interface, which builds the sentence from
  // the rejected and current route names. The diagnostics record keeps the original stages.
  'route-rejected': 'This device rejected a graphics route.',
  // Every route had failed at least once in this session. Rather than dead-end, the slate is
  // cleared and the priors decide again; a genuinely broken route fails its canary again and
  // is named again. Said plainly, because the visitor watched something fail a moment ago.
  'routes-retried': 'Trying the graphics routes again from the start.',
  // The route bridge renames any non-admitted outcome to route-rejected, so this label is
  // only reached through the diagnostics vocabulary; the interface says what went wrong
  // through the error box, which carries the worker's own message.
  'engine-stopped': 'The local generation engine stopped before it could start.',
  'codec-loading': 'Preparing video export…',
  // Generation.
  'synthesis': 'Generating…',
  'synthesis-complete': 'Face generated.',
  'gpu-prefix-loading': 'Loading the graphics model (1 of 2)…',
  'gpu-suffix-loading': 'Loading the graphics model (2 of 2)…',
  // The most consequential thing that can happen during a run. It used to read "Working…".
  'fallback-cpu': 'Graphics acceleration was not used on this device. Generating on the processor, which is much slower.',
  // Photos.
  'alignment': 'Finding and aligning the face…',
  'alignment-complete': 'Face aligned.',
  'alignment-manifest': 'Preparing photo processing…',
  'alignment-runtime': 'Starting photo processing…',
  'alignment-model': 'Loading the face detector…',
  'alignment-model-download': 'Downloading the face detector…',
  'alignment-model-deserialize': 'Preparing the face detector…',
  'photo-decode': 'Reading your photo…',
  'face-landmarks': 'Finding facial landmarks…',
  'photo-warp-resize': 'Aligning your photo…',
  'encoder-loading': 'Loading the photo encoder…',
  'encoder-loaded': 'Photo encoder ready.',
  'encoder-correctness-check': 'Checking photo processing on this device…',
  'encoder-correctness-complete': 'Photo processing checked.',
  'encoder-shard-acquisition': 'Encoding your photo…',
  'encoder-shard-complete': 'Encoding your photo…',
  'encoding': 'Encoding your photo…',
  'encoding-complete': 'Photo encoded.',
  // Device storage.
  'original-cache-hit': 'Loaded saved original',
  'original-cached': 'Original saved on this device',
  // A cached original failed its checksum: the user is paying for a synthesis they should
  // not have needed, and they are told so rather than shown a present participle.
  'original-cache-invalid': 'A saved face failed its checksum, so it is being generated again.',
  'cache-unavailable': 'Generated successfully; device storage is unavailable.',
  // The cache refused, lost or repaired an asset. Diagnostics-only: the interface already speaks
  // about acquisition, and a visitor cannot act on a storage status mid-download. It exists so a
  // report can say why a gigabyte was fetched twice instead of leaving it to inference.
  'cache-unavailable-detail': 'Device storage had trouble holding the model files.'
};

const MB = 1024 * 1024;
/**
 * What a byte stage says when the bytes are already on this device. Only the stages whose label
 * names a download need one: a stage that never claimed to be downloading is already true.
 */
const LOCAL_LABELS = {
  'asset-acquisition': 'Loading model files from this device…',
  'alignment-model-download': 'Loading the face detector from this device…'
};
// Byte counts are only worth showing once they are worth waiting for; below this a count
// reads as "0 MB of 0 MB" and tells the user less than the label alone.
const COUNTABLE_BYTES = 8 * MB;

/** Bytes a progress event carries, whichever of the two field names its emitter uses. */
export function loadedBytes(event) {
  for (const key of ['loaded', 'completed'])
    if (Number.isFinite(event?.[key])) return event[key];
  return undefined;
}

/**
 * The line to show for a stage, or `null` when this stage is deliberately silent and the
 * previous message should stand. `undefined` means the stage is unknown here — the caller
 * leaves the line alone and the test above is what stops one ever shipping.
 */
export function labelFor(stage, event = {}) {
  if (SELF_TEXT_STAGES.has(stage)) return typeof event.text === 'string' ? event.text : null;
  if (SILENT_STAGES.has(stage)) return null;
  const label = STAGE_LABELS[stage];
  if (label === undefined) return undefined;
  const loaded = loadedBytes(event);
  if (BYTE_STAGES.has(stage) && event.total >= COUNTABLE_BYTES && Number.isFinite(loaded)) {
    // The emitter that knows the difference says so: `fetchedTotal` is the part of this
    // acquisition that is actually crossing the network. On a warm device it is zero while the
    // bar still moves — the cache read and its verification take real time — and the line then
    // says what is happening instead of announcing a download of bytes already on the disk.
    // That line read "Downloading model files… 183 MB of 203 MB" over a complete cache hit,
    // which is how a working cache was read as a gigabyte re-downloading every visit
    // (operator, 22 September).
    if (Number.isFinite(event.fetchedTotal)) {
      if (event.fetchedTotal < COUNTABLE_BYTES) return LOCAL_LABELS[stage] ?? label;
      const fetched = Number.isFinite(event.fetched) ? event.fetched : 0;
      return `${label} ${Math.round(fetched / MB)} MB of ${Math.round(event.fetchedTotal / MB)} MB`;
    }
    return `${label} ${Math.round(loaded / MB)} MB of ${Math.round(event.total / MB)} MB`;
  }
  if (STEP_STAGES.has(stage) && event.total > 1 && Number.isFinite(loaded))
    return `${label} ${loaded} of ${event.total}`;
  return label;
}

/** Every stage this file accounts for, in any way. Used by the enumeration test. */
export function accountedStages() {
  return new Set([...Object.keys(STAGE_LABELS), ...SELF_TEXT_STAGES, ...SILENT_STAGES]);
}

export function morphCounter(done, total) {
  return `Generating ${done} / ${total} images`;
}

export function createFrameCounter(total) {
  const finished = new Set();
  return {
    complete(index) {
      if (Number.isInteger(index) && index >= 0 && index < total) finished.add(index);
      return { done: finished.size, text: morphCounter(finished.size, total) };
    },
    start() { return { done: 0, text: morphCounter(0, total) }; }
  };
}
