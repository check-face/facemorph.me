"""Output manifest: digests, sizes, chunk plan and shape metadata for one conversion. Pure functions.

The layout matches what the candidate runtime manifest names for the face model (mapping, synthesis in
16 MiB content-addressed chunks, average W, 17 constant noise planes, noiseSha256 over the noise digests),
so hosting can publish it without reshaping.
"""
import hashlib
import re

from .models import ModelDeclaration

SCHEMA = 'facemorph-model-conv-v1'
# The producer-facing model manifest major (@facemorph/browser-model-manager
# schema/model-manifest.v1.schema.json), which every manifest written here validates against.
MANIFEST_SCHEMA_MAJOR = 1
HEX64 = re.compile(r'^[0-9a-f]{64}$')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def chunk_plan(size: int, chunk_bytes: int) -> list[tuple[int, int]]:
    """(offset, length) of each chunk; every chunk is full except the last."""
    if size <= 0 or chunk_bytes <= 0:
        raise ValueError('size and chunk_bytes must be positive')
    return [(at, min(chunk_bytes, size - at)) for at in range(0, size, chunk_bytes)]


def asset(name: str, data: bytes, shape: list[int] | None = None) -> dict:
    record = {'file': name, 'sha256': sha256(data), 'size': len(data)}
    if shape is not None:
        record['shape'] = shape
    return record


def chunks(data: bytes, chunk_bytes: int) -> list[dict]:
    return [{'file': f'chunks/{sha256(data[at:at + n])}.bin', 'sha256': sha256(data[at:at + n]), 'size': n} for at, n in chunk_plan(len(data), chunk_bytes)]


def noise_sha256(noise: list[dict]) -> str:
    """The candidate runtime's identity for the noise set: SHA-256 of the concatenated hex digests, in order."""
    return sha256(''.join(n['sha256'] for n in noise).encode())


def build(decl: ModelDeclaration, *, mapping: dict, synthesis: dict, synthesis_chunks: list[dict], average: dict, noise: list[dict], provenance: dict) -> dict:
    shapes = decl.io_shapes()
    return {
        'schemaVersion': MANIFEST_SCHEMA_MAJOR,
        'bundleVersion': f'model-conv-{decl.key}',
        'modelSourceSha256': decl.source_sha256,
        'schema': SCHEMA,
        'model': {
            'key': decl.key, 'architecture': decl.architecture, 'conditional': decl.conditional,
            'resolution': decl.resolution, 'channels': decl.channels, 'zDim': decl.z_dim, 'wDim': decl.w_dim, 'numWs': decl.num_ws,
            'truncationPsi': decl.truncation_psi, 'truncationCutoff': decl.truncation_cutoff, 'opset': decl.opset,
            'sourceSha256': decl.source_sha256, 'licence': decl.licence,
        },
        'mapping': {**mapping, **shapes['mapping']},
        'synthesis': {**synthesis, 'chunks': synthesis_chunks, **shapes['synthesis']},
        'average': {**average, 'shape': shapes['average']},
        'noise': noise,
        'noiseSha256': noise_sha256(noise),
        'tolerance': {'rawFloat': decl.tolerance.raw_float, 'rgb': decl.tolerance.rgb, **({'wPlus': decl.tolerance.w_plus} if decl.tolerance.w_plus is not None else {})},
        'provenance': provenance,
    }


def problems(manifest: dict, decl: ModelDeclaration) -> list[str]:
    """Everything wrong with a manifest against its declaration; empty means consistent."""
    out = []
    if manifest.get('schema') != SCHEMA:
        out.append(f'schema is not {SCHEMA}')
    if manifest.get('schemaVersion') != MANIFEST_SCHEMA_MAJOR or manifest.get('modelSourceSha256') != decl.source_sha256:
        out.append(f'model manifest identity (schemaVersion {MANIFEST_SCHEMA_MAJOR}, modelSourceSha256) is missing or wrong')
    if manifest.get('model', {}).get('key') != decl.key:
        out.append('model key does not match the declaration')
    for part in ['mapping', 'synthesis', 'average']:
        rec = manifest.get(part, {})
        if not HEX64.match(str(rec.get('sha256', ''))) or not isinstance(rec.get('size'), int) or rec['size'] <= 0:
            out.append(f'{part}: missing digest or size')
    shapes = decl.io_shapes()
    for part in ['mapping', 'synthesis']:
        for side in ['inputs', 'outputs']:
            if manifest.get(part, {}).get(side) != shapes[part][side]:
                out.append(f'{part} {side} differ from the declared shapes')
    if manifest.get('average', {}).get('shape') != shapes['average'] or manifest.get('average', {}).get('size') != 4 * decl.w_dim:
        out.append('average is not one float32 W')
    noise = manifest.get('noise', [])
    declared = decl.noise_shapes()
    if [n.get('shape') for n in noise] != declared:
        out.append(f'noise shapes differ from the {len(declared)} declared planes')
    for n, shape in zip(noise, declared):
        if n.get('size') != 4 * shape[0] * shape[1]:
            out.append(f"{n.get('file')}: size is not float32 {shape}")
    if noise and manifest.get('noiseSha256') != noise_sha256(noise):
        out.append('noiseSha256 does not match the noise digests')
    synth = manifest.get('synthesis', {})
    plan = synth.get('chunks', [])
    if sum(c.get('size', 0) for c in plan) != synth.get('size'):
        out.append('synthesis chunks do not add up to its size')
    if any(c.get('size', 0) > decl.chunk_bytes for c in plan) or any(c.get('size') != decl.chunk_bytes for c in plan[:-1]):
        out.append('synthesis chunks do not follow the declared chunk size')
    return out
