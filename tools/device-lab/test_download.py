"""download.py's decision logic, called with plain values (python3 -m unittest test_download, from this folder)."""
import argparse, unittest

from download import by_host, parse_interrupt, read_toast, retried_chunks


class ReadToast(unittest.TestCase):
    # The candidate's own strings (src/Next/Product.fs, model toast); sizes are binary megabytes.
    def test_phases_and_sizes(self):
        self.assertEqual(read_toast('Downloading the face model… 70 MB of 158 MB'), ('route', 70.0, 158.0))
        self.assertEqual(read_toast('Downloading the photo encoder… 1.0 GB of 1.1 GB Hide'), ('photo', 1024.0, 1126.4))
        self.assertEqual(read_toast('Download paused. It picks up again once this face is done. Hide'), ('waiting', None, None))
        self.assertEqual(read_toast('The download stopped. Check your connection or free up some space, then try again. '
                                    'Anything already downloaded is kept. Try again Not now'), ('failed', None, None))
        self.assertEqual(read_toast("Ready. The models are saved on this device, so you won't download them again. Hide"),
                         ('done', None, None))

    def test_offer_and_absent_toast(self):
        self.assertEqual(read_toast('Faces are made on this device. It needs the face model once (158 MB).')[0], 'idle')
        self.assertEqual(read_toast(''), ('hidden', None, None))


class ParseInterrupt(unittest.TestCase):
    def test_fraction_and_seconds(self):
        self.assertEqual(parse_interrupt('0.35:30'), (0.35, 30.0))
        self.assertEqual(parse_interrupt('0.5'), (0.5, 30.0))

    def test_out_of_range(self):
        for bad in ('0:30', '1:30', '0.4:0', '1.5'):
            with self.assertRaises(argparse.ArgumentTypeError):
                parse_interrupt(bad)


class Requests(unittest.TestCase):
    chunk = '/runtime/chunks/7c5c.bin'
    rows = [
        {'t': 1.0, 'host': 'next.facemorph.me', 'path': chunk, 'query': '', 'failure': 'net::ERR_CONNECTION_RESET', 'endT': 2.0},
        {'t': 3.0, 'host': 'models.facemorph.me', 'path': chunk, 'query': '', 'failure': 'net::ERR_CONNECTION_REFUSED', 'endT': 3.1},
        {'t': 7.1, 'host': 'next.facemorph.me', 'path': chunk, 'query': 'retry=2', 'status': 200, 'bytes': 16777216,
         'finished': True, 'endT': 8.0},
        {'t': 0.3, 'host': 'next.facemorph.me', 'path': '/516.js', 'query': '', 'status': 200, 'finished': True},
        {'t': 5.6, 'host': 'next.facemorph.me', 'path': '/516.js', 'query': '', 'status': 200, 'finished': True},
        {'t': 9.0, 'host': 'next.facemorph.me', 'path': '/runtime/assets/aa', 'query': '', 'status': 200, 'bytes': 1048576,
         'finished': True},
    ]

    def test_retried_runtime_files_with_their_final_origin(self):
        [chunk] = retried_chunks(self.rows)  # the app script loaded twice (page and worker) is not a retry
        self.assertEqual(chunk['path'], self.chunk)
        self.assertEqual(chunk['servedBy'], 'next.facemorph.me')
        self.assertEqual([a['host'] for a in chunk['attempts']], ['next.facemorph.me', 'models.facemorph.me', 'next.facemorph.me'])

    def test_never_served(self):
        [chunk] = retried_chunks(self.rows[:2])
        self.assertIsNone(chunk['servedBy'])

    def test_by_host(self):
        self.assertEqual(by_host(self.rows), {
            'next.facemorph.me': {'requests': 5, 'finishedMb': 17.0, 'failed': 1},
            'models.facemorph.me': {'requests': 1, 'finishedMb': 0.0, 'failed': 1}})


if __name__ == '__main__':
    unittest.main()
