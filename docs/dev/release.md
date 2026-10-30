# Release loop, test selection, rollback and roll forward (fm-3yqf)

Every push to `main` that changes something a visitor gets deploys to https://next.facemorph.me.
Pushes that only touch `.beads/**` or `**/*.md` skip the release.

## The loop

1. `check.yml`: static checks, the affected unit-test shards and a Chromium smoke (about 3–5 min).
2. `release.yml`, started by the same push:
   - `build` makes the `deploy-next/` artifact once and records its digest.
   - `select` (`scripts/ci/select-checks.mjs`) diffs the push against the head of the last green
     release push and picks the checks that diff can affect.
   - `journeys` (Chromium and Firefox, faces and operated) and `check.yml passed on this commit`
     form the go/no-go. On a GO: `deploy`, then `next works for visitors` (post-delivery check and a
     real first face on the live site). If that live check finds next broken, the run rolls back
     on its own.
   - `functional <suite>`: each selected operated e2e suite runs in its own hosted job (Playwright
     image) on the run's artifact, beside the go/no-go. It never stops the switch; a failure is
     fixed forward.
3. `qualify.yml` starts when the release run completes. It reads the release's `selection` artifact
   and runs only what that selection asks for: the engine numerics, the paired timing segments
   (face, morph, photo) against the pinned control, and the six local cells plus the phone pairs
   on live next. With nothing selected it finishes in about a minute.

## Test selection

`scripts/ci/select-checks.mjs` holds the path→check map. For each changed path, the first matching
rule wins. The map is covered by `scripts/ci/select-checks.test.mjs`.

| Change | Selected |
| --- | --- |
| docs, beads, `*.md`, unit tests, CI workflows and tooling | nothing (check.yml covers unit tests) |
| a release suite's own `apps/web/test/e2e/<suite>.e2e.ts` | that suite |
| e2e support (`apps/web/test/support/**`, other e2e helpers) | every suite |
| one UI area (crop, batch, blend, morph view, result row, faces, dialogs, consent…) | that area's suites |
| photo code / morph scheduling | the area's suites plus photo / morph timing |
| shared shell, controller, contracts, styles | every functional suite, no timing |
| engine, runtime, packages, model inputs, build config, lockfile | everything |
| tools/device-lab | the live cells; deploy code: the live cells |
| **any path no rule names** | **everything** (fail safe) |

Release suites are the verify.functional manifest plus the other beads' operated suites
(`MANIFEST_SUITES` and `OPERATED_SUITES` in the map). To add a suite, add it there and add the
source paths that should select it. A test checks that every suite exists and that the manifest
list matches `verify-functional.ts`.

Full run (every functional suite, all timing, engine numerics and live cells), for example before a
production promotion or after editing release/qualify workflows:

```sh
gh workflow run qualify.yml -f run=<release run id> -f commit=<its full sha> -f full=true
```

To see what a diff would select:

```sh
node scripts/ci/select-checks.mjs --base <sha> --head <sha>
```

## Rollback and roll forward

Each deploy prints its rollback command in the run summary, with the Worker version it replaced:

```sh
gh workflow run release.yml -f site=rollback -f target=next -f publish=true -f rollback_version=<previousVersion>
```

Roll forward uses the same command with the newer Worker version id. List the versions with
`cf workers deployments list --worker facemorph-next`.

A rollback run has its own concurrency group, so it never waits behind a push's release. It still
queues behind a deploy that is already publishing to the same target. The job serves the version
at 100 % and then runs `post-delivery-check --mode app` against the host.

Roll back only when next is broken for visitors (site down, app fails to load, no face can be made).
Anything else is fixed and rolled forward by a push.

### Drills on next, 30 October 2026

| Drill | Run | Dispatch → next serves the target build | Dispatch → verified (post-delivery check 10 parts, 0 failed) |
| --- | --- | --- | --- |
| rollback to 0161e4b6 | 41008326035 | 31 s | check failed: the job had no Chromium (fixed in 5286d6c) |
| rollback 66f31fb3 → 6d55b674 | 41009428913 | 497 s (queued 7.5 min behind a push's release in the shared `release` concurrency group; job start → switch 31 s) | 520 s |
| roll forward 6d55b674 → 66f31fb3 | 41010339751 | 37 s | 57 s |

The run-level queue is fixed: a rollback now has its own concurrency group. The switch also comes
before the browser install.
