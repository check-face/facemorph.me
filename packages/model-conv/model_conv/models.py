"""Declarations of the checkpoints model-conv supports: architecture, shapes, limits and tolerances.

A declaration is fixed before any run. `verify` judges a conversion against the tolerance declared here,
never one chosen afterwards. Only declared models convert; anything else is refused by key.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Tolerance:
    raw_float: float      # max absolute error on raw pre-uint8 network output
    rgb: int              # max channel difference on 0-255 after the legacy uint8 conversion
    w_plus: float | None = None  # encoders only


@dataclass(frozen=True)
class ModelDeclaration:
    key: str
    architecture: str
    conditional: bool
    resolution: int
    channels: int
    z_dim: int
    w_dim: int
    source_format: str
    source_sha256: str
    source_url: str
    licence: str
    truncation_psi: float
    truncation_cutoff: int
    opset: int
    tolerance: Tolerance
    chunk_bytes: int = 16 * 1024 * 1024
    operators: tuple = field(default=())

    @property
    def num_ws(self) -> int:
        # StyleGAN2 synthesis: two W per resolution from 4 px plus one for the last toRGB.
        return 2 * (self.resolution.bit_length() - 1) - 2

    def noise_shapes(self) -> list[list[int]]:
        """One constant noise plane per synthesis conv layer: b4 has conv1 only, every later block conv0 and conv1."""
        shapes = [[4, 4]]
        size = 8
        while size <= self.resolution:
            shapes += [[size, size], [size, size]]
            size *= 2
        return shapes

    def io_shapes(self) -> dict:
        return {
            'mapping': {'inputs': {'z': [1, self.z_dim]}, 'outputs': {'w': [1, self.num_ws, self.w_dim]}},
            'synthesis': {
                'inputs': {'w': [1, self.num_ws, self.w_dim], **{f'noise_{i}': s for i, s in enumerate(self.noise_shapes())}},
                'outputs': {'image': [1, self.channels, self.resolution, self.resolution]},
            },
            'average': [self.w_dim],
        }


FFHQ_CONFIG_F = ModelDeclaration(
    key='stylegan2-ffhq-config-f',
    architecture='stylegan2',
    conditional=False,
    resolution=1024,
    channels=3,
    z_dim=512,
    w_dim=512,
    source_format='tf1-pickle',
    source_sha256='adf127ea7bb8a7788c8bdeda3c9937f7310b669b09ecf799ca53a631ff46948d',
    source_url='https://nvlabs-fi-cdn.nvidia.com/stylegan2/networks/stylegan2-ffhq-config-f.pkl',
    licence='NVIDIA Source Code License-NC (StyleGAN2); FFHQ dataset CC BY-NC-SA 4.0',
    truncation_psi=0.7,
    truncation_cutoff=8,
    opset=17,
    # Frozen synthesis tolerances (PLAN.md synthesis correctness): never widened.
    tolerance=Tolerance(raw_float=0.002, rgb=1),
)

MODELS = {m.key: m for m in [FFHQ_CONFIG_F]}


def declaration(key: str) -> ModelDeclaration:
    if key not in MODELS:
        raise KeyError(f'{key!r} is not a declared model; declared: {", ".join(sorted(MODELS))}')
    return MODELS[key]
