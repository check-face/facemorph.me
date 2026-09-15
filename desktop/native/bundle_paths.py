"""Resolve portable bundle assets without changing the signed manifest identity."""
from pathlib import Path, PurePosixPath
import re


def resolve_assets(bundle, root, portable=False):
    root = Path(root).resolve()
    def visit(value):
        if isinstance(value, dict):
            if 'path' in value and 'sha256' in value:
                raw = value['path']
                if not isinstance(raw, str) or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
                    raise ValueError('Invalid asset inventory')
                path = Path(raw)
                if portable or not path.is_absolute():
                    parts = PurePosixPath(raw)
                    if parts.is_absolute() or '\\' in raw or ':' in raw or '..' in parts.parts:
                        raise ValueError('Portable assets must stay inside bundle')
                    path = (root / raw).resolve()
                    if not path.is_relative_to(root):
                        raise ValueError('Asset escapes bundle')
                return {**value, 'path': str(path)}
            return {key: visit(item) for key, item in value.items()}
        if isinstance(value, list):
            return [visit(item) for item in value]
        return value
    return visit(bundle)
