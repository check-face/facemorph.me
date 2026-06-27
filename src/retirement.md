## A note about the facemorph.me API

The current facemorph.me API is now scheduled to retire on **October 25, 2026 (AEST)**.

We have pushed this back from the original June date. Part of that is popular demand — a lot of people asked us for more time — and part of it is that we want to properly sit with the feedback we have had rather than rush the change. We would rather move slowly and get it right.

facemorph.me itself is not going away. What is changing is the current API and the way the checkface backend is hosted today.

The goal is to move the site onto a provider that is easier for us to keep online over time, while keeping the main experience available. We are still exploring the exact path. Right now, **Hugging Face is the leading candidate**, but we are still testing options and we are not calling the details final yet.

This is the direction we are working toward:

- keep facemorph.me online
- retire the current API in its current form
- move the backend to a setup that is easier to support long-term
- preserve the workflows people actually use where we can
- document what changes, what stays, and which alternatives still make sense

Nothing changes overnight. We are in the transition period now, and we expect to test the next setup at **[testing.facemorph.me](https://testing.facemorph.me)** before any broader migration. We know some workflows will get harder. If you think this breaks a use case people care about, we would like to hear about it.

If you think this could break something you rely on, or if there is a workflow that needs special care, email **checkfaceml@gmail.com**. We cannot promise support for every case, but we will read the feedback and try to help where we can.

For some local checkface or facemorph workflows, **ComfyUI** may also be useful. It is not the hosted migration plan, but it may be a practical local option for image modification on your own machine.

## FAQ

---

#### Is facemorph.me shutting down?
No. facemorph.me is expected to stay up. The part scheduled to retire on **October 25, 2026 (AEST)** is the current API and backend in their current form.

---

#### What is changing on October 25, 2026?
That is the current target date for retiring the API in its current form. We moved it back from June to give the feedback we received proper consideration. It is not a promise that the whole site disappears on that day.

---

#### "I'm not happy about features being removed from a service." How do you respond?
That is completely fair, and we would feel the same way. Nobody likes losing something they have come to rely on, and we do not want to wave that away. It is a real part of why we pushed the date back.

The honest context is that facemorph.me has always been free — no ads, no accounts, no charges — and the servers come out of our own pockets. We mention that not to dismiss the concern but to explain the constraint we are working within: the current setup is getting harder for us to keep running, and the choice in front of us was to move it or eventually lose it. We would much rather move it.

So the goal is not to take things away. The whole reason we are moving to a new backend rather than switching it off is to keep as much of what people use working as we can. If there is a feature that matters to you, please tell us at **checkfaceml@gmail.com** — knowing what people rely on is exactly what helps us protect it.

---

#### What is the leading replacement plan?
Hugging Face is the leading candidate right now, but we are still testing options before we make stronger promises about the final setup.

---

#### Are you still exploring other options?
Yes. We have a direction, not a finished answer. We want to test replacement paths before we claim that one approach is final.

---

#### Will there still be a local or offline path?
We intend to document one. For some local image modification workflows, ComfyUI may be a useful fit, and we also want clearer notes for people who want to run parts of the workflow themselves.

---

#### Will the API stay exactly the same?
We are exploring options that would let people sign in to a Hugging Face account and still use a familiar interface.

---

#### I think this may break something I use. What should I do?
Email us at **checkfaceml@gmail.com** and tell us what you are trying to do. If you can already see a problem with the plan, that is exactly the kind of feedback we want during the transition period. We cannot promise support for every workflow, but we will do our best to help.

---

#### Why not just keep the current server online?
The current setup has served us well, but it was never meant to be the forever home for a public service. We would rather move it carefully, with warning, than keep stretching the current setup until it becomes a problem.

---

#### Where should I send transition questions or feedback?
Email **checkfaceml@gmail.com**. GitHub issues are still useful for bugs in the **checkface** project that powers facemorph.me, but transition questions and workflow concerns are easier for us to handle over email.
