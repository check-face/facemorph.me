## A note about the facemorph.me API

The current facemorph.me API is scheduled to retire on **June 20, 2026 (AEST)**.

facemorph.me itself is not going away. What is changing is the current Triton-hosted API and the checkface backend we currently run ourselves.

The goal is to move the site onto a provider that is easier for us to keep online over time, while keeping the main experience available. We are still exploring the exact path. Right now, **Hugging Face is the leading candidate**, but we are still testing options and we are not calling the details final yet.

This is the direction we are working toward:

- keep facemorph.me online
- retire the current API in its current form
- move the backend off our own compute
- preserve the workflows people actually use where we can
- document what changes, what stays, and what local options still make sense

Nothing changes overnight. We are in the transition period now, and we expect to test the next setup at **testing.facemorph.me** before any broader migration. We know some workflows will get harder. If you think this breaks a use case people care about, we would like to hear about it.

If you think this could break something you rely on, or if there is a workflow that needs special care, email **checkfaceml@gmail.com**. We cannot promise support for every case, but we will read the feedback and try to help where we can.

For some local checkface or facemorph workflows, **ComfyUI** may also be useful. It is not the hosted migration plan, but it may be a practical local option for image modification on your own machine.

## FAQ

---

#### Is facemorph.me shutting down?
No. facemorph.me is expected to stay up. The part scheduled to retire on **June 20, 2026 (AEST)** is the current API and backend we run on our own compute.

---

#### What is changing on June 20, 2026?
That is the current target date for retiring the API in its current form. It is not a promise that the whole site disappears on that day.

---

#### What is the leading replacement plan?
Hugging Face is the leading candidate right now. It looks like the most practical place to move the hosted compute, but we are still testing options before we make stronger promises about the final setup.

---

#### Are you still exploring other options?
Yes. We have a direction, not a finished answer. We want to test replacement paths before we claim that one approach is final.

---

#### Will there still be a local or offline path?
We intend to document one. For some local image modification workflows, ComfyUI may be a useful fit, and we also want clearer notes for people who want to run parts of the workflow themselves.

---

#### Will the API stay exactly the same?
We are not promising that yet. Some parts may stay compatible, some may need a thinner replacement layer, and some may end up as a smaller surface. We would rather say that plainly now than surprise people later.

---

#### I think this may break something I use. What should I do?
Email us at **checkfaceml@gmail.com** and tell us what you are trying to do. If you can already see a problem with the plan, that is exactly the kind of feedback we want during the transition period. We cannot promise support for every workflow, but we will do our best to help.

---

#### Why not just keep the current server online?
The current setup has served us well, but it was never meant to be the forever home for a public service. We would rather move it carefully, with warning, than keep stretching the current setup until it becomes a problem.

---

#### Where should I send transition questions or feedback?
Email **checkfaceml@gmail.com**. GitHub issues are still useful for bugs in the **checkface** project that powers facemorph.me, but transition questions and workflow concerns are easier for us to handle over email.
