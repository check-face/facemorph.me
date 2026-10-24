# Research round: <journey> — <YYYY-MM-DD>

Copy this file to `autoresearch/rounds/<YYYY-MM-DD>-<slug>/README.md` and create `experiments.md` and `log.md` beside
it; the links below resolve from there. Replace every placeholder.

Status: <proposed | measuring | integration pending | deployed verification | closed>.
Journey and bottleneck: <the wait a person sits through, the cohort and the finish boundary>.
Exclusions: <what this round does not touch, and why>.
Budget: <time, devices and lease lanes; the stop condition>.

## Identity and evidence

<Exact control and candidate source, artifact, model, fixture and runtime identities; recent real-visitor or consented
diagnostics coverage; device, route, cohort (empty cache, cached files in a new browser, resident session, cached
output, restored result) and finish boundary (drawn face, useful scrub frame, playable video, prepared file, Save or
Share handoff); what is missing. History is linked, never copied in as a current claim.>

## Candidates

<One falsifiable mechanism per candidate in experiments.md, each with its control, refuting observation, correctness
gates and cost. Control/control noise is measured first on each cell; then a discarded warmup and ABBA x3 on the same
cell; a fresh confirmation run is separate from screening. Every screened candidate is recorded, kept or not.>

## Integration and remaining gates

<Owner bead, freeze, qualification and deployment evidence; unknowns and the next action. A ledger keep, an
integration commit and a deployed validation are three different facts.>

## Records

`log.md` (append-only) · `experiments.md` · `../../results.tsv` (evaluation ledger) · `../../records.md` (record
standards) · `../../program.md` (protocol): written as plain paths here because they resolve only from the round's
own directory.
