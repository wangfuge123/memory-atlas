"""Build architecture-specific Mac ZIPs on macOS, preserving Unix permissions."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import stat
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_release', ROOT / 'scripts/prepare-release.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def write(archive, path):
    name = 'memory-atlas/' + path.relative_to(ROOT).as_posix()
    if path.is_symlink():
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, os.readlink(path))
    else:
        archive.write(path, name)


def build(arch):
    if platform.system() != 'Darwin':
        raise RuntimeError('Build Mac packages on a Mac or the macOS CI runners.')
    prepare.dependencies()
    runtime = ROOT / 'runtime' / ('macos-' + arch)
    runtime.mkdir(parents=True, exist_ok=True)
    with tarfile.open(prepare.download('python_macos_' + arch)) as source:
        source.extractall(runtime, filter='data')
    output = ROOT / 'dist' / f'memory-atlas-macos-{arch}.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for filename in prepare.PUBLIC_FILES:
            if filename.endswith(('.bat', '.ps1')):
                continue
            write(archive, ROOT / filename)
        for folder in prepare.PUBLIC_FOLDERS + ['runtime/macos-' + arch]:
            for path in sorted((ROOT / folder).rglob('*')):
                if (path.is_file() or path.is_symlink()) and '__pycache__' not in path.parts and not path.name.endswith('.pyc') and '.original.' not in path.name:
                    write(archive, path)
        photos = ['sample-photos/' + p.name for p in sorted((ROOT / 'sample-photos').glob('*.png'))]
        archive.writestr('memory-atlas/images-manifest.js', 'export const IMAGE_FILES = ' + json.dumps(photos) + ';\n')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(digest + '  ' + output.name + '\n')
    print(output, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['arm64', 'x64'], required=True)
    build(parser.parse_args().arch)
