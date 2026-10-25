Read ALL of AGENTS.md and README.md, inspect git status, consult relevant Cass feedback,
and read the whole bead before changing anything. Follow the current operator's mode:
ONE agent directly in this session outside NTM; do not spawn helpers or restart panes.
Skip Agent Mail in solo mode and use AGENT_MAIL_GUARD_MODE=warn for commits AND pushes.
When the operator enables multiple agents, register/reserve/respond/release through
Agent Mail and restore guard block mode. All agents remain generalists.

Inspect main CI once at startup, diagnose completed failures and repair/reopen responsible
beads with evidence. There is no automatic CI-to-Beads reopening today. Prefer reopened
work, then bv --robot-next or br ready --exclude-label gate. Never bare bv. Claim work
atomically, preserve other agents' changes and do not disturb live claims.

Implement a working slice, run relevant real tests/builds and browser/device checks,
and review your changes with fresh eyes. Choose validation proportionate to the change;
not every lane or a timing campaign per slice. The hooks installed by npm run hooks:install
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
