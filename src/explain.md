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

## FAQ

---

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

We recommented hosting the server yourself as we do not plan on running it reliably or indefinitely.
Feel free to contact us using the email address in the footer.
