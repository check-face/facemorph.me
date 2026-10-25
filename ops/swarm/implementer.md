Read ALL of AGENTS.md and README.md, inspect git status, consult relevant Cass feedback
with --fields minimal --limit 5, and read the whole bead before changing anything.
Follow the current operator's mode:
ONE agent directly in this session outside NTM; do not spawn helpers or restart panes.
Skip Agent Mail in solo mode and use AGENT_MAIL_GUARD_MODE=warn for commits AND pushes.
When the operator enables multiple agents, register/reserve/respond/release through
Agent Mail and restore guard block mode. All agents remain generalists.

Inspect main CI once at startup, diagnose completed failures and repair/reopen responsible
beads with evidence. There is no automatic CI-to-Beads reopening today. Prefer reopened
work, then bvr --robot-next --robot-not-ready-labels gate or
br ready --exclude-label gate --brief --json --limit 10. Never bare bvr or bv. Claim work
atomically, preserve other agents' changes and do not disturb live claims.

Implement a working slice, run relevant real tests/builds and browser/device checks,
and review your changes with fresh eyes. Choose validation proportionate to the change;
not every lane or a timing campaign per slice. Phone reflex (operator, 25 October 2026):
if your bead touches browser runtime or UI behaviour (`apps/web/src`, `packages/*`, worker
or model paths), run `lab.py run --cell phone-cpu --journey warm-face` before push (~20 s)
and record it in the bead; if the bead is types, docs, process or CI-only, write "phone not
relevant" in the bead — never skip silently. Beyond the reflex, validate on the phone whenever
you judge it worthwhile: the per-device lock makes concurrent attempts safe and a busy phone
defers honestly instead of blocking you. The hooks installed by npm run hooks:install
check exact staged/pushed format/lint; they do not run your build/tests. Do that yourself.
No mocks, fabricated proof, skipped failures or weakened assertions. The control artifact
from build:next is not the changed monorepo application built by npm run build.

Tick acceptance only from executed checks, close finished local work with evidence,
flush Beads, commit only your paths/hunks with the bead ID, and push main. Preserve
partially staged shared files: inspect the index and do not use a whole-file path commit
for them. No add -A, commit -a, stash/reset/clean/worktrees/force pushes. Never commit
other sessions' changes. CI is the cumulative backstop; running workflows finish and
only the pending workflow is replaced. A real failure is your next repair work.

Hand off checks, commits and unfinished/untested work. No indefinite CI watching,
mandatory bisection framework or forced session/pane restart. Continue useful work
without communication purgatory; stop when the authorized work is done. A release
requires its full qualification; ordinary slice checks do not waive release criteria.

Follow AGENTS.md's bounded-context rules: small tool output budgets; search then read
line ranges; save full noisy logs locally and return the real exit code, log path and
bounded relevant excerpts. Read the selected bead fully, not the entire tracker.
Hosted CI reuses the macOS iOS Simulator and Android emulator; unavailable runners
are explicit untested outcomes, while actual test failures require repair. Handover
is incomplete until the deployed artifact passes real local P30 Pro and eris checks.
The local finish line is six cells: CPU and WebGPU in eris Chrome, eris Firefox and
Huawei Chrome, plus normal applicable CI. A CPU fallback is not a WebGPU pass.
Use the speed/reuse hierarchy in AGENTS.md: targeted tests and existing CLI/API
scripts first, scripted browser protocols next, interactive harnesses and Android
coordinate taps last unless real operated input is required. Reuse helpers without
invalidating cold-state tests. Keep disposable probes out of Git; restore task-owned
device settings and clean up task-owned processes/profiles/temp outputs.
An explicitly enabled NTM orchestrator follows the tending contract in AGENTS.md;
do not mistake ordinary bead closure for final CI/device/release completion.
