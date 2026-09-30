## A note about the facemorph.me API

The current facemorph.me API is now scheduled to retire on **October 25, 2026 (AEST)**.

We have pushed this back from the original June date. Part of that is popular demand — a lot of people asked us for more time — and part of it is that we want to properly sit with the feedback we have had rather than rush the change. We would rather move slowly and get it right.

facemorph.me itself is not going away. What is changing is the current API and the way the checkface backend is hosted today.

The goal is to keep the main experience available without depending on a server we pay for and maintain by hand. The path we have settled on is a **new experience that runs in your browser**, which you can try today at **[next.facemorph.me](https://next.facemorph.me)**. It is still in testing, and classic facemorph.me stays as it is while we do that.

This is the direction we are working toward:

- keep facemorph.me online
- retire the current API in its current form
- move face generation onto your own device, so there is no server to keep alive
- preserve the workflows people actually use where we can
- document what changes, what stays, and which alternatives still make sense

Nothing changes overnight. We are in the transition period now, and the new experience is where we are collecting feedback before any broader change. We know some workflows will get harder. If you think this breaks a use case people care about, we would like to hear about it.

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

#### What is the new experience?
It is a new version of facemorph.me at **[next.facemorph.me](https://next.facemorph.me)**, built to look and work like the site you know. The difference is where the work happens: face generation runs on your own device, in your browser, instead of on our server. It is a test, not a replacement yet.

---

#### What can it do today?
Generate faces from seeds and names, and morph between them with the familiar controls, including figure-eight and ellipse paths through several faces. You can also add your own photos, which are cropped and processed on your device. Morphs can be saved or shared as an image or an MP4. The names gallery is part of it too, with all of the names from names.facemorph.me.

---

#### Why does it run in the browser?
Because that is the part we can keep online for as long as people want it. There is no GPU server to pay for, patch or eventually switch off. The cost of that choice is that your device does the work.

---

#### Does the first visit take a while?
Yes. The models have to come to your device before they can run, and the photo tools are larger than the face generator, so the first visit downloads a lot. We start fetching them early, while you are still choosing what to make, and keep them so that later visits are fast. If your browser cannot store them, the site tells you rather than quietly downloading them again. Use Wi-Fi if you can.

---

#### Will it work on my phone or older computer?
Often, but not everywhere yet. It uses your graphics hardware through WebGPU where the device supports it, and falls back to the processor where it does not. The fallback works but is much slower, and the site says on screen when that is happening. Phones have the least memory, so they are the least certain. That is a large part of why we are testing.

---

#### Do my photos leave my device?
No. Photos you add are cropped and processed on your device. Nothing is sent to us to generate your result.

---

#### Does the new experience collect anything?
Yes, two things. It uses Google Analytics to count visits, which features get used, how jobs end and how long they take, and a rough device class. When a job fails, it records the kind of failure and the step it failed at. It never includes your photos, the words you type, your faces or videos, or error messages, and advertising features are turned off. It counts nothing if your browser sends Do Not Track or Global Privacy Control.

Separately, diagnostics with more device detail stay on your device until you say yes, and they are deleted after 30 days. Generation works the same with either turned off.

---

#### Do I need an account?
No. There is no sign-in, no ads and no charge, same as classic.

---

#### What about the old links and my old results?
Preserving them comes first. We are working on keeping historic results and links reachable before the current API is retired, and we will not shut anything down until that is ready. We have not yet promised that every old result will look exactly the same in the new experience, and we will say plainly what has and has not moved.

---

#### Did you consider hosting it somewhere else, such as Hugging Face?
We looked at Hugging Face and other hosted options while we were working out the next step, and earlier versions of this page named Hugging Face as the leading candidate. We did not go with it. The new experience does not use Hugging Face for hosting, sign-in or generation.

---

#### Are you still exploring other options?
Some things are still open, especially how well it runs on small devices and how we keep old results available. We would rather test in the open than claim it is finished.

---

#### Will there still be a local or offline path?
Partly. Once the models are on your device, the new experience does not need our server to generate faces. We also intend to document ways to run parts of the workflow yourself.

---

#### Will the API stay exactly the same?
No. The current API is being retired in its current form. The new experience does not offer a drop-in replacement for it, so if you build on the API, please email us and describe what you need.

---

#### I think this may break something I use. What should I do?
Email us at **checkfaceml@gmail.com** and tell us what you are trying to do. If you can already see a problem with the plan, that is exactly the kind of feedback we want during the transition period. We cannot promise support for every workflow, but we will do our best to help.

---

#### Why not just keep the current server online?
The current setup has served us well, but it was never meant to be the forever home for a public service. We would rather move it carefully, with warning, than keep stretching the current setup until it becomes a problem.

---

#### Where should I send transition questions or feedback?
Email **checkfaceml@gmail.com**. GitHub issues are still useful for bugs in the **checkface** project that powers facemorph.me, but transition questions and workflow concerns are easier for us to handle over email.
