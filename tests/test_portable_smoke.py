"""Exercise a relocated complete ZIP with only Windows system tools on PATH.

Leaves the test server running for browser inspection. The JSON report records
its isolated folder and URL; maintainers should stop this test server afterward.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
temporary = Path(tempfile.mkdtemp(prefix='Memory Atlas 分发验收 '))
source_mode = '--source' in sys.argv
with zipfile.ZipFile(ROOT / ('dist/memory-atlas-source.zip' if source_mode else 'dist/memory-atlas-windows-x64.zip')) as archive:
    archive.extractall(temporary)
project = temporary / 'memory-atlas'
environment = os.environ.copy()
system = Path(environment.get('SystemRoot') or environment['SYSTEMROOT']) / 'System32'
environment['PATH'] = str(system)
environment.pop('PYTHONPATH', None)
environment.pop('PYTHONHOME', None)
environment.pop('PSModulePath', None)
environment.pop('PSMODULEPATH', None)
command = [str(system / 'WindowsPowerShell/v1.0/powershell.exe'), '-NoLogo', '-NoProfile',
           '-ExecutionPolicy', 'Bypass', '-File', str(project / 'start-server.ps1'), '-NoBrowser']
with (temporary / 'startup.out.log').open('wb') as stdout, (temporary / 'startup.err.log').open('wb') as stderr:
    result = subprocess.run(command, cwd=temporary, env=environment, stdin=subprocess.DEVNULL,
                            stdout=stdout, stderr=stderr, timeout=100)
output = (temporary / 'startup.out.log').read_bytes().decode(errors='replace')
if result.returncode:
    error = (temporary / 'startup.err.log').read_bytes().decode(errors='replace')
    match = re.search(r'See ([^\r\n]+?\.err\.log)', error)
    if match and Path(match[1]).is_file():
        error += '\nSERVER LOG:\n' + Path(match[1]).read_text(encoding='utf-8', errors='replace')[-6000:]
    raise RuntimeError(error + output)
url = re.search(r'Server ready: (http://127\.0\.0\.1:\d+)/index.html', output)[1]
def get(path):
    with urllib.request.urlopen(url + path, timeout=10) as response:
        return response.read()
assert json.loads(get('/api/albums')) == []
assert Path(json.loads(get('/api/library'))['path']) == project / '回忆库'
assert b'vendor/three' in get('/index.html')
assert get('/sample-photos/landscape-01.png').startswith(b'\x89PNG')
assert len(get('/vendor/models/hand_landmarker.task')) > 1000000
assert not (project / 'demo-photos').exists() or not list((project / 'demo-photos').iterdir())
report = {'project': str(project), 'url': url, 'path': environment['PATH'],
          'result': 'PASS: relocated Chinese/space path, embedded runtime, empty personal library, local assets and sample images'}
(ROOT / 'test-results').mkdir(exist_ok=True)
(ROOT / ('test-results/source-smoke.json' if source_mode else 'test-results/portable-smoke.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True, indent=2))
