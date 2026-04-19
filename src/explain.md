## What is this?
This is a fun experiment to generate and morph faces online.
Type something in both text boxes and click morph to generate a video morphing between them.

Not sure what to type?
Pick from a list of popular baby names with [names.facemorph.me](https://names.facemorph.me/)

<!-- openChangeMode function is in index.html -->
You can even upload your own images by clicking
<a href="#" role="button" onclick="return openChangeMode();">"Change Mode"</a>
in the textbox. Mix photos online for free.

Merging faces is also easy. After uploading photos of the faces to merge, click "Morph" and then tick "Use Slider" to pick how much of the two faces contribute to the combined face.

## How does it work?

The text in each text box is used to [seed](https://en.wikipedia.org/wiki/Random_seed) a random number generator
for each endpoint. [StyleGan2](https://github.com/NVlabs/stylegan2) is used to generate every frame while interpolating
between the endpoints.

When you upload your own images, [encoder4editing](https://github.com/omertov/encoder4editing) is used to encode it as a latent.
It attempts to find a balance between accuracy and editability.
This tradeoff means it won't look quite the same as the input
image but should work well for morphing.

<div id="learn-more-transition"></div>

## Retirement and transition

facemorph.me is now in retirement planning mode and the current goal is to retire the existing always-on service by **June 20, 2026 (AEST)**.

The point of this page is to explain the process before anything major changes.
The current site is still online while we document the service, audit historic hashes and cached outputs, and test lower-cost ways to keep the important parts alive after the current Triton-backed deployment is retired.

### Why this is happening

The present deployment depends on an aging GPU and container stack that is getting harder and more expensive to keep online.
That stack has been useful for a long time, but it is no longer a good forever-home for a public always-on service.

We want to avoid a bad outcome where the old stack simply becomes too expensive or brittle and then disappears without warning.
The goal here is to document the service properly, preserve what matters most, and move users onto a lower-cost path in a more deliberate way.

### What we are trying to preserve

- historic checkfaces that users already rely on
- the ability to match historic hashes where we can verify exact preservation
- a usable replacement path for people who still want to generate faces after the current machine is retired
- enough documentation that people can understand what changed and, if necessary, run their own copy locally in future

### What is happening now

Right now we are still in the planning and documentation stage.
That means:

- the current site stays up while we investigate
- we are inventorying old cached outputs and historic hash behavior
- we are working out which results can be preserved exactly and which may need a slower replacement path
- we expect to use `testing.facemorph.me` as the place for candidate replacements before changing the main site
- we are looking at Hugging Face as the most likely low-cost home for at least part of the future service

### What may change later

We expect the post-transition service to be more explicit about tradeoffs than the current setup.
Depending on what we prove during the investigation, that may mean:

- slower on-demand generation instead of a permanently warm GPU service
- sign-in via Hugging Face for some compute-heavy workflows
- archived historic outputs being served directly, rather than regenerated every time
- a replacement API surface that is similar to today's API, or a documented move onto Hugging Face-native equivalents
- some older or more expensive flows being documented for self-hosting rather than kept online as a public free service

### The planned process

1. Document the current Triton deployment, data layout, and existing public behavior.
2. Audit the historic hashes, cached outputs, and model/version boundaries so we know what "preservation" really means.
3. Prototype lower-cost replacements, most likely using Hugging Face for authentication and at least some generation or archive-serving duties.
4. Publish test builds and placeholder flows on `testing.facemorph.me` so users can try them before production changes.
5. Publish final retirement details only after we understand what can be preserved exactly, what will be slower, and what will need to change.
6. Retire the old always-on service once the replacement path and archive story are documented well enough to stand on their own.

### What is not promised yet

We do **not** want to overstate what is solved.
At this stage we are still validating the details, so we are **not** yet promising:

- exact parity for every uncached request
- the same performance profile as the current server
- indefinite uptime for the current API
- that every current workflow will survive unchanged

### API users

The current API will eventually need to be retired along with the current machine.
Before that happens, we intend to document the likely replacement path clearly.

The most likely direction is that the API stops being a public always-on service on our own GPU box and becomes one of:

- a Hugging Face-backed replacement
- a thinner compatibility layer in front of a Hugging Face workflow
- a more limited preservation endpoint for historic content, with newer generation handled separately

That work is still being scoped.
If you depend on the API, the main thing to expect right now is more documentation, a testing surface, and advance notice before the old endpoint is shut down.

### Before you contact us

Please read this page first.
If you still have a workflow that you need preserved after reading it, email the address in the footer and explain the exact path you rely on.

For transition questions and preservation feedback, please use email rather than GitHub issues.

## FAQ

#### Is facemorph.me being retired?
Yes.
The current goal is to retire the existing always-on service by **June 20, 2026 (AEST)**, but this page exists specifically so the process is documented before that happens.

#### Is anything changing today?
Not yet in a major way.
The current site is still online while we document the existing service, investigate historic hash preservation, and prepare a testing surface for whatever comes next.

#### What should API users expect?
The current Triton-hosted API is not intended to remain the long-term public service.
Before that changes, we intend to document the replacement direction clearly, publish a testing surface, and give advance notice rather than simply switching it off.

#### Are these real people?
Images based on text input or numeric seeds are not really people. They are randomly generated.

Custom images may be encodings of real people.

---

#### How does what I type affect the face?
There is no correlation between what you type and the generated faces, other than that the same text will always generate the same face.

---

#### Why does the intermediate face have glasses (or any other feature) even though neither endpoints have glasses?
Generally the intermediate faces are a pretty good mix between the endpoints, but sometimes you'll notice it adds
glasses or frowns or transitions old-young-old or any other feature.

The model trained to generate images has no concept of human features and has just learned to generate images that
perceptually look like faces based on a set of numbers. Although StyleGan2 does have a concept of perceptual path length,
it has no guidance on how to represent features internally. It just happens that optimising for generating convincing images
also coincides with having gradients for many of the features we would expect.

TL;DR: nobody really knows.

---

#### Why is there a creepy second face?
The dataset that the model was trained on has a small number of images that have a second face in the photo.
Enough images for it to learn to sometimes generate a second face, but not enough to learn how to make it realistic.

For an example, try <code>alice</code>

---

#### Why are there more women than men?
The model was trained on the [Flickr-Faces-HQ dataset](https://github.com/NVlabs/ffhq-dataset).
> The images were crawled from [Flickr](https://www.flickr.com/), thus inheriting all the biases of that website

---

#### How many faces are possible?

Practically limitless.

Well, it depends how you count. For example, when you take two distinct faces and morph between them,
there is usually no distinct point where you can say "now it's a different face".
Do you count each frame as a different face?

Technically, as SHA-256 is used on the input, that puts an upper limit of 2^256 on the number of
**endpoints** based on text values.

---

#### Can I morph with a picture of a real face?
Yes!

In the input textbox there is a button to
<a href="#" role="button" onclick="return openChangeMode();">change mode</a>
and upload an image.


---

#### Is there a StyleGAN2 API?
The source code for our server is at [github.com/check-face/checkface](https://github.com/check-face/checkface)
It is documented at [checkface.facemorph.me/api](https://checkface.facemorph.me/api)
<!-- or at https://github.com/check-face/checkface/blob/master/docs/api.md -->

We recommended hosting the server yourself as we do not plan on running it reliably or indefinitely.
Feel free to contact us using the email address in the footer.
