import struct
import unittest
import zlib

from model_conv import canaries


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def png(rows, bpp, filters):
    """An 8-bit RGB(A) PNG of `rows` (lists of bytes), each row encoded with its filter type."""
    width = len(rows[0]) // bpp
    out, prior = b'', bytes(len(rows[0]))
    for row, kind in zip(rows, filters):
        enc = bytearray()
        for i, x in enumerate(row):
            a = row[i - bpp] if i >= bpp else 0
            b, c = prior[i], prior[i - bpp] if i >= bpp else 0
            pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][kind]
            enc.append((x - pred) & 255)
        out += bytes([kind]) + bytes(enc)
        prior = row
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    ihdr = struct.pack('>IIBBBBB', width, len(rows), 8, 2 if bpp == 3 else 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(out)) + chunk(b'IEND', b'')


class Canaries(unittest.TestCase):
    def test_png_decoder_handles_every_filter(self):
        rows = [bytes((x * 37 + y * 11 + c * 101) & 255 for x in range(5) for c in range(3)) for y in range(5)]
        self.assertEqual(canaries.decode_png(png(rows, 3, [0, 1, 2, 3, 4])).tolist(),
                         [[list(r[x * 3:x * 3 + 3]) for x in range(5)] for r in rows])
        rgba = [bytes((x * 13 + y * 7 + c) & 255 for x in range(3) for c in range(4)) for y in range(2)]
        self.assertEqual(canaries.decode_png(png(rgba, 4, [4, 3])).shape, (2, 3, 4))
        with self.assertRaises(ValueError):
            canaries.decode_png(b'not a png')

    def test_product_output_pipeline(self):
        import numpy as np
        raw = np.array([[[[-1.0, 1.0, 0.0, 5.0]], [[0.004, -0.004, 1.0 - 1e-7, -5.0]], [[0.5, -0.5, 0.0, 0.0]]]], dtype=np.float32)
        # trunc(clamp(fround(fround(v*127.5)+128))): 0, 255, 128, 255 | 128, 127, 255, 0 | 191, 64, 128, 128
        self.assertEqual(canaries.product_rgb(raw).tolist(), [[[0, 128, 191], [255, 127, 64], [128, 255, 128], [255, 0, 128]]])

    def test_frozen_gates(self):
        self.assertEqual((canaries.MAX_RGB, canaries.MAX_FLOAT), (1, 0.002))


if __name__ == '__main__':
    unittest.main()
