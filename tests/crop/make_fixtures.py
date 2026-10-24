"""Synthetic photo fixtures for the crop-confirm loop (fm-f2rs). No personal photos: the only face is the shipped
StyleGAN 'hello' preview (apps/web/src/public/preview/hello-1024.webp, a generated face; provenance in classic
hosting/gallery/hello-provenance.md). Deterministic; rerun to regenerate: python3 tests/crop/make_fixtures.py
Needs Pillow."""
import io
import json
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = HERE / 'fixtures'
HELLO = REPO / 'apps/web/src/public/preview/hello-1024.webp'


def backdrop(width, height):
    """A face-free scene: a smooth gradient with a few hard-edged shapes."""
    image = Image.new('RGB', (width, height))
    px = image.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = (40 + 150 * x // width, 70 + 120 * y // height, 160 - 90 * x // width)
    draw = ImageDraw.Draw(image)
    draw.rectangle([width // 8, height // 6, width // 3, height // 2], fill=(200, 180, 60))
    draw.ellipse([width // 2, height // 2, width * 7 // 8, height * 7 // 8], fill=(60, 140, 90))
    draw.polygon([(width // 2, height // 10), (width * 9 // 10, height // 3), (width * 3 // 5, height // 2)], fill=(150, 60, 120))
    return image


def jpeg(image, **extra):
    buffer = io.BytesIO()
    image.save(buffer, 'JPEG', quality=90, **extra)
    return buffer.getvalue()


def main():
    OUT.mkdir(exist_ok=True)
    face = Image.open(HELLO).convert('RGB')
    files = {}
    files['no-face.jpg'] = jpeg(backdrop(512, 512))
    # Two faces inside one square, so a whole-image (square) crop holds both.
    pair = backdrop(1024, 1024)
    pair.paste(face.resize((480, 480)), (24, 272))
    pair.paste(face.resize((480, 480)).transpose(Image.Transpose.FLIP_LEFT_RIGHT), (520, 272))
    files['multi-face.jpg'] = jpeg(pair)
    # Stored rotated a quarter turn with EXIF Orientation 6 ("rotate 90 CW to display"): upright once honoured.
    exif = Image.Exif()
    exif[0x0112] = 6
    files['oriented.jpg'] = jpeg(face.resize((512, 512)).transpose(Image.Transpose.ROTATE_90), exif=exif.tobytes())
    wide = backdrop(900, 600)
    wide.paste(face.resize((420, 420)), (240, 90))
    files['non-square.jpg'] = jpeg(wide)
    files['malformed.jpg'] = files['no-face.jpg'][:2048]
    # One small face in the top-left corner of a large frame: found in the whole photo, but a centred crop at
    # zoom 2 (the middle half) holds no face, so re-detecting the confirmed crop fails.
    corner = backdrop(1024, 1024)
    corner.paste(face.resize((300, 300)), (16, 16))
    files['redetection-fails-on-confirmed-crop.jpg'] = jpeg(corner)
    manifest = {}
    for name, data in files.items():
        (OUT / name).write_bytes(data)
        manifest[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    manifest['_source'] = {'face': str(HELLO.relative_to(REPO)), 'faceSha256': hashlib.sha256(HELLO.read_bytes()).hexdigest(),
                           'note': 'synthetic only: one generated face (hello) and drawn shapes; no personal photos'}
    (OUT / 'fixtures.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: v.get('bytes') for k, v in manifest.items() if k != '_source'}))


if __name__ == '__main__':
    main()
