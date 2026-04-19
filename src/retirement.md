## A note about facemorph.me

We do plan to retire facemorph.me. The current target is **June 20, 2026 (AEST)**.

The main reason is simple: the site still runs on our local server in the garage. That has been fun, but it is getting harder and more expensive to keep a public service running that way.

The replacement plan is not just "maybe something cheaper later." We want to keep the Facemorph UI public, move the hosted compute onto Hugging Face, and have users sign in with Hugging Face when they want the hosted service to do work for them.

We also want to document the offline path properly. If you want to produce your own hashes, upload photos locally, or run the workflow on your own machine, there should be clear instructions for that too.

Nothing big is changing today. The site is still online while we work through the boring but important parts: old hashes, cached results, and the workflows people actually use.

We are not planning to chase every new technique just because it is newer. The goal is to keep the existing workflow available in a cleaner and cheaper way.

ComfyUI is still worth mentioning. It is active, flexible, and it can cover a lot of the same ground with newer models. It also comes with caveats, and it is not the main hosted migration plan for facemorph.me.

## FAQ

---

#### Is facemorph.me being retired?
Yes. That is the plan, and the current target is **June 20, 2026 (AEST)**.

---

#### What is the hosted plan?
Keep the Facemorph UI public, but move the hosted compute onto Hugging Face. If you want the hosted service to generate or process something for you, the plan is that you would sign in with Hugging Face first.

---

#### Will there still be a local or offline path?
That is the plan too. We want to publish clearer instructions for people who want to generate their own hashes, upload photos locally, or run the workflow on their own machine without relying on the hosted service.

---

#### Are you planning to rebuild everything around newer models?
No. We are not planning a big rewrite just for the sake of using newer techniques. The main goal is to preserve the existing workflow in a form that is easier to keep online.

---

#### Where does ComfyUI fit in?
ComfyUI is an actively maintained tool and it can support a lot of workflows that overlap with facemorph.me, sometimes with better models. It is still a separate tool with tradeoffs, so we see it as something worth documenting, not as a drop-in replacement for the current hosted service.

---

#### Is anything changing today?
Not in a big way. The site is still up while we sort through what can be kept, what may get slower, and what needs a different home.

---

#### I depend on a specific workflow. What should I do?
Email us and describe the exact workflow you need. "I use the API" is harder to act on than "I call this endpoint with these inputs and need this output."

---

#### Why not just keep the current server online?
Because the site still depends on our local server in the garage. That machine will not be the forever home for a public service, and we would rather say that clearly now than pretend otherwise.

---

#### Should I use GitHub issues for retirement questions?
Please use email instead. GitHub issues are still useful for bugs in the current site. Transition questions and workflow requests are easier for us to handle over email.
