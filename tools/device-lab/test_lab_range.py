"""lab.py qualify's commit range (fm-xwpw): bead IDs from plain commit messages, and the range read through the
real GitHub API on this repository's own main commits, checked against local git (python3 -m unittest
test_lab_range, from this folder; needs gh auth and network).
"""
import contextlib, io, json, subprocess, tempfile, unittest
from pathlib import Path

import lab

REPO = 'check-face/facemorph.me'
# Three commits on main, each naming a bead: 0ed2053 (fm-aa8), 8dc624c (fm-j16n, fm-aa8), bde6108 (fm-5u9).
BASE = 'a409c2880965a7891d488e110ebf8d84cca414b2'
HEAD = 'bde61086bc4df2d33436e41139256058b3eb9821'


def logged(fn, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = fn(*args)
    return result, [json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]


class BeadsIn(unittest.TestCase):
    def test_every_id_across_messages_once_sorted(self):
        msgs = ['Fix the site lane (fm-aa8)\n\nWith fm-j16n.', 'beads: fm-j16n carries it (with fm-aa8)',
                'delivery (fm-5u9, fm-fy2.4)', 'no bead here', 'xfm-nope and fm-x are not IDs']
        self.assertEqual(lab.beads_in(msgs), ['fm-5u9', 'fm-aa8', 'fm-fy2.4', 'fm-j16n'])
        self.assertEqual(lab.beads_in(msgs, ['fm-zz9', 'fm-aa8']), ['fm-5u9', 'fm-aa8', 'fm-fy2.4', 'fm-j16n', 'fm-zz9'])
        self.assertEqual(lab.beads_in([]), [])


class Range(unittest.TestCase):
    def test_a_range_of_three_bead_commits_names_all_three(self):
        msgs, events = logged(lab.commit_messages, REPO, HEAD, BASE)
        local = subprocess.run(['git', 'log', '--format=%B%x00', f'{BASE}..{HEAD}'], cwd=lab.REPO,
                               capture_output=True, text=True, check=True).stdout.split('\0')
        self.assertEqual(len(msgs), 3)
        self.assertEqual(lab.beads_in(msgs), lab.beads_in(local))
        self.assertTrue({'fm-aa8', 'fm-j16n', 'fm-5u9'} <= set(lab.beads_in(msgs)))
        self.assertEqual(events[-1], {**events[-1], 'event': 'qualify_range', 'base': BASE, 'commits': 3})

    def test_no_recorded_base_uses_the_head_commit_and_says_why(self):
        msgs, events = logged(lab.commit_messages, REPO, HEAD, None)
        self.assertEqual(lab.beads_in(msgs), ['fm-5u9'])
        self.assertEqual(events[-1]['reason'], 'no earlier qualified commit recorded')

    def test_a_base_ahead_of_the_head_falls_back_with_the_reason(self):
        msgs, events = logged(lab.commit_messages, REPO, BASE, HEAD)  # reversed: the "base" is newer
        self.assertEqual(len(msgs), 1)
        self.assertIn('compare unusable (behind)', events[-1]['reason'])

    def test_an_unknown_base_falls_back_with_the_reason(self):
        msgs, events = logged(lab.commit_messages, REPO, HEAD, '0' * 40)
        self.assertEqual(lab.beads_in(msgs), ['fm-5u9'])
        self.assertTrue(events[-1]['reason'].startswith('compare unusable'), events[-1])


class Record(unittest.TestCase):
    def test_the_tested_commit_is_recorded_per_repository(self):
        path = Path(tempfile.mkdtemp()) / 'qualified.json'
        lab.record_qualified(path, REPO, BASE)
        lab.record_qualified(path, 'check-face/facemorph.me-classic', '551b60726290b2d67a32c62477b2fd964de51f96')
        lab.record_qualified(path, REPO, HEAD)
        self.assertEqual(json.loads(path.read_text()), {REPO: HEAD, 'check-face/facemorph.me-classic':
                                                        '551b60726290b2d67a32c62477b2fd964de51f96'})


class Summary(unittest.TestCase):
    def test_the_summary_names_the_beads_it_is_evidence_for(self):
        out = Path(tempfile.mkdtemp())
        with contextlib.redirect_stdout(io.StringIO()):
            lab.summarise([{'cell': 'eris-cpu', 'ok': False, 'runs': [{'error': 'stopped'}]}], out, 'Device lab: t',
                          ['fm-5u9', 'fm-aa8', 'fm-j16n'])
        self.assertIn('Beads in the tested build: fm-5u9, fm-aa8, fm-j16n.', (out / 'summary.md').read_text())
        self.assertEqual(json.loads((out / 'summary.json').read_text())['beads'], ['fm-5u9', 'fm-aa8', 'fm-j16n'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
