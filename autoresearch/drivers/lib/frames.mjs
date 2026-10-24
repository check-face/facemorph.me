// Morph frame timing from the worker events of one morph step (fm-qqh), times relative to the click. Pure.
// Synthesized frames are the worker's 'frame' messages; written frames are the 'frame' messages posted to the video
// writer. Per-frame time runs from the last warm-up frame to the last frame (morph-frame-pipeline-v1's boundary).
export function frameTiming(events, warm = 3) {
  const synth = events.filter((e) => e.type === 'frame').map((e) => e.at);
  const written = events.filter((e) => e.posted === 'frame').map((e) => e.at);
  return {
    synthesizedFrames: synth.length,
    writtenFrames: written.length,
    firstFrameMs: synth[0] ?? null,
    lastFrameMs: synth.at(-1) ?? null,
    perFrameMs:
      synth.length > warm ? (synth.at(-1) - synth[warm - 1]) / (synth.length - warm) : null,
    providers: [...new Set(events.map((e) => e.provider).filter(Boolean))],
    routeOutcomes: [...new Set(events.map((e) => e.routeOutcome).filter(Boolean))],
  };
}
