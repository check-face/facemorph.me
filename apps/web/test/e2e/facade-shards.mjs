/** Preserve the facade's declaration order and warm-state dependencies within each shard. */
export const FACADE_SHARDS = Object.freeze({
  1: Object.freeze([
    'engine-construction: constructing the runtime and reading its status request nothing but the pointer and start no worker',
    'cpu-name: a name becomes a typed Output with its face',
    'cpu-seed: a seed becomes a typed Output',
    'cancel-mid-run: the cancelled face has no late result and the lane makes the next face',
    'save-face: Save hands the browser a file',
    'export-short-morph: two faces become a short morph with a video',
    'restore-last: after a reload the faces come back as a typed Output',
    'downloads-subscription: the model inventory arrives as a typed Downloads record',
    'report-staging: with reports on, a finished job stages a report',
    'file-entry-mp4: a saved morph carries the schema-2 project with the writer route; it reopens as its project',
    'operation-service: Morph joins its independently requested CPU face',
    'operation-service: Morph cancellation preserves its independently requested CPU face',
    'operation-service: file cancellation leaves the next CPU jobs running',
  ]),
  2: Object.freeze([
    'photo-preview-crop-encode: a photo selected, cropped when needed and encoded on the CPU',
    'crop-fix-after-ok: a confirmed crop the detector cannot read runs real e4e exactly once, with no detection',
    'photo-encode-package: a confirmed crop of the qualification photo encodes through the package within 1e-4 of the native W+, and a warm encode makes no request',
    'engine-requests: every runtime path the journeys requested is an asset or chunk the manifests declare',
    'controller-photo: real queued crops, CPU encode and recovery-bearing Save/reopen',
    'operation-service: queued CPU faces and a morph complete with scoped lifecycle events',
    'control-written retention restores through the port on the same origin',
  ]),
  3: Object.freeze([
    'codec-export-retry: native post-frame codec failure retains identical frames; retry produces MP4 with zero inference',
    'morph-render: a 32-frame 16 FPS morph through renderMorph is a complete MP4 of 32 decoded frames; a cancelled one offers no video',
    'file-entry: earlier saved stills (schema 1 PNG, schema 2 PNG and WebP) reopen without inference; Save keeps the exact latent and model',
    'save-matrix: WebP default, PNG pixel-exact, MP4 with its resolution; repeat Save reuses name and bytes; a format switch prepares only that format',
  ]),
  4: Object.freeze([
    'controller: recorded job journeys replay with actual CPU execution',
    'controller: every effect reaches its real facade function once',
    'controller: CPU faces and a short morph complete through reducers and effects',
  ]),
});

const assignments = new Map();
for (const [shard, names] of Object.entries(FACADE_SHARDS)) {
  for (const name of names) {
    if (assignments.has(name)) throw new Error(`Duplicate facade shard assignment: ${name}`);
    assignments.set(name, shard);
  }
}

/** Call include for every declaration, then assertComplete after the final declaration. */
export function createFacadeShard(selected) {
  if (selected !== undefined && !Object.hasOwn(FACADE_SHARDS, selected))
    throw new Error(`Unknown facade shard: ${String(selected)}; expected 1, 2, 3 or 4`);
  // Environment values are strings. Reject numeric and coercible lookalikes as configuration errors.
  if (selected !== undefined && typeof selected !== 'string')
    throw new Error(`Unknown facade shard: ${String(selected)}; expected a string`);
  const seen = new Set();
  return {
    include(name) {
      if (!assignments.has(name)) throw new Error(`Unassigned facade test: ${name}`);
      if (seen.has(name)) throw new Error(`Duplicate facade test declaration: ${name}`);
      seen.add(name);
      return selected === undefined || assignments.get(name) === selected;
    },
    assertComplete() {
      const missing = [...assignments.keys()].filter((name) => !seen.has(name));
      if (missing.length)
        throw new Error(`Missing facade test declarations: ${missing.join('; ')}`);
    },
  };
}
