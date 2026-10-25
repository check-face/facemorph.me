"""The local artifact server and staging use the same policy as the Node preview server."""
import json
from pathlib import Path
POLICY = json.loads((Path(__file__).resolve().parents[2] / 'hosting/next-static/headers.json').read_text())


def headers_for(path):
    result = {}
    for pattern, headers in POLICY.items():
        if (path.startswith(pattern[:-1]) if pattern.endswith('*') else path == pattern):
            result.update(headers)
    return result


def headers_text():
    return ''.join(pattern + '\n' + ''.join(f'  {key}: {value}\n' for key, value in headers.items())
                   for pattern, headers in POLICY.items())


def serve(directory, port):
    """Static preview with the publication policy and SPA fallback, without runtime downloads."""
    import functools
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import urlsplit

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

        def end_headers(self):
            for name, value in headers_for(urlsplit(self.path).path).items():
                self.send_header(name, value)
            super().end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            if (not Path(path).suffix and 'text/html' in self.headers.get('Accept', '')
                    and not Path(self.translate_path(path)).is_file()):
                self.path = '/index.html'
            super().do_GET()

    ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=str(directory))).serve_forever()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    serve(args.directory, args.port)
