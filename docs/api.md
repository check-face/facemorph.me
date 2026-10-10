# Self-hosted FaceMorph API

This reference describes the historical API served by `self-host/`, including
the original FaceMorph UI bundled with it. The current `next.facemorph.me`
frontend performs inference locally and does **not** require this API.
Follow the [Docker setup](../self-host/README.md) first. Examples use your own
instance at `http://localhost:8080`; no account or API key is required.

## Face inputs

Single-face routes accept `value` (UTF-8 text), `seed` (integer 0–4294967295), or
`guid` (saved UUID from this installation). Supply one; if multiple are present,
`guid` takes precedence over `seed`, then `value`. With none, the input is empty
text. Text uses the original SHA-256 → NumPy random-state mapping; numeric seeds
use the original NumPy random state. Saved GUIDs belong to this installation's
Mongo database, so a GUID from the public site won't resolve automatically.

Morph routes take two inputs with prefixes: `from_value`/`from_seed`/`from_guid`
and `to_value`/`to_seed`/`to_guid`. You can mix kinds, including uploaded photos.

`/api/face/` and `/api/hashdata/` also accept the existing weighted blend:
`num_multi=1..16`, then `value0`/`seed0`/`guid0`, `value1`/`seed1`/`guid1`, etc.
`amount0`, `amount1`, etc. default to `1/num_multi` and clamp to [-2, 2]. Mixed
Z/W+ inputs are resolved to W+ before blending. These are weighted sums; amounts
are not automatically normalized. This API has no figure-eight/custom-path mode.

## GET /api/face/

Generate or retrieve a cached face. `dim` is the square output dimension, 10–1024,
default 300. `format=webp` returns WebP; the default/other values return JPEG.
Generation uses the original StyleGAN2 FFHQ config-F checkpoint, constant noise,
and truncation psi 0.7/cutoff 8 for Z inputs. Saved W+ is synthesized directly.
All faces are synthesized at 1024px before resizing, even with a smaller `dim`.

```sh
curl --fail 'http://localhost:8080/api/face/?seed=0&dim=512' --output face.jpg
curl --fail --get --data-urlencode 'value=hello world' \
  --data 'dim=256&format=webp' http://localhost:8080/api/face/ --output face.webp
curl --fail 'http://localhost:8080/api/face/?num_multi=2&seed0=0&seed1=1&amount0=0.5&amount1=0.5' --output blend.jpg
```

`GET /api/<text>` is the original shorthand: a 300px JPEG from a single path
segment. Use `/api/face/?value=...` for general text and URL-encode it.

## GET /api/hashdata/

Return the resolved latent as JSON. Z inputs return `{"qlatent": [...]}` (512
numbers); W+ inputs return `{"dlatent": [[...], ...]}` (18×512). A numeric-seed
input also returns `seed`; a text input returns its hexadecimal SHA-256 as `hash`.
This endpoint returns latents, not image bytes.

```sh
curl --fail 'http://localhost:8080/api/hashdata/?seed=0'
```

## POST /api/registerlatent/

Send JSON with `Content-Type: application/json` and a `latent` field containing
512 finite numbers (Z) or 18 arrays of 512 finite numbers (W+). Shape determines
the type; no `type` field is required. The response is a plain-text UUID.

This example retrieves a real Z vector, registers it, then generates its image:

```sh
curl --fail 'http://localhost:8080/api/hashdata/?seed=0' --output latent.json
python3 -c 'import json; print(json.dumps({"latent": json.load(open("latent.json"))["qlatent"]}))' > register.json
guid=$(curl --fail -H 'Content-Type: application/json' \
  --data-binary @register.json http://localhost:8080/api/registerlatent/)
curl --fail "http://localhost:8080/api/face/?guid=$guid&dim=512" --output saved.jpg
```

Python is used only for this JSON example; the Docker service itself needs no
host Python. Your client can construct the JSON body in any language.

## POST /api/encodeimage/

Upload a photo as multipart field `usrimg`. `tryalign=true` attempts dlib face
alignment; omitted/other values mean false. e4e encodes the image into W+ and
stores it. If no suitable face is found, the original unaligned image is encoded.
The response is JSON, for example:

```json
{"did_align": true, "guid": "54fec40f-12c4-4333-951b-6bc1d2d074b9"}
```

