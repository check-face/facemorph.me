"""Isolated loopback codec screen; uses frozen source copies and pinned live runtime assets."""
import http.server
from pathlib import Path
import sys
import urllib.parse
ROOT=Path(__file__).resolve().parents[3]
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def translate_path(self,path):
        route=urllib.parse.urlparse(path).path
        for lane in ['control','candidate']:
            prefix=f'/source-{lane}/'
            if route.startswith(prefix):
                base=(ROOT/'autoresearch/state/direct-rgba-source-v1'/lane).resolve()
                target=(base/urllib.parse.unquote(route[len(prefix):])).resolve()
                if target.is_relative_to(base): return str(target)
                return str(base/'nonexistent')
        return super().translate_path(path)
    def do_GET(self):
        if self.path=='/runtime/manifest.json':
            self.send_response(302);self.send_header('Location','https://next.facemorph.me/runtime/manifest.json');self.end_headers();return
        super().do_GET()
    def log_message(self,*args): pass
Handler.extensions_map['.mjs']='text/javascript'
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),Handler).serve_forever()
