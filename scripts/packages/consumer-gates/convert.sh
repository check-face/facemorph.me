#!/usr/bin/env bash
# Release-only input for the existing external consumer gate. Never uploads weights.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
out=$(realpath -m "${1:?output directory required}")
checkpoints="${FACEMORPH_CHECKPOINTS:-$HOME/.cache/facemorph-model-conv/checkpoints}"
checkpoint="$checkpoints/stylegan2-ffhq-config-f.pkl"
mkdir -p "$out" "$checkpoints"
if [ ! -f "$checkpoint" ]; then
  curl -fL --retry 2 --max-time 600 \
    -o "$checkpoint.partial-$$" \
    https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl
  mv "$checkpoint.partial-$$" "$checkpoint"
fi
printf '%s  %s\n' adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d "$checkpoint" \
  | sha256sum -c - | tee "$out/acquire.log"
docker build --iidfile "$out/image-id" "$root/packages/model-conv" > "$out/build.log" 2>&1
image=$(cat "$out/image-id")
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
container="pearl-package-converter-${GITHUB_RUN_ID:-local}-$$"
trap 'docker stop --time 5 "$container" >/dev/null 2>&1 || true' EXIT
run_converter() {
  docker run --rm --name "$container" --user "$(id -u):$(id -g)" \
    -e "MODEL_CONV_IMAGE=facemorph/model-conv@$image" \
    -v "$checkpoints:/checkpoints:ro" -v "$out:/out" "$image" "$@"
}
run_converter convert --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq \
  > "$out/convert.log" 2>&1
run_converter verify --checkpoint /checkpoints/stylegan2-ffhq-config-f.pkl --out /out/ffhq \
  > "$out/verify.log" 2>&1
docker run --rm --name "$container" --user "$(id -u):$(id -g)" \
  -e "MODEL_CONV_IMAGE=facemorph/model-conv@$image" \
  -v "$checkpoints:/checkpoints:ro" -v "$out:/out" \
  -v "$root/scripts/packages/consumer-gates:/script:ro" --entrypoint python "$image" \
  /script/make-reference.py /checkpoints/stylegan2-ffhq-config-f.pkl /out/ffhq/reference \
  > "$out/reference.log" 2>&1
