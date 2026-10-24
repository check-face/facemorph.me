# Old-wording diagnostics report deletion, 2026-10-24

Kept receipt for an irreversible action (bead `fm-xgww`). Counts and digests only.

- Outcome: **complete**
- Script: `scripts/diagnostics/delete-old-wording-reports.mjs` uncommitted at run time (commit it with this receipt; the blob SHA-256 identifies the exact file), blob SHA-256 `69c695d7600c3eedb9550104efb954a524caf8b4d660596e222847a479d93e3d`
- Command: `node scripts/diagnostics/delete-old-wording-reports.mjs --mint-r2=<account> --receipt=docs/receipts/diagnostics/old-report-deletion-2026-10-24.md --report-roots=/home/cdilga/.claude/projects --recover-keys-from=<18 October session scratch>/diag/mined-keys.txt (deleted by this run) --extra=Cloudflare API, read just before the run: lifecycle rules = [Default Multipart Abort Rule] only, no expiration rule; bucket lock rules = none; KV namespace DIAGNOSTICS fallback entries = 0 (none to expire). Read-only re-listing at 07:25 UTC (token 734640cb7b4a6e85bd493282aae736e3, expires 09:25 UTC): 930 objects; 801 uploaded at or before 2026-10-17 08:02:59 UTC with digest c3833f1f056ae0700e82d997a592e9009114d014a7b1ce8ae21c45cd8c07e0fb, none uploaded on or after 18 October among them; 0 between the mined bound and the boundary; 129 after the boundary.`
- Started 2026-10-24T07:43:01.233Z; finished 2026-10-24T07:54:50.236Z

## First run (the deletion itself)

The deletion ran in a first invocation of this script, started at about 07:37 UTC with the same arguments minus
`--recover-keys-from` and `--extra`. It passed the same preconditions, listed 801 mined objects matching the digest
above, deleted them, then stopped in the working-copy search on a ripgrep partial-read error (exit status 2, treated as
fatal by that version of the script) before writing this receipt. Its JSON log was printed to the terminal and not
kept. The script was fixed (partial reads are tolerated and the raw error is never rethrown) and re-run unattended;
that second run is what the sections below record. Evidence that the first run deleted exactly the mined set: the
07:25 UTC re-listing (801 mined, digest `c3833f1f056ae0700e82d997a592e9009114d014a7b1ce8ae21c45cd8c07e0fb`, 129 after the
boundary with digest `67e2ee8d64405e50b448ca61e472e1b367e7da2903c674cb81e8f96085cc7e8b`) against the second run's listing
(0 mined, 0 before the boundary, the same 129 after the boundary with the same digest). Count deleted: 801. The first
run's two tokens were created with the same 45-minute expiry; their IDs were in the lost log.

## Preconditions
- `{"event":"precondition-a","ok":true,"noteCommit":"7875aaf","branch":"origin/main"}`
- `{"event":"note-scan","rev":"7875aaf","findings":0}`
- `{"event":"note-scan","rev":"HEAD","findings":0}`
- `{"event":"listing","total":129,"mined":0,"minedDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","extra":0,"after":129,"afterDigest":"67e2ee8d64405e50b448ca61e472e1b367e7da2903c674cb81e8f96085cc7e8b","uploadedOnOrAfter18Oct":0}`

## Deletion
- Mined set before deletion: 0 objects, key-list digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (uploaded at or before 2026-10-17T08:02:59Z)
- Boundary (corrected consent wording live): 2026-10-17T20:28:59Z
- Set A (uploaded after the boundary, untouched): 129 objects, digest `67e2ee8d64405e50b448ca61e472e1b367e7da2903c674cb81e8f96085cc7e8b`
- Deleted: 0

## Post-checks
- Mined objects remaining: 0; objects before the boundary: 0
- Set A after: 129 objects, digest `67e2ee8d64405e50b448ca61e472e1b367e7da2903c674cb81e8f96085cc7e8b` (unchanged); new reports since the listing: 0
- Lifecycle rules: (not readable via S3); expiration rules: 0
- Cloudflare API, read just before the run: lifecycle rules = [Default Multipart Abort Rule] only, no expiration rule; bucket lock rules = none; KV namespace DIAGNOSTICS fallback entries = 0 (none to expire). Read-only re-listing at 07:25 UTC (token 734640cb7b4a6e85bd493282aae736e3, expires 09:25 UTC): 930 objects; 801 uploaded at or before 2026-10-17 08:02:59 UTC with digest c3833f1f056ae0700e82d997a592e9009114d014a7b1ce8ae21c45cd8c07e0fb, none uploaded on or after 18 October among them; 0 between the mined bound and the boundary; 129 after the boundary.

## Working copies
- Roots: `/tmp`, `/home/cdilga/.cache`, `/home/cdilga/Work`, `/home/cdilga/Downloads`
- Removed 807 file(s), 6335541 bytes; git-tracked files kept: 2; re-scan matches: 0
- Counted only (history, not deleted): 5 file(s) under `/home/cdilga/.claude/projects`

## Tokens
- read token `a0a1a1d2062fbe2d697940499a2f2999`: created 2026-10-24T07:42:55.245Z, delete refused for this login; the token expires at 2026-10-24T08:27:54Z
- read-write token `9dc20cdcaaa712de59fc411d9e90e88a`: created 2026-10-24T07:42:56.224Z, delete refused for this login; the token expires at 2026-10-24T08:27:55Z

## Deviations
- The first run crashed after deleting and before writing a receipt (see "First run"); its log was lost.
- The first run's error output printed working-copy file paths that embed report run and object IDs into this agent session's terminal; those transcripts are among the five counted files.
- lifecycle configuration not readable through S3 with the object-scoped token; checked through the Cloudflare API instead (see post-checks)
- 2 git-tracked file(s) under the roots contain a mined report identifier and were not deleted (the script reports counts only, so their paths were not kept; a follow-up search with the 78 identifiers recoverable from session transcripts found no tracked file, so the two match identifiers outside that subset). Deleting a tracked file would not remove it from Git history; finding and redacting them needs the key list, which no longer exists.
- 5 agent session transcript file(s) under /home/cdilga/.claude/projects mention report identifiers; left in place as history, not deleted
- read token could not be deleted by this login; it expires at 2026-10-24T08:27:54Z
- read-write token could not be deleted by this login; it expires at 2026-10-24T08:27:55Z
