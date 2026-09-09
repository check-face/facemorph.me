> Local review update — 9 September 2026: review the working prototype and copy before considering deployment. See `HF_TRIAL.md` at the repository root. All experiment source is now in `experiment/hf/`. Account states are simulated locally; actual generation uses the Mac CPU. HF authentication is not a blocker for this review. The hosted resource names below remain proposals, not deployed services.

# Facemorph's next chapter: side-by-side community trial

Updated: 8 September 2026. Operator direction: build and host a separate HF trial, invite the community to compare it with classic Facemorph, and make the long-term project primarily archival.

## The promise

Facemorph remains a community project. Its next phase prioritizes keeping existing work accessible and explaining how it was made. Limited new generation is a useful companion to the archive, not a commitment to reproduce an unlimited anonymous GPU API forever.

This trial does not remove the classic site, change its API behavior, delete data, or authorize the physical retirement of the GPU. It makes the successor concrete enough for people to try and for us to measure.

## Two experiences, with an explicit invitation

- **Classic Facemorph:** `https://facemorph.me`, using the existing backend during the trial.
- **The new experience:** `https://huggingface.co/spaces/cdilga/facemorph-next` once deployment and smoke tests pass. The direct app URL is `https://cdilga-facemorph-next.hf.space`.
- **Optional friendly address:** `new.facemorph.me`. Initially it can redirect to the HF Space, avoiding iframe authentication problems and a paid custom-domain requirement. If a direct HF custom domain is later enabled, test OAuth callbacks and saved-result URLs before changing the canonical address.
- **One public invitation:** place a visible “Try the new experience” link on the classic site, beside “What’s changing”. The trial links back to classic. Do not announce an unavailable URL.
- **Feedback:** `checkfaceml@gmail.com`, with subject “Facemorph next chapter trial”. No email campaign or messages to users are part of this authorization.

The trial reuses **check-face/facemorph.me**, on branch `codex/hf-community-trial`: the existing Elmish interface, word/seed inputs, mode menus, morph control, slider, sharing links, branding and explanation. There is no replacement Gradio product UI. Gradio provides only HF-native sign-in and the queued compute API behind the existing frontend.

Both are hosted on the same Space origin so the browser can use HF session cookies without shipping an operator token. The original frontend is compiled with `FACEMORPH_TRIAL=1`; normal builds retain classic behavior. A read-only adapter serves its media URLs from saved trial results. Pressing Morph explicitly queues a cache lookup/generation; typing and media GETs never allocate GPU. The first spike shows a short GIF and seven slider positions rather than claiming the old MP4/25-frame output. The 28-day trial starts only after HF authentication, caller quota and restart persistence have been proven.

Seven seed previews are preserved classic files until a new matching rendering is available. The page labels this sample and explains that the full archive and photo workflows have not moved. The discarded standalone UI is not the intended successor.

## Scope of this first spike

Included:

- Converted production StyleGAN2 config-F generator, using the original checkpoint rather than a similarly named replacement model.
- Seven preserved synthetic seed images with source checksums and two engine-comparison examples.
- Two word/seed-generated faces and a bounded twelve-frame looping GIF.
- One job at a time, eight queued requests, and a 200-result public storage cap.
- Public result manifests, downloads, and restorable saved-result links when the bucket is configured.
- No inference or runtime storage fallback to the old server.

Not yet included:

- The full archive, historic GUID links, uploaded-photo encoding, long videos, multi-way blends, and public API compatibility.
- A claim of exact historical pixel/byte reproduction.
- A paid GPU, automatic paid overflow, or a PRO subscription purchase.

These exclusions are displayed in the trial. Photo encoding remains a preservation workstream and a retirement decision, not a hidden feature removal. If community feedback supports an archive-only future for uploads, record that decision explicitly and document old-link continuity/local alternatives before shutdown.

## Trial stages and clock

| Stage | Start condition | Work and exit condition |
|---|---|---|
| Private engineering smoke test | Build exists; owner authentication available | Deploy isolated HF Space and bucket; prove startup, generation, save/load after restart, anonymous archive, and auth denial |
| Small invited test | Owner smoke test passes | Chris and at least one other free HF account compare saved examples and submit new jobs; verify quota is charged to the caller |
| Public side-by-side period | Healthy trial and invitation actually visible on classic site | Run both for **at least 28 calendar days**; record the real start/end dates in trial-status.json |
| Midpoint check | About 14 days into public trial | Publish known differences, review feedback and usage; fix blockers without silently changing the preservation promise |
| Community closeout | At least 28 days and enough feedback/workflow coverage | Explain what stays, what becomes archival, what needs a local runtime, and what remains unavailable |
| Retirement rehearsal | Archive/restore proofs and retained workflows pass | Authorized stop of only the two classic GPU services; verify independence before hardware changes |

