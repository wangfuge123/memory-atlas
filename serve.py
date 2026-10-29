"""Local-only application server and filesystem memory library."""
import argparse
import hashlib
import json
import mimetypes
from urllib.parse import urlsplit
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from local_library import Library

ROOT = Path(__file__).resolve().parent
PROJECT_ID = hashlib.sha256(str(ROOT).encode('utf-8')).hexdigest()


class Handler(SimpleHTTPRequestHandler):
    def json_response(self, body, status=200):
        raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def local_request(self):
        host = self.headers.get('Host', '')
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if host not in allowed:
            raise PermissionError('只允许本机访问回忆库')
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + host:
            raise PermissionError('不允许其他网站访问回忆库')
        if self.headers.get('Sec-Fetch-Site', 'none') not in ('none', 'same-origin'):
            raise PermissionError('不允许其他网页跨站访问回忆库')

    def do_GET(self):
        if self.path == '/__sphere_health':
            body = json.dumps({'project': PROJECT_ID, 'ready': True, 'storage': 'filesystem', 'apiVersion': 1,
                               'libraryPath': str(self.server.library.root)}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        route = urlsplit(self.path).path
        if route.startswith('/api/'):
            try:
                self.local_request()
                if route == '/api/library':
                    self.json_response({'path': str(self.server.library.root), 'storage': 'filesystem', 'version': 1})
                elif route == '/api/albums':
                    self.json_response(self.server.library.albums())
                elif route.startswith('/api/photos/'):
                    parts = route.split('/')
                    if len(parts) != 6:
                        raise FileNotFoundError('照片地址无效')
                    path = self.server.library.photo(*parts[3:])
                    raw = path.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
                    self.send_header('Content-Length', str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                else:
                    self.json_response({'error': '接口不存在'}, 404)
            except PermissionError as e:
                self.json_response({'error': str(e)}, 403)
            except (FileNotFoundError, StopIteration):
                self.json_response({'error': '照片不存在'}, 404)
            except (ValueError, KeyError) as e:
                self.json_response({'error': str(e)}, 400)
            except OSError as e:
                self.json_response({'error': '读取回忆库失败：' + str(e)}, 500)
            return
        if self.in_library():
            self.send_error(403, 'Use the library API to access photos')
            return
        super().do_GET()

    def in_library(self):
        return Path(self.translate_path(self.path)).resolve().is_relative_to(self.server.library.root)

    def do_HEAD(self):
        if self.in_library():
            self.send_error(403)
            return
        super().do_HEAD()

    def do_POST(self):
        try:
            self.local_request()
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('请使用 JSON 提交回忆')
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 1024 * 1024 * 1024:
                raise ValueError('本次提交过大，请减少照片数量后重试')
            data = json.loads(self.rfile.read(length))
            route = urlsplit(self.path).path
            if route == '/api/albums':
                self.server.library.save(data.get('albums'))
            elif route == '/api/albums/delete':
                self.server.library.delete(data.get('id'))
            else:
                self.json_response({'error': '接口不存在'}, 404)
                return
            self.json_response({'ok': True})
        except PermissionError as e:
            self.json_response({'error': str(e)}, 403)
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            self.json_response({'error': str(e)}, 400)
        except OSError as e:
            self.json_response({'error': '保存回忆库失败：' + str(e)}, 500)

    def end_headers(self):
        # Changes to module imports and workers must be visible after refresh.
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--library', type=Path, default=ROOT / '回忆库')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    server.library = Library(args.library)
    print(f'Serving {ROOT} at http://127.0.0.1:{args.port}/index.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
