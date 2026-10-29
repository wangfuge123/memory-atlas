"""Verified Windows portable distribution; never copy personal memories."""
import argparse
import hashlib
import json
import shutil
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'resources.lock.json').read_text())['resources']


def download(key):
    spec = LOCK[key]
    dest = ROOT / 'runtime' / 'downloads' / spec['archive']
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest() != spec['sha256']:
        print('Downloading ' + spec['url'], flush=True)
        with urllib.request.urlopen(spec['url'], timeout=120) as response:
            raw = response.read()
        if hashlib.sha256(raw).hexdigest() != spec['sha256']:
            raise ValueError('SHA256 mismatch: ' + key)
        dest.write_bytes(raw)
    return dest


def dependencies():
    for key, folder, prefixes in [
        ('three', 'three', ('package/build/three.module.js', 'package/examples/jsm/', 'package/LICENSE', 'package/package.json')),
        ('vision', 'mediapipe', ('package/vision_bundle.mjs', 'package/wasm/', 'package/README.md', 'package/package.json')),
    ]:
        target = ROOT / 'vendor' / folder
        with tarfile.open(download(key)) as archive:
            for entry in archive:
                if not entry.isfile() or not any(entry.name == x or x.endswith('/') and entry.name.startswith(x) for x in prefixes):
                    continue
                relative = Path(entry.name).relative_to('package')
                output = (target / relative).resolve()
                if not output.is_relative_to(target.resolve()):
                    raise ValueError('Unsafe archive path')
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(archive.extractfile(entry).read())
    model = ROOT / 'vendor/models/hand_landmarker.task'
    model.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(download('hand_model'), model)
    shutil.copyfile(download('vision_license'), ROOT / 'vendor/mediapipe/LICENSE')
    records = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in sorted((ROOT / 'vendor').rglob('*')) if p.is_file() and p.name != 'checksums.json'}
    (ROOT / 'vendor/checksums.json').write_text(json.dumps(records, indent=2) + '\n')
    print('Verified and prepared local browser dependencies.', flush=True)


def runtime():
    target = ROOT / 'runtime/python'
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(download('python')) as archive:
        for entry in archive.infolist():
            output = (target / entry.filename).resolve()
            if not output.is_relative_to(target.resolve()):
                raise ValueError('Unsafe runtime path')
        for entry in archive.infolist():
            if entry.is_dir() or entry.filename.endswith('._pth'):
                continue
            output = target / entry.filename
            raw = archive.read(entry)
            output.parent.mkdir(parents=True, exist_ok=True)
            if not output.exists() or output.read_bytes() != raw:
                output.write_bytes(raw)
    # Embedded Python uses an isolated search path: explicitly include our app.
    (target / 'python313._pth').write_text('python313.zip\n.\n..\\..\n', encoding='ascii')
    (target / '.archive-sha256').write_text(LOCK['python']['sha256'], encoding='ascii')
    return target


def build():
    dependencies()
    runtime()
    files = ['index.html', 'start.bat', 'build-release.bat', 'start-server.ps1', 'gen-manifest.bat', '.gitignore', '.gitattributes',
             'gen-manifest.ps1', 'serve.py', 'local_library.py', 'resources.lock.json',
             'README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE']
    folders = ['css', 'js', 'data/maps', 'sample-photos', 'vendor', 'scripts', 'runtime/python', 'tests', 'docs']
    output = ROOT / 'dist/memory-atlas-windows-x64.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in [ROOT / x for x in files]:
            archive.write(path, 'memory-atlas/' + path.relative_to(ROOT).as_posix())
        for folder in folders:
            for path in sorted((ROOT / folder).rglob('*')):
                if path.is_file() and '__pycache__' not in path.parts and not path.name.endswith('.pyc') and '.original.' not in path.name:
                    archive.write(path, 'memory-atlas/' + path.relative_to(ROOT).as_posix())
        photos = ['sample-photos/' + p.name for p in sorted((ROOT / 'sample-photos').glob('*.png'))]
        archive.writestr('memory-atlas/images-manifest.js', 'export const IMAGE_FILES = ' + json.dumps(photos) + ';\n')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(digest + '  ' + output.name + '\n')
    source = ROOT / 'dist/memory-atlas-source.zip'
    with zipfile.ZipFile(output) as complete, zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for entry in complete.infolist():
            if not entry.filename.startswith('memory-atlas/runtime/'):
                archive.writestr(entry, complete.read(entry))
    source.with_suffix('.zip.sha256').write_text(hashlib.sha256(source.read_bytes()).hexdigest() + '  ' + source.name + '\n')
    print(str(output) + '\nSHA256: ' + digest)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dependencies', action='store_true')
    parser.add_argument('--runtime', action='store_true')
    args = parser.parse_args()
    if args.dependencies:
        dependencies()
    elif args.runtime:
        runtime()
    else:
        build()

