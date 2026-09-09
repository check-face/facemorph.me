## Facemorph’s next chapter

Facemorph is a small community project. We want its next phase to focus on preserving what people have made, with a limited way to keep exploring without a permanently running home GPU.

The proposal keeps the familiar Facemorph interface. Saved faces and morphs should be accessible without signing in. For something new, you would sign in with your own Hugging Face account and use **your own free allowance or paid resources**. Any purchase would happen with HF; Facemorph would not automatically charge you or use the project's account to cover your generation.

We are building and reviewing this locally first. **The public trial has not started.** The local preview simulates account and allowance states and uses the Mac CPU. HF sign-in, caller quota attribution and persistent hosting still need a live test before we invite the community.

## A side-by-side trial

Once the new experience is ready, a banner on classic Facemorph will explicitly invite people to try it. The new experience will link back to classic, so you can compare both and tell us what matters.

Both will run for **at least four weeks after that public invitation goes live**. A local demo or an isolated deployment does not start the clock. We will review feedback during the trial, explain the remaining differences and publish the outcome before making the final transition.

The current API retirement target is **October 25, 2026 (AEST)**. It is subject to preservation and trial readiness. If the work needs more time, we will revise the target rather than shorten the comparison period or switch the service off automatically.

## What this preview covers

The local experiment includes a small sample of preserved synthetic faces, word/seed generation, short GIFs, a slider, downloads and saved links. It does not yet include the full archive, photo uploads, historic photo links or compatibility with the old public API. New renderings may differ from the originals.

Those missing workflows need explicit preservation decisions. A mostly archival future should keep historic work accessible; it is not a claim that everything has already been copied or migrated.

## FAQ

---

#### Is facemorph.me shutting down?
The intention is to keep Facemorph accessible in a more sustainable form. The proposed change concerns the current GPU-backed API and hosting. We will preserve existing work and review the trial before deciding what can retire.

---

#### Who pays for new generation?
Each user would supply their own HF compute entitlement. Saved results need no new compute. A new request would use the user's available free allowance or paid resources they choose through HF. There is no shared owner token paying for everyone's generation, and no automatic fallback to our home GPU.

---

#### What happens when my allowance runs out?
You can still browse saved results. To generate something new, you would wait for your allowance to reset or choose paid resources through HF. The trial must verify that this works for a separate user account before we treat the design as proven.

---

#### What stays available during the comparison period?
Classic remains available alongside the new experience for at least four weeks after the public invitation. Photo uploads and old API workflows still belong to classic during that period. We will state which workflows have a successor and which require an archival or local alternative.

---

#### Will the API and old links work exactly as before?
That is not established. Preserving old artifacts and links is a separate requirement from generating similar faces with a converted model. We need archive and restore evidence, plus a decision about every retained workflow, before removing the current backend.

---

#### Why not keep the current server forever?
Facemorph has been a free experiment maintained out of our own pockets. A permanent GPU service adds ongoing hardware and software maintenance. We want to keep the work accessible while making the project's next phase manageable for its maintainers.

---

#### Where can I try it?
The co-maintainer review is local for now. Once the HF-backed trial passes its checks, we will add a working “Try the new experience” link to classic. A separate trial address is still to be decided; no new domain is being announced yet.

---

#### What feedback helps?
Tell us which workflows you use, which familiar synthetic inputs differ, and what you want preserved. Email **checkfaceml@gmail.com**. Please do not send private photos or access tokens. We cannot promise every feature, but your feedback will inform the transition.
