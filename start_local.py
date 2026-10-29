"""Portable local launcher: manifest, service discovery, browser and logs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.parse import quote
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def generate_manifest(root=ROOT):
    suffixes = {'.jpg', '.jpeg', '.png', '.webp'}
    demo = root / 'demo-photos'
    demo.mkdir(exist_ok=True)
    photos = sorted((p for p in demo.iterdir() if p.is_file() and p.suffix.lower() in suffixes), key=lambda p: p.name.casefold())
    if not photos:
        sample = root / 'sample-photos'
        photos = sorted(sample.glob('*.png')) if sample.exists() else []
    paths = [p.parent.name + '/' + quote(p.name, safe='') for p in photos]
    (root / 'images-manifest.js').write_text('export const IMAGE_FILES = ' + json.dumps(paths, ensure_ascii=False) + ';\n', encoding='utf-8')
    return paths


def read_json(url):
    with OPENER.open(url, timeout=1) as response:
        return json.load(response)


def healthy(port, root=ROOT):
    try:
        url = f'http://127.0.0.1:{port}'
        health = read_json(url + '/__sphere_health')
        expected = hashlib.sha256(str(root).encode('utf-8')).hexdigest()
        return (health.get('project') == expected and health.get('ready') and
                health.get('storage') == 'filesystem' and health.get('apiVersion') == 1 and
                Path(read_json(url + '/api/library')['path']) == root / '回忆库')
    except (OSError, ValueError, KeyError):
        return False


def start(root=ROOT):
    generate_manifest(root)
    free = []
    for port in range(8000, 8011):
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
                free.append(port)
            except OSError:
                if healthy(port, root):
                    return f'http://127.0.0.1:{port}/index.html'
    if not free:
        raise RuntimeError('Ports 8000-8010 are occupied. Close an unused local service and retry.')
    logs = root / 'runtime/logs'
    logs.mkdir(parents=True, exist_ok=True)
    for port in free:
        log = logs / f'server-{port}.log'
        with log.open('ab') as stream:
            process = subprocess.Popen([sys.executable, str(root / 'serve.py'), '--port', str(port)],
                                       cwd=root, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream,
                                       start_new_session=True)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if healthy(port, root):
                return f'http://127.0.0.1:{port}/index.html'
            if process.poll() is not None:
                break
            time.sleep(.15)
        # Only terminate a process spawned by this invocation, never an unrelated listener.
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
    raise RuntimeError(f'The local service could not start. See {logs}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        url = start()
        print('Server ready: ' + url, flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        print('本地服务已在后台运行，可以关闭启动窗口。', flush=True)
    except Exception as error:
        print('启动失败：' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
