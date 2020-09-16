## What is this?
This is a fun experiment to generate and morph faces.
Type something in both text boxes and click morph to generate a video morphing between them.

## How does it work?
None of the faces you see are real

The text in each text box is used to [seed](https://en.wikipedia.org/wiki/Random_seed) a random number generator
for each endpoint. [StyleGan2](https://github.com/NVlabs/stylegan2) is used to generate every frame while interpolating
between the endpoints.

<!-- To make the start face, the text in the first text box is [hashed](https://en.wikipedia.org/wiki/Hash_function)
to essentially turn it into a large number. The hash value is then
used as the [seed](https://en.wikipedia.org/wiki/Random_seed) for a random number generator,
and a list of 512 pseudo-random numbers are generated.

[StyleGan2](https://github.com/NVlabs/stylegan2)
is used to generate all images.
Something about stylegan, checkface, interpolation, and a link to more detailed explaination
The more jargon and buzz words the better (not) -->

## FAQ

#### Are these real people?
No.

#### How does what I type affect the face?
There is no correllation between what you type and the generated faces, other than that the same text will always generate the same face.

#### Why does the intermediate face have glasses (or any other feature) even though neither endpoints have glasses?
Generally the intermediate faces are a pretty good mix between the endpoints, but sometimes you'll notice it adds
glasses or frowns or transitions old-young-old or any other feature.

The model trained to generate images has no concept of human features and has just learned to generate images that
perceptually look like faces based on a set of numbers. Although StyleGan2 does have a concept of perceptual path length,
it has no guidance on how to represent features internally. It just happens that optimising for generating convincing images
also coincides with having gradients for many of the features we would expect.

TL;DR: nobody really knows.

#### Why is there a creepy second face?
The dataset that the model was trained on has a small number of images that have a second face in the photo.
Enough images for it to learn to sometimes generate a second face, but not enough to learn how to make it realistic.

For an example, try "a".

#### Why are there more women than men?
The model was trained on the [Flickr-Faces-HQ dataset](https://github.com/NVlabs/ffhq-dataset).
"The images were crawled from [Flickr](https://www.flickr.com/), thus inheriting all the biases of that website"

#### Wow, this is really fast! What's the setup?
Everything is served from cache with Cloudflare or generated on the fly with an RTX 2080 Ti.

#### Why is this so slow?
We're students doing an experiment. We don't have the means to spin up extra infrastructure if this gets popular.
GPUs are expensive!

If you have a bunch of GPUs and would like to help, please get in touch.

#### It's not working at all...
Again, this is just an experiment and we make no commitment to keeping the servers up. We might be developing new features
or training new models. 