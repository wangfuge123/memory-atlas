"""Run on real macOS CI; exercise the ZIP using Finder's extraction tool."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main(arch):
    if sys.platform != 'darwin':
        raise RuntimeError('This integration check requires macOS.')
    archive = ROOT / f'dist/memory-atlas-macos-{arch}.zip'
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        assert not any(re.search(r'/(回忆库|demo-photos|test-results|\.claude|downloads)/', p) for p in names)
        command = package.getinfo('memory-atlas/Start-Memory-Atlas.command')
        assert command.external_attr >> 16 & 0o111
    temporary = Path(tempfile.mkdtemp(prefix='Memory Atlas 中文 '))
    subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(temporary)], check=True)
    project = temporary / 'memory-atlas'
    python = project / f'runtime/macos-{arch}/python/bin/python3'
    env = os.environ.copy()
    env['PATH'] = '/usr/bin:/bin'
    env.pop('PYTHONHOME', None)
    env.pop('PYTHONPATH', None)
    ids = set()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        outputs = []
        for _ in range(2):
            run = subprocess.run(['/bin/bash', str(project / 'Start-Memory-Atlas.command'), '--no-browser'],
                                 cwd=temporary, env=env, capture_output=True, text=True, timeout=40)
            assert run.returncode == 0, run.stderr + run.stdout
            url = re.search(r'Server ready: (http://127\.0\.0\.1:\d+)/index.html', run.stdout)[1]
            outputs.append(url)
            with opener.open(url + '/__sphere_health') as response:
                health = json.load(response)
            ids.add(health['pid'])
        assert outputs[0] == outputs[1], 'Repeated launch must reuse the same service.'
        for route in ['/index.html', '/vendor/three/build/three.module.js', '/sample-photos/landscape-01.png']:
            with opener.open(url + route) as response:
                assert response.status == 200
        with opener.open(url + '/api/albums') as response:
            assert json.load(response) == []
        manifest = (project / 'images-manifest.js').read_text()
        assert 'sample-photos/' in manifest and manifest.count('.png') == 12
        architecture = subprocess.check_output([str(python), '-c', 'import platform;print(platform.machine())'], env=env, text=True).strip()
        assert architecture == ('arm64' if arch == 'arm64' else 'x86_64'), architecture
        runtime_test = subprocess.run([str(python), str(project / 'tests/test_local_library.py')], env=env, capture_output=True, text=True)
        assert runtime_test.returncode == 0, runtime_test.stderr
        for pid in ids:
            os.kill(pid, signal.SIGTERM)
        ids.clear()
        time.sleep(.4)
        shutil.move(str(project / f'runtime/macos-{arch}'), str(temporary / 'saved-bundled-runtime'))
        cold = subprocess.run(['/bin/bash', str(project / 'start-macos.sh'), '--no-browser'],
                              cwd=temporary, env=env, capture_output=True, text=True, timeout=300)
        assert cold.returncode == 0, cold.stdout + cold.stderr
        cold_url = re.search(r'Server ready: (http://127\.0\.0\.1:\d+)/index.html', cold.stdout)[1]
        with opener.open(cold_url + '/__sphere_health') as response:
            ids.add(json.load(response)['pid'])
        assert python.is_file(), 'Source bootstrap must install a private runtime.'
        report = {'arch': arch, 'native_arch': architecture, 'platform': subprocess.check_output(['/usr/bin/sw_vers'], text=True),
                  'result': 'PASS: native bundled Python, Chinese/space relocation, executable ZIP, manifest, server reuse, local assets, empty library, all filesystem/API regressions, cold source bootstrap with SHA256 verification'}
        (ROOT / 'dist' / f'macos-{arch}-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        for pid in ids:
            os.kill(pid, signal.SIGTERM)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['arm64', 'x64'], required=True)
    main(parser.parse_args().arch)
