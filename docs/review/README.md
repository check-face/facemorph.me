# Local review evidence — 9 September 2026

The branch retains the original Facemorph UI and contains the entire local
experiment under `experiment/hf`. Start with the walkthrough in `HF_TRIAL.md`.

Verified locally:

- Both the normal classic build and local trial build compile.
- 37 Python tests and four JavaScript tests pass.
- Signed-out uncached generation is refused through the actual browser queue.
- Selecting the demo free allowance permits a real CPU rendering of seed 93 → 97.
  Both portraits and the GIF load; its saved URL reopens.
- Selecting exhausted allowance refuses a new seed 94 → 97 request with the
  wait/paid-resources explanation. Saved seed 42 → 5 still opens in that state.
- The classic preview displays the invitation and retains its `/classic` URL.
- The transition page explains the four-week public window and conditional target.
- A 390px mobile viewport has no horizontal overflow; no browser JavaScript errors
  were captured during the tested flows.

Screenshots: `classic-banner.png`, `transition-page.png`,
`new-experience-mobile.png`. These show local proposal copy, not a live launch.

HF entitlement, billing and caller quota attribution are simulated, not verified.
The real provider integration and hosted persistence require later tests. No
remote resource was created or deployed during this local-first pass.
