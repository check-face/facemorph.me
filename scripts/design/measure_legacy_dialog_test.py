"""Tests of the pure helpers in measure-legacy-dialog.py with plain values (no mocks, no images).

Run: python3 -m unittest scripts/design/measure_legacy_dialog_test.py
"""
import importlib.util
import unittest
from pathlib import Path

import numpy as np

_spec = importlib.util.spec_from_file_location("measure_legacy_dialog", Path(__file__).with_name("measure-legacy-dialog.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


class ContrastTests(unittest.TestCase):
    def test_black_on_white_is_21(self):
        self.assertAlmostEqual(m.contrast_ratio((0, 0, 0), (255, 255, 255)), 21.0, places=6)

    def test_symmetric_and_identity(self):
        self.assertAlmostEqual(m.contrast_ratio((10, 80, 200), (240, 240, 240)), m.contrast_ratio((240, 240, 240), (10, 80, 200)))
        self.assertAlmostEqual(m.contrast_ratio((77, 77, 77), (77, 77, 77)), 1.0)

    def test_known_material_pair(self):
        # white on #3F51B5 is 6.87:1 (hand-computed from the WCAG formula)
        self.assertAlmostEqual(round(m.contrast_ratio((255, 255, 255), (0x3F, 0x51, 0xB5)), 2), 6.87)

    def test_hex_roundtrip(self):
        self.assertEqual(m.to_hex((63, 81, 181)), "#3F51B5")
        self.assertEqual(m.from_hex("#3F51B5"), (63, 81, 181))

    def test_darken_to_contrast_reaches_target(self):
        out = m.darken_to_contrast((245, 0, 87), (255, 255, 255), 4.5)
        self.assertGreaterEqual(m.contrast_ratio(out, (255, 255, 255)), 4.5)
        self.assertLessEqual(max(out), 245)

    def test_composite(self):
        self.assertEqual(m.composite((255, 255, 255), (0, 0, 0), 0.5), (127.5, 127.5, 127.5))


class BoxTests(unittest.TestCase):
    def test_box_to_fractions(self):
        # box (110,60)-(210,80) in a modal whose top-left is (10,20) and width 200
        self.assertEqual(m.box_to_fractions((110, 60, 210, 80), (10, 20), 200), {"x": 0.5, "y": 0.2, "w": 0.5, "h": 0.1})

    def test_rounding_to_four_decimals(self):
        self.assertEqual(m.box_to_fractions((0, 0, 1, 1), (0, 0), 3)["w"], 0.3333)

    def test_point_and_centre(self):
        self.assertEqual(m.point_to_fractions((60, 70), (10, 20), 100), {"x": 0.5, "y": 0.5})
        self.assertEqual(m.box_centre((0, 0, 4, 10)), (2.0, 5.0))

    def test_viewport_comparability(self):
        f = m.box_to_fractions((50, 0, 150, 40), (0, 0), 200)
        self.assertEqual(round(f["w"] * 390), 195)
        self.assertEqual(round(f["w"] * 1280), 640)


class SegmentationTests(unittest.TestCase):
    def setUp(self):
        # 20x30 grey canvas with two same-colour squares, one odd pixel and one indigo block
        self.a = np.full((20, 30, 3), 53, np.uint8)
        self.a[2:6, 3:7] = (255, 255, 255)
        self.a[10:14, 20:24] = (255, 255, 255)
        self.a[0, 29] = (255, 255, 255)
        self.a[15:19, 2:12] = (63, 81, 181)

    def test_colour_mask_exact_and_tolerance(self):
        self.assertEqual(int(m.colour_mask(self.a, (255, 255, 255), 0).sum()), 33)
        self.assertEqual(int(m.colour_mask(self.a, (250, 250, 250), 5).sum()), 33)
        self.assertEqual(int(m.colour_mask(self.a, (250, 250, 250), 4).sum()), 0)

    def test_components_boxes_and_min_area(self):
        comps, _ = m.components(m.colour_mask(self.a, (255, 255, 255), 0), min_area=4)
        self.assertEqual([c[0] for c in comps], [(3, 2, 7, 6), (20, 10, 24, 14)])
        self.assertEqual([c[1] for c in comps], [16, 16])

    def test_largest_component(self):
        box, area, mask = m.largest_component(m.colour_mask(self.a, (63, 81, 181), 0))
        self.assertEqual((box, area, int(mask.sum())), ((2, 15, 12, 19), 40, 40))

    def test_bbox_of_mask_with_offset_and_empty(self):
        mask = np.zeros((5, 5), bool)
        mask[1:3, 2:4] = True
        self.assertEqual(m.bbox_of_mask(mask, (10, 100)), (12, 101, 14, 103))
        with self.assertRaises(AssertionError):
            m.bbox_of_mask(np.zeros((3, 3), bool))

    def test_mode_and_median_colour(self):
        self.assertEqual(m.mode_colour(self.a), (53, 53, 53))
        self.assertEqual(m.median_colour(np.array([[0, 0, 0], [10, 20, 30], [20, 40, 60]])), (10.0, 20.0, 30.0))

    def test_runs_and_merge_gap(self):
        flags = [0, 1, 1, 0, 1, 0, 0, 0, 1]
        self.assertEqual(m.runs(flags), [(1, 3), (4, 5), (8, 9)])
        self.assertEqual(m.runs(flags, min_gap=2), [(1, 5), (8, 9)])

    def test_ellipse_fit_recovers_parameters(self):
        t = np.linspace(0, 2 * np.pi, 90, endpoint=False)
        cx, cy, a, b = m.fit_axis_aligned_ellipse(50 + 30 * np.cos(t), 80 + 45 * np.sin(t))
        for got, want in zip((cx, cy, a, b), (50, 80, 30, 45)):
            self.assertAlmostEqual(got, want, places=6)


if __name__ == "__main__":
    unittest.main()