A deployment timestamp is not the public trial start. The clock begins when the classic-site invitation is verified live. If a material outage or major behavioral change invalidates useful testing time, extend the period and record why.

The current public API retirement target is **25 October 2026 AEST**. For a 28-day comparison window to finish by then, the public trial must start no later than 27 September. That arithmetic does not override preservation readiness. If access, runtime compatibility or archive work slips, publish a revised target rather than compressing the community trial or retiring on a timer.

## Hosting and resource ownership

The intended resources are isolated under `cdilga`:

| Resource | Purpose | Cost/permission boundary |
|---|---|---|
| `cdilga/facemorph-next` Space | Existing Facemorph frontend, Gradio OAuth/queue, ZeroGPU model execution | Request only ZeroGPU; never silently select hourly hardware |
| `cdilga/facemorph-trial-public` bucket | Public deterministic trial outputs | 200-result application cap; synthetic public outputs only |
| Bundled model + provenance | Reproducible deployment | Trusted checkpoint SHA and retained NVIDIA notices |
| Existing frontend in `facemorph.me/`, backend in `experiment/hf/` | Rebuildable trial using the original project | Excludes tokens, virtualenv and raw legacy model from source control |

A storage write token belongs in a Space secret, scoped to the trial bucket where possible. A deployment token stays local. End-user OAuth tokens are not used as storage-writer credentials. Never consume a single operator token's GPU allowance for all callers.

The saved local token discovered on 8 September belongs to `cdilga` and only grants repository reads. It cannot create resources or upload deployment files. Browser sign-in was requested; resource creation is not complete merely because deploy.py exists. Update trial-status.json only from successful API/deployment evidence.

## User invitation copy

Banner (publish only after the URL works):

> **Facemorph’s next chapter is ready to try.** We’re building a lighter, mostly archival home for this community project. Try the new experience alongside the classic site and help us decide what to keep.
>
> **Try the new experience** · **What’s changing**

Transition-page framing:

> Facemorph is moving into its next phase of life. Our priority is preserving what people have made, with a limited way to make new faces using Hugging Face. The classic experience will remain available during a side-by-side trial of at least four weeks. The new experience is an early preview: it contains a small archive sample and word/seed generation; photo uploads and old API workflows still use the classic site for now.
>
> Try both, compare familiar faces, and tell us what matters to you. We will publish what we learn before making the final transition. Our current API retirement target is 25 October 2026 AEST, subject to preservation and trial readiness.

Do not say the full archive is available, that old links are already preserved, or that every feature has moved. The announcement should celebrate continuity while naming the actual limitations.

## Measure what matters

Collect aggregate job counts, cache hits, duration, queue failures, storage failures and result bytes. Keep raw words, photos, OAuth tokens and unnecessary personal identifiers out of logs. Request feedback about workflow category, browser, result ID and synthetic reproduction steps; do not solicit real personal photos.

Review these questions each week:

- Can ordinary free users sign in and complete a useful request?
- Does generation spend their own allowance, and do cache hits spend none?
- Can users reopen saved results without logging in after the Space restarts?
- Are differences cosmetic encoding effects or a change of face identity/interpolation?
- Which absent classic features are important enough to preserve, document locally or explicitly retire?
- Are storage growth and queue load within the bounded trial's limits?
- Does the interface make the mostly archival direction understandable?

The two initial CPU comparisons are a diagnostic sample, not a parity score for the whole project. Extend to Unicode, representative seeds, morph endpoints and uploaded-latent workflows before making broader promises.

## Release and rollback gates

Before public invitation:

1. HF hardware reports the intended runtime and the build is healthy.
2. An actual signed-in user makes faces and a morph on HF; verify no Triton invocation.
3. A saved result survives restart and loads anonymously.
4. Unauthenticated direct compute events are rejected; no public key or secret appears in frontend/config/API output.
5. Mobile/desktop UI and original/new links work; missing features are visible.
6. At least one non-owner free account is tested before treating quota attribution as proven.

Before old GPU shutdown:

1. Census all four media roots, Mongo data and deployed model/image assets.
2. Produce checksummed exports and restore independently; classify upload-derived data privately.
3. Resolve classic link continuity and every retained upload/encoding workflow.
4. Complete the public comparison window and publish the outcome.
5. Run the approved GPU-service stop rehearsal; inspect intermittent/scheduled consumers.

Rollback of the trial is simple: withdraw the trial banner/link, pause the HF Space, and keep the classic path. Preserve the bucket and source evidence; do not delete users' trial results as routine rollback. A failed HF test must never automatically mutate or restart classic services.
