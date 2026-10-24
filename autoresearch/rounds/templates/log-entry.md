### <ISO timestamp with timezone, e.g. 2026-10-24T11:20:00+00:00> — <unique event ID, e.g. R1-E3>

- Phase / status: <proposed | observed | implemented | deployed> / <decision or outcome>
- Round / experiment / correction: <IDs; the superseded event or result ID, or not_applicable>
- Hypothesis / decision: <mechanism or scope change; the observation that would refute it>
- Identity: <source, control and candidate builds, artifact, model and fixture hashes; unknown where absent>
- Context: <device, OS, browser, engine and route; workload, resolution, frames, cohort, network; warmup, order, pairs, load, visibility; lease run IDs>
- Boundary / samples: <start → observable finish; control and candidate raw samples with units, or not_measured>
- Correctness / workflow: <gates applied and their results; gates missing; or not_applicable>
- Resources / failures: <bytes, memory, storage; interruptions, fallbacks; remaining limits; or not_measured>
- Evidence: <durable links; local-only or unavailable evidence named as such>
- Conclusion / next action: <the scoped finding and the next gate; nothing inferred about deployment>
