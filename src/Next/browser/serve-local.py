#!/usr/bin/env python3
"""Local HTTPS artifact test server. Never use for public hosting."""
import argparse,http.server,pathlib,ssl,urllib.parse
REPO=pathlib.Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8443);p.add_argument('--assets',type=pathlib.Path,required=True);p.add_argument('--cert',required=True);p.add_argument('--key',required=True);a=p.parse_args()
class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self,path):
        path=urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if any(part.startswith('.') or part=='sources.private.json' for part in pathlib.PurePosixPath(path).parts[1:]):return str(REPO/'__forbidden__')
        if path.startswith('/runtime/'):
            root=a.assets.resolve();relative=path[len('/runtime/'):]
        elif path.startswith('/src/Next/'):
            root=REPO/'src/Next';relative=path[len('/src/Next/'):]
        elif path=='/runtime-test.html':return str(REPO/'src/Next/browser/runtime-test.html')
        else:root=REPO/'deploy-next';relative=path.lstrip('/') or 'index.html'
        target=(root/relative).resolve()
        if not target.is_relative_to(root.resolve()):return str(REPO/'__forbidden__')
        return str(target)
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin');self.send_header('Cross-Origin-Embedder-Policy','require-corp');self.send_header('Cross-Origin-Resource-Policy','same-origin');self.send_header('Cache-Control','no-store' if '/assets/' not in self.path else 'public,max-age=31536000,immutable');super().end_headers()
    def list_directory(self,path):self.send_error(403);return None
server=http.server.ThreadingHTTPServer(('127.0.0.1',a.port),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(a.cert,a.key);server.socket=ctx.wrap_socket(server.socket,server_side=True);print(f'https://localhost:{a.port}',flush=True);server.serve_forever()
