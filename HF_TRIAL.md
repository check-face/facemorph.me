# Local co-maintainer review

Everything for this experiment now lives in this repository on
`codex/hf-community-trial`. It retains the original Facemorph frontend. The branch
starts from the existing October retirement-copy commit `c581367`, one commit
after the locally recorded `origin/master`. Nothing has been pushed or deployed.

## Run on Chris's Mac

```sh
python3 scripts/local-review.py
```

This builds the original frontend and runs the local CPU backend on port 7862.
It uses the prepared Python environment if present, sets local review mode,
and disables the HF bucket configuration. No HF credentials are required.
`--no-build` reuses the last local review build. Stop with Ctrl-C.

Open **http://127.0.0.1:7862/classic?from_seed=42&to_seed=5**.

## Five-minute walkthrough

1. Start on **Classic + draft banner**. Review the proposed invitation and promise
   of at least four weeks of parallel operation. This is the classic layout using
   the local renderer, not a pixel comparison with the live server.
2. Follow **Try the new experience**. The bundled seed 42 → 5 result opens while
   signed out. Try the existing slider and download the GIF.
3. Change an input to an unused seed and press **Morph** while signed out. The app
   asks you to use your own account; it does not generate behind the scenes.
4. Choose **Signed in · free allowance**, then Morph. This performs real local CPU
   generation and saves the result. The paid state permits the same local work;
   it represents the user choosing their own paid resources, not a purchase.
5. Choose **Allowance exhausted**. Reopening the saved pair works. Try another new
   pair to see the refusal and wait/paid-resource explanation. Nothing automatically
   charges the user or falls back to a maintainer-owned GPU.
6. Open **Transition page** to review preservation priorities, trial timing,
   missing workflows and the conditional October target.

All account/allowance states are explicitly labelled simulations. No real HF
balance is shown. Real HF login, entitlement, quota attribution and hosted storage
remain separate integration tests; this local review cannot prove them.

## Where to edit

- `src/Review.fs`: draft banner, account-state panel and new-experience copy.
- `src/retirement.md`: community transition page and parallel-run details.
- `src/trial-explain.md`: new-experience explanation and FAQ.
- `src/App.fs`, `src/MorphForm.fs`, `src/Checkface.fs`: existing Elmish workflow.
- `src/hfTrial.js`: same-origin queue and local review bridge.
- `experiment/hf/`: Python compute, saved-media adapter, tests, model provenance
  and preserved samples. `samples/` contains a small **new trial rendering**, not
  a historical artifact; `archive/` identifies preserved originals.
- `docs/side-by-side-trial.md`: proposal and release gates for co-maintainer review.

## Build modes and future publication

`npm run build` builds the classic frontend with the revised preparation banner.
It does not announce a working successor link. Only a later build explicitly
setting `FACEMORPH_TRIAL_URL` advertises that URL; verify it before publication.
`FACEMORPH_TRIAL=1` selects the HF-style adapter. `FACEMORPH_REVIEW=1` adds local
walkthrough controls. The runner sets both and serves both local views.
The `/classic` route is a review surface, not a second production deployment.

On a hosted Space, `SPACE_ID` disables the local bypass; review cookies are never
used for HF authentication. The local UI permits simulated free/paid states only
when the backend also has `FACEMORPH_LOCAL_DEMO=1` and `FACEMORPH_REVIEW=1`.

## Another checkout

Install the repository's existing Node/.NET build dependencies. Create
`experiment/hf/.venv` with Python 3.10–3.12 and install
`experiment/hf/requirements.txt`. Run the same review command.

The bundled saved pair lets someone inspect the UI without model weights. To
perform new CPU generation, obtain `models/generator.pkl` from the maintainer and
place it in `experiment/hf/models/`. The expected SHA is in `models/provenance.json`;
the backend verifies it before loading. Weights, virtualenvs, build output and new
results are ignored by Git. No token or 133 MB pickle belongs in the review commit.
NVIDIA source and notices are retained under `experiment/hf/vendor/`.

## Checks

```sh
node --test tests/hf-trial.test.cjs
# From experiment/hf, using its Python environment:
python -m pytest -q
```

No deployment, domain setup, public trial start or GPU retirement is part of this
local review. Those follow co-maintainer review and the plan's evidence gates.
