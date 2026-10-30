# Independent package review: packet and report template

This is the fixed setup for the independent acceptance review of the published packages (bead fm-fy2.21). It was
committed before the first publication. The review checks whether someone outside the project can use what was
published, from public material only.

## Reviewer and independence

- **Role.** One reviewer: a person, or an agent session, who did not write or review the code or docs of
  `stylegan-js`, `browser-model-manager`, `cloudflare-model-host` or `model-conv`. For an agent session that means
  a fresh session with no access to this project's implementation conversations, Beads, Agent Mail or session
  history.
- **How independence is ensured.**
  - The reviewer starts in an empty machine account or container with no checkout of this repository, no
    workspace links or path aliases, no `~/.cache/facemorph-*` directories and no project credentials.
  - The reviewer gets only the input packet below. Questions to the authors are answered only by pointing at public
    material that already exists; if the answer needs anything else, that is a finding and goes in the friction
    log.
  - The person who starts the review records who the reviewer is and confirms in the report that they authored
    none of the packages.
- **The converter.** It is not an npm package. The reviewer may clone the public repository at the published
  `model-conv-v<version>` tag, and use only `packages/model-conv` and its docs from it.

## Input packet

Exactly this, filled in when the review starts:

| Item | Value |
| --- | --- |
| npm packages and versions | `stylegan-js@<version>`, `browser-model-manager@<version>`, `cloudflare-model-host@<version>` |
| Converter | `https://github.com/facemorph-me/facemorph.me` at tag `model-conv-v<version>` |
| Public docs | each package's README and `docs/` as published on npmjs.com and at that tag; `packages/model-conv/docs/compatibility.md` |
| Model acquisition | the checkpoint URLs, SHA-256 values and terms in those docs (AFHQ cat for the non-face journey; FFHQ optional) |
| Declared capabilities | the packages' READMEs and `stylegan-js` `docs/capabilities.md`: routes, browsers, models and their qualification |
| Published integrity | the `packages-<sha>` artifact's `reports/npm-pack.json` and `reports/provenance.json` from the publishing run, kept for the comparison after the review, not given to the reviewer |

Nothing else: no repository paths outside `packages/model-conv`, no lab assets, no unpublished instructions, no
FaceMorph hostnames.

## Budget

- One review session of at most 8 hours of reviewer time, and at most 4 hours of machine time for conversion and
  browser runs inside it.
- Storage: about 10 GB (the checkpoint, the converter image, the converted model, `node_modules`).
- The budget bounds the review session only. A journey not finished inside it is recorded as **unverified** with
  the reason, never as passed, and the review stays open until a later session covers it.

## Environments available

| Environment | Use |
| --- | --- |
| Linux x86-64 with Docker (an empty account or container) | install, conversion, local static hosting, Node scripts |
| Playwright Chromium, Firefox and WebKit on that Linux machine | CPU route in each engine |
| Desktop Chrome with an NVIDIA GPU | WebGPU routes, where a qualified cell exists |
| A physical Android phone with Chrome (the project's test phone, camera off) | phone CPU and WebGPU, optional |

Any cell the reviewer cannot run is recorded as unverified with the reason. Falling back to the CPU never counts as
a WebGPU pass. Unsupported Node, browser or model cells are limitations to record, not support to infer.

## Report template

Copy this into `docs/packages/reviews/<date>-<reviewer>.md` and fill every field. A line passes only on what the
reviewer ran and observed; an author's statement, an internal example, a typecheck or a tarball scan never passes a
line on its own.

```markdown
# Package review <date>

Reviewer: <name or agent session id>. Authored none of the packages: <yes/no>.
Started by: <name>. Session: <start> to <end>, <hours> reviewer hours, <hours> machine hours.

## Registry and identities
| Package | Version | Integrity (npm) | Tarball sha256 |
| --- | --- | --- | --- |
| stylegan-js | | | |
| browser-model-manager | | | |
| cloudflare-model-host | | | |

Lockfile: <attached package-lock.json, sha256>
Converter: tag <tag>, commit <sha>, image digest <sha256>
Checkpoint: <file>, sha256 <value>, terms read: <yes/no>
Browsers and providers: <engine, version, provider, adapter> per cell
Runtime: <ONNX Runtime Web version and manifest digest, as the docs name them>

## Commands and outputs
Every command copied from the docs, in order, with its doc location and its output (or a link to the log).

## Checklist
| # | Line | Verdict (pass / fail / unverified) | Evidence or reason |
| --- | --- | --- | --- |
| 1 | Clean external project installs the exact registry versions; versions, integrity and lockfile recorded | | |
| 2 | Trusted checkpoint acquisition per the public docs (source, digest, terms) | | |
| 3 | Conversion with the tagged converter container: build, convert, verify against the upstream reference | | |
| 4 | Static hosting under the reviewer's control per the public docs; no FaceMorph hostname, catalogue, alias or secret | | |
| 5 | Manager-loaded inference and a morph | | |
| 6 | Direct caller-loaded engine use without the manager | | |
| 7 | PNG and lossless WebP export and reopen: exact recovery values, lossless decoded pixels | | |
| 8 | The documented non-face example and its descriptor/support boundary; no face detector or e4e download for non-face generation | | |
| 9 | Emitted JS, types, exports and worker assets; bundler, worker and WASM paths, COOP/COEP for threaded routes, single-thread behaviour | | |
| 10 | Real model identity and numbers against the frozen or descriptor-specific tolerances | | |
| 11 | Progress, abort, errors and disposal; cold and warm costs; no network at construction or status reads (intercepted) | | |
| 12 | README and API docs, copyable commands, licences and notices, model terms, ownership and resources, errors, troubleshooting, examples | | |
| 13 | Installed tarball inspection: missing files, repository-only paths, secrets, bundled weights | | |
| 14 | Only the advertised targets; unsupported Node, browser or model cells are stated limits | | |

Numerical lines use the frozen tolerances (FFHQ canaries: RGB 1 of 255, sampled raw float 0.002; e4e W+ 0.0001)
or the model's own declared tolerance (AFHQ cat: raw 1e-3, RGB 1). Encoded files need not be byte-equal; lossless
helpers must return the supplied pixels; recovery values must be exact.

## Friction log
| Doc location | What was missing, wrong or confusing | Effect |
| --- | --- | --- |

## Verdict per package
| Package | Outcome | Usable capabilities | Failures and gaps |
| --- | --- | --- | --- |

## Integrity comparison
Output of comparing the reviewed versions and integrity with the publishing run's `npm-pack.json` and
`provenance.json`. A mismatch means the review accepted something other than what was published.
```

## After the review

If any advertised journey fails or needs unpublished help, the fix ships as a new version and the affected lines
are reviewed again against the new registry bytes. Published versions are never overwritten.
