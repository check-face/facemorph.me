# eris — browser GPU/CPU research device

Linux x86-64 (Omarchy), RTX 2080 SUPER 8 GB (Turing, driver 610), 12 threads, 31 GB, Chromium 152, Node 26, no
.NET SDK (it cannot build the F# site; use the CI artifact). It is also the operator's desktop and runs audio and
chat apps, so check for load before measuring and mark contended runs inconclusive.

Reach it with `ssh eris` (LAN) or `ssh eris-remote` (Cloudflare Access). The checkout is `~/Work/dev/facemorph.me`.

## Git rules for autoresearch (operator, 8 October 2026)

- Commit research straight to the long-lived branch `candidate/next-delivery-20260916` and push it. Do **not** create
  `research/*` or any other branch, and do **not** open pull requests for experiments (iterations 1-2 did; that stops).
  `git pull --rebase origin candidate/next-delivery-20260916` before each push; commit only `autoresearch/` paths you own.
- GitHub Actions is permitted for experiments, especially to get iOS (macOS runner) build minutes. Use an explicitly
  named experimental workflow with a bounded trigger and time budget, per program.md; `workflow_dispatch` only resolves
  workflows present on `master`, so prefer `push` triggers scoped to `autoresearch/**` on this branch. No required-check changes.

## Rules for this device

- Never drive the operator's Mac or desktop browser. Everything runs in a headless Chromium with its own
  profile and its own CDP port, started by `launch-chromium.sh`, and a harness daemon private to the run.
- Heavy runs go through the lease: `python3 autoresearch/run.py --lane browser-gpu --device eris -- <cmd>`.
  The lease is cooperative; look at `uptime` and `nvidia-smi` first. `run.py` journals execution only, it does not qualify.
- `browser-harness` lives in `~/Work/runs/venv-bh`. `gpu-bench.sh` stops its own daemons on exit.
- A real GPU is only claimed when the adapter is not llvmpipe/SwiftShader; `scripts/next-gpu-benchmark.py` checks this.

## Measure

```sh
cd ~/Work/dev/facemorph.me
# whole product through the UI (default URL is the deployed candidate)
python3 autoresearch/run.py --lane browser-gpu --device eris --timeout 1500 -- \
  autoresearch/devices/eris/gpu-bench.sh <label> [url] [faces]
# the same with in-page timestamps and a worker message timeline
BENCH_SCRIPT=autoresearch/devices/eris/gpu-bench-inpage.py  ... gpu-bench.sh <label>
```

`gpu-bench-inpage.py` records, per face, the worker messages (`generate`, `synthesis-complete`, `complete`),
digests, IndexedDB puts, `createObjectURL` and `img.src`. Treat the `img.src` event as the moment a face is
available: the status line settles later, and the harness polls once a second.

Component benchmarks: `png-variants.py` (real Chromium worker, ABBA, bit-exact gate), `idb-durability.py`,
`png-stage-bench.mjs` (Node). Evidence lands in `~/Work/runs/<label>/`; copy what the ledger cites into
`autoresearch/artifacts/<series>/` (gitignored) and append rows to `autoresearch/results.tsv`.

## Starting an agent session

Open `tmux` on eris in `~/Work/dev/facemorph.me`, then give the agent:

> Read autoresearch/program.md and autoresearch/devices/eris/README.md, inspect autoresearch/state and the tail
> of results.tsv, and continue the next bounded experiment on eris. One hypothesis per iteration, control first,
> ABBA, correctness before timing, ledger row for every result including discards.

## Known limits

- `artifact-bench.sh` serves a CI artifact with `scripts/next-e2e-server.py`. The exact artifact the live site was
  promoted from fails the WebGPU route that way on eris (`Invalid Buffer`/`Invalid CommandBuffer`), while the same
  bytes from next.facemorph.me work. Use it for CPU-side questions only; for GPU A/B use a Cloudflare preview
  version (`wrangler versions upload`, not `deploy`: one Worker serves next.facemorph.me).
- `acquire-bench.mjs` runs the product's `model-cache.mjs` in Node against the live origin: network, both hashes and
  verification are real, browser Cache Storage is not.
- eris is a shared desktop. `uptime` before every run; load above ~4 makes timings inconclusive.
