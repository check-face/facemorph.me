#!/usr/bin/env bash
# model-conv acceptance on a CPU worker (fm-uh14), with the real checkpoint and the real container:
# build, convert, verify, repeat/force, output ownership, perturbed chunk, wrong checkpoint, killed run,
# and the image/package scan. Run from a clean clone: packages/model-conv/tests/acceptance.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CHECKPOINTS=${CHECKPOINTS:-$HOME/.cache/facemorph-model-conv/checkpoints}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/model-conv-acceptance.XXXXXX")
trap 'docker rm -f model-conv-killed >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
CKPT=stylegan2-ffhq-config-f.pkl
SHA=adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "checkpoint (acquired by the caller; checked against the declared SHA-256)"
mkdir -p "$CHECKPOINTS"
if [ ! -f "$CHECKPOINTS/$CKPT" ]; then
  curl -fL --retry 3 -o "$CHECKPOINTS/$CKPT.part" "https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/$CKPT"
  mv "$CHECKPOINTS/$CKPT.part" "$CHECKPOINTS/$CKPT"
fi
echo "$SHA  $CHECKPOINTS/$CKPT" | sha256sum -c -

step "build"
docker build -q -t facemorph/model-conv . >/dev/null
IMAGE=$(docker image inspect --format '{{.Id}}' facemorph/model-conv)
echo "image $IMAGE"
run() {
  docker run --rm --user "$(id -u):$(id -g)" -e MODEL_CONV_IMAGE="facemorph/model-conv@$IMAGE" \
    -v "$CHECKPOINTS":/checkpoints:ro -v "$WORK":/out facemorph/model-conv "$@"
}

step "convert into an empty output"
run convert --checkpoint /checkpoints/$CKPT --out /out/ffhq
[ -f "$WORK/ffhq/manifest.json" ] || fail "no manifest after convert"
grep -q "\"image\": \"facemorph/model-conv@$IMAGE\"" "$WORK/ffhq/manifest.json" || fail "manifest does not record the image"

step "manifest validates against the producer-facing model manifest schema (@facemorph/browser-model-manager)"
npx --yes ajv-cli@5.0.0 validate --spec=draft2020 -s ../browser-model-manager/schema/model-manifest.v1.schema.json \
  -d "$WORK/ffhq/manifest.json" --errors=text || fail "manifest does not validate against model-manifest.v1.schema.json"

step "outputs are owned by the invoking UID:GID"
bad=$(find "$WORK/ffhq" \( ! -uid "$(id -u)" -o ! -gid "$(id -g)" \) | head -1)
[ -z "$bad" ] || fail "$bad is not owned by $(id -u):$(id -g)"

step "verify against the upstream reference"
run verify --checkpoint /checkpoints/$CKPT --out /out/ffhq
grep -q '"module": "/opt/upstream/stylegan2-ada-pytorch/legacy.py"' "$WORK/ffhq/verify.json" || fail "reference is not the upstream module"
grep -q "\"checkpointSha256\": \"$SHA\"" "$WORK/ffhq/verify.json" || fail "reference did not read the original checkpoint"

step "repeat convert refuses to overwrite a complete output; --force rebuilds it"
before=$(sha256sum "$WORK/ffhq/manifest.json")
if run convert --checkpoint /checkpoints/$CKPT --out /out/ffhq 2>/dev/null; then fail "repeat convert overwrote a complete output"; fi
[ "$before" = "$(sha256sum "$WORK/ffhq/manifest.json")" ] || fail "refused repeat changed the output"
run convert --checkpoint /checkpoints/$CKPT --out /out/ffhq --force
[ -f "$WORK/ffhq/manifest.json" ] || fail "forced rebuild left no manifest"

step "a perturbed chunk fails verify"
cp -r "$WORK/ffhq" "$WORK/perturbed"
chunk=$(ls "$WORK/perturbed/chunks" | head -1)
python3 -c 'import sys; p=sys.argv[1]; b=bytearray(open(p,"rb").read()); b[len(b)//2]^=1; open(p,"wb").write(b)' "$WORK/perturbed/chunks/$chunk"
if run verify --checkpoint /checkpoints/$CKPT --out /out/perturbed; then fail "verify passed a perturbed chunk"; fi
grep -q "$chunk: missing or digest mismatch" "$WORK/perturbed/verify.json" || fail "verify did not name the perturbed chunk"

step "a wrong checkpoint is refused before loading"
mkdir -p "$WORK/wrong" && head -c 1000 /dev/urandom > "$WORK/wrong/$CKPT"
if docker run --rm --user "$(id -u):$(id -g)" -v "$WORK/wrong":/checkpoints:ro -v "$WORK":/out facemorph/model-conv \
     verify --checkpoint /checkpoints/$CKPT --out /out/ffhq 2>"$WORK/wrong.log"; then fail "verify accepted a wrong checkpoint"; fi
grep -q "is not the declared" "$WORK/wrong.log" || fail "wrong checkpoint not refused by digest"

step "a killed conversion leaves nothing labelled complete; the next run clears its staging"
docker run -d --name model-conv-killed --user "$(id -u):$(id -g)" -v "$CHECKPOINTS":/checkpoints:ro -v "$WORK":/out \
  facemorph/model-conv convert --checkpoint /checkpoints/$CKPT --out /out/killed >/dev/null
for _ in $(seq 1 60); do compgen -G "$WORK/.partial-killed-*" >/dev/null && break; sleep 0.5; done
sleep 3
docker kill model-conv-killed >/dev/null
docker rm model-conv-killed >/dev/null
[ ! -e "$WORK/killed/manifest.json" ] || fail "killed run left a complete manifest"
compgen -G "$WORK/.partial-killed-*" >/dev/null || fail "killed run left no staging to show the interruption"
run convert --checkpoint /checkpoints/$CKPT --out /out/killed 2>"$WORK/rerun.log"
grep -q "removed incomplete staging" "$WORK/rerun.log" || fail "stale staging not removed"
[ -f "$WORK/killed/manifest.json" ] || fail "rerun after kill did not complete"
if compgen -G "$WORK/.partial-killed-*" >/dev/null; then fail "staging left after a complete run"; fi

step "no weights, credentials or generated artifacts in the image or the package tree"
found=$(docker run --rm --entrypoint sh facemorph/model-conv -c \
  "find / -xdev \( -name '*.pkl' -o -name '*.pt' -o -name '*.pth' -o -name '*.onnx' -o -name '*.ckpt' -o -name '*.safetensors' -o -name '.env' \) 2>/dev/null" \
  | grep -v '/site-packages/' || true)
[ -z "$found" ] || fail "weight-like files in the image: $found"
# The planted e4e qualification tensors (256 px inputs and recorded W+, tests/e4e-qualification/) are allowed only
# by digest: each must be listed with its SHA-256 in that directory's report.json.
planted=$(python3 -c "import json; r=json.load(open('tests/e4e-qualification/report.json')); print('\n'.join(f'{c[k]}  tests/e4e-qualification/{c[f]}' for c in r['cases'] for k, f in (('inputSha256', 'inputFile'), ('referenceSha256', 'referenceFile'))))")
echo "$planted" | sha256sum -c --quiet - || fail "a planted e4e qualification tensor does not match report.json"
tree=$(git ls-files --others --cached --exclude-standard . | grep -E '\.(pkl|pt|pth|onnx|ckpt|safetensors|f32|bin)$|(^|/)\.env' \
  | grep -vxF -f <(echo "$planted" | awk '{print $2}') || true)
[ -z "$tree" ] || fail "weight-like files in the package tree: $tree"

echo
echo "model-conv acceptance passed (image $IMAGE)"