```sh
curl --fail -F usrimg=@photo.jpg -F tryalign=true \
  http://localhost:8080/api/encodeimage/
```

Use the returned `guid` in face/morph requests. Repeating the same photo bytes
and alignment setting returns the same saved record. Uploads have a 16 MiB
request limit; decoded images have a pixel limit of 8192×4096.
`GET /api/encodeimage/` serves a small upload form.

## GET /api/morphframe/

Return one JPEG frame between the `from_*` and `to_*` inputs.

| Parameter | Default | Range/meaning |
| --- | --- | --- |
| `dim` | 300 | 10–1024 px |
| `num_frames` | 50 | 3–200 |
| `frame_num` | 0 | 0 through `num_frames - 1` |
| `linear` | false | `true`: start to end inclusive; otherwise sinusoidal start → end → start loop |

```sh
curl --fail 'http://localhost:8080/api/morphframe/?from_seed=0&to_seed=1&num_frames=3&frame_num=1&linear=true&dim=256' --output midpoint.jpg
```

## GET /api/gif/, /api/webp/, /api/mp4/

Return a looping animation between `from_*` and `to_*` inputs. GIF/WebP return
animated images; MP4 returns video. These routes use the sinusoidal schedule,
not `linear`. Generated outputs are cached.

| Parameter | Default | Range/meaning |
| --- | --- | --- |
| `dim` | 300 | 10–1024 px; even dimensions recommended for MP4 |
| `num_frames` | 50 | 3–200 |
| `fps` | 16 | 1–100 |
| `kbitrate` | 2400 | MP4 only, 100–20000 kilobits/sec |
| `embed_html` | false | MP4 only: `true` returns an HTML page with an embedded looping video |

```sh
curl --fail 'http://localhost:8080/api/mp4/?from_seed=0&to_seed=1&dim=256&num_frames=4&fps=16' --output morph.mp4
curl --fail 'http://localhost:8080/api/webp/?from_value=hello&to_value=world&dim=256&num_frames=4' --output morph.webp
curl --fail 'http://localhost:8080/api/gif/?from_seed=0&to_seed=1&dim=256&num_frames=4' --output morph.gif
```

## GET /api/linkpreview/

Return a JPEG composite with the start, end and midpoint faces and original
branding. Uses `from_*`/`to_*`; `width` is 100–2400, default 1200. Height scales
from the original 1200×628 layout.

```sh
curl --fail 'http://localhost:8080/api/linkpreview/?from_seed=0&to_seed=1&width=1200' --output preview.jpg
```

## Status and UI routes

| Route | Response |
| --- | --- |
| `GET /healthz` | Readiness JSON; HTTP 200 when ready, 503 otherwise. Includes `provider` (`cpu`/`cuda`), runtime, queue and original-cache counters; CUDA adds GPU name/capability/version. |
| `GET /status/` | Empty HTTP 200 liveness response. Use `/healthz` for readiness. |
| `GET /api/queue/` | `{"queue": 0}` with the current queue length. |
| `GET /` and static paths | Bundled original UI with same-origin API requests. |
| `GET /oembed.json?url=...` | Original UI photo/embed metadata. `format=json` is the default; `maxwidth` and `maxheight` default to 512, range 50–1024. |

## Errors, caching and persistence

Malformed input returns 400; an unknown saved GUID returns 404; oversized uploads
return 413. The retained numeric dimension/frame/fps/bitrate parser falls back to
its default when a value is missing, invalid or outside its range. Boolean flags
are true only for the string `true` (case-insensitive).

The existing bounded generation admission returns 503 with `Retry-After: 1`
when capacity is occupied. This is a concurrency bound, not per-client rate
limiting. Retry later. Expensive requests can take time; use generous client/proxy
timeouts. Internal generation/FFmpeg failures return 500. Media responses support
HTTP caching, including conditional requests returning 304.

Model, Mongo and generated-media volumes survive container restarts and
`docker compose down`. `docker compose down --volumes` deletes them. Fresh
installations have no public-site latent records. CPU/CUDA and software versions
can introduce small numeric differences; historical image-byte parity is not a
guarantee. The API has no authentication; the [self-host guide](../self-host/README.md)
explains binding, SSH forwarding and reverse-proxy options.
