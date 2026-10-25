# Evidence map — where proof of work lives

Every claim in a bead or a commit points at one of these surfaces. When you close a bead, name the
surface, not just the fact. Nothing here is created on demand — it is what the tools already write.

| Evidence | Producer | Lives at | See it from your phone |
| --- | --- | --- | --- |
| Bead state, acceptance ticks, close reasons, failure passbacks | `br` | `.beads/issues.jsonl` (Git history = time travel) | https://beads.dilger.dev (Cloudflare Access) |
| CI runs, lane conclusions, job logs, summary artifacts | `main.yml` + lane workflows | GitHub Actions | GitHub app → facemorph-me/facemorph.me → Actions; or `gh run list/watch/download` |
| Device-lab runs (journey verdicts, `summary.md`, `report.json`, per-cell `<cell>-last.png` end-state screenshots, `fail-N` frame sequences, Playwright traces) | `tools/device-lab/lab.py run/matrix/qualify` | `facemorph.me/tools/device-lab/out/<ts>-<label>/` on eris; CI runs upload `summary.*` as workflow artifacts | the snapshot page (below), or `gh run download`, or ssh + `open tools/device-lab/out/<run>/summary.md` |
| Research runs, timings, ledgers | `autoresearch/run.py`, rounds | `autoresearch/state/<run-id>/`, `autoresearch/results.tsv`, `~/Work/runs/` (raw, nonportable) | ssh; results.tsv diffs in Git |
| Deploy receipts (artifact digest, live-byte checks, cutover annotations) | deploy workflows, `scripts/delivery/` | workflow summaries, `scripts/delivery/runbook.json` | GitHub app; runbook.json in Git |
| Agent sessions (transcripts, token burn, tool stats) | Claude Code / Codex CLIs | `~/.claude/projects/-home-cdilga-Work-dev-checkface*/`, Codex session dirs on eris | ssh + `cass search`; per-session usage via the JSONL `usage` fields |
| Live agent panes | NTM/tmux | `tmux attach -t facemorph` | termux + ssh + tmux (today); `tmux pipe-pane` to a log file makes it scrollable after the fact |
| What-is-happening snapshot (beads counts, CI wall clocks, latest lab run + screenshots) | `scripts/obs/snapshot.py` | static page, regenerated on eris | publish it to a Cloudflare Pages project behind Access and open the URL |

## The snapshot page

```sh
python3 scripts/obs/snapshot.py                # writes ~/.cache/facemorph-obs/index.html
python3 scripts/obs/snapshot.py --publish facemorph-obs   # + cf pages deploy (Access-protect the project)
```

Run it after lab runs and on a timer (user units on eris):

```sh
cp scripts/obs/obs-snapshot.{service,timer} ~/.config/systemd/user/ && systemctl --user enable --now obs-snapshot.timer
```

The page reads only what the tools already wrote; it creates nothing and gates nothing. If it stops
being useful, delete the timer and the script — the underlying evidence surfaces above are the
authority.
