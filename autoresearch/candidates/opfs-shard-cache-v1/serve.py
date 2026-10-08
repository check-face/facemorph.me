#!/usr/bin/env python3
"""Local bench server: <root> (a facemorph.me tree) over plain HTTP on 127.0.0.1 (a secure context),
cross-origin isolated like the product, with this candidate directory mounted at /bench/.
Assets come from next.facemorph.me (CORS *, CORP cross-origin).  serve.py <port> [root]"""
import http.server, os, pathlib, sys, urllib.parse
HERE = pathlib.Path(__file__).resolve().parent
ROOT = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else HERE.parents[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def translate_path(self, path):
        p = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if p.startswith('/bench/'): return str(HERE / p[len('/bench/'):])
        if p.startswith('/ort/'):   # local onnxruntime-web releases: /ort/<version>/<file> -> $ORT_PKGS/<version>/package/dist/<file>
            v, _, f = p[len('/ort/'):].partition('/')
            return str(pathlib.Path(os.environ.get('ORT_PKGS', '')) / v / 'package/dist' / f)
        return super().translate_path(path)
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
H.extensions_map['.mjs'] = 'text/javascript'
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
