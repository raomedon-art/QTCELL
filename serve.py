"""Local preview with isolation headers for multi-core, on-device AI audio."""
import argparse
import importlib.util
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

voice = None


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def local_request(self):
        host = self.headers.get('Host', '')
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        origin = self.headers.get('Origin')
        return host in allowed and (origin is None or origin == 'http://' + host) and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def do_GET(self):
        if not self.local_request():
            self.send_error(403)
            return
        path = unquote(urlsplit(self.path).path)
        if path == '/api/voice/status':
            body = json.dumps({'available': voice is not None, 'ready': voice is not None and voice.engine is not None}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif 'native-deps' in path.split('/') or path.endswith(('.py', '.pyc')):
            self.send_error(404)
        else:
            super().do_GET()

    def do_POST(self):
        if not self.local_request():
            self.send_error(403)
            return
        if urlsplit(self.path).path != '/api/voice' or voice is None:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096 or self.headers.get_content_type() != 'application/json':
                self.send_error(400)
                return
            request = json.loads(self.rfile.read(length))
            wav, elapsed, seconds = voice.synthesize(request.get('text'), request.get('voice'))
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(wav)))
            self.send_header('X-Voice-Generation-Ms', str(round(elapsed * 1000)))
            self.send_header('X-Voice-Seconds', str(seconds))
            self.send_header('X-Voice-Threads', str(voice.threads))
            self.end_headers()
            self.wfile.write(wav)
        except (ValueError, TypeError, AttributeError):
            self.send_error(400)
        except TimeoutError:
            self.send_error(503)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            self.send_error(503, 'Local voice engine unavailable')

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        # Model cache remains managed by the reader; code changes revalidate.
        if self.path.split('?')[0].endswith(('.html', '.js', '.mjs')) or self.path == '/':
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--directory', default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()
    try:
        from native_voice import NativeVoice
        if importlib.util.find_spec('onnxruntime'):
            voice = NativeVoice(args.directory)
            def warmup():
                try:
                    voice.load()
                    print('Local native voice ready', flush=True)
                except Exception as error:
                    print(f'Native voice warmup failed: {type(error).__name__}', flush=True)
            threading.Thread(target=warmup, daemon=True).start()
    except ImportError:
        pass
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=args.directory)) as server:
        print(f'Local preview: http://127.0.0.1:{args.port}', flush=True)
        server.serve_forever()
