import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('start_local', ROOT / 'start_local.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class MacLauncherTests(unittest.TestCase):
    def test_manifest_fallback_and_unicode(self):
        with tempfile.TemporaryDirectory(prefix='atlas 地图 ') as folder:
            root = Path(folder)
            (root / 'sample-photos').mkdir()
            (root / 'sample-photos/sample.png').write_bytes(b'fixture')
            self.assertEqual(launcher.generate_manifest(root), ['sample-photos/sample.png'])
            (root / 'demo-photos/朋友 & photo.png').write_bytes(b'fixture')
            (root / 'unrelated.jpg').write_bytes(b'fixture')
            paths = launcher.generate_manifest(root)
            self.assertEqual(paths, ['demo-photos/%E6%9C%8B%E5%8F%8B%20%26%20photo.png'])
            self.assertIn(paths[0], (root / 'images-manifest.js').read_text())

    def test_pinned_runtime_bootstrap(self):
        lock = json.loads((ROOT / 'resources.lock.json').read_text(encoding='utf-8'))['resources']
        shell = (ROOT / 'scripts/macos-runtimes.sh').read_text(encoding='utf-8')
        for arch in ['arm64', 'x64']:
            resource = lock['python_macos_' + arch]
            self.assertIn(resource['url'], shell)
            self.assertIn(resource['sha256'], shell)
        start = (ROOT / 'start-macos.sh').read_text(encoding='utf-8')
        self.assertIn('shasum -a 256 -c', start)
        self.assertNotIn('xattr', start)
        self.assertNotIn('sudo', start)
        for name in ['start-macos.sh', 'Start-Memory-Atlas.command', 'scripts/macos-runtimes.sh']:
            raw = (ROOT / name).read_bytes()
            self.assertFalse(raw.startswith(b'\xef\xbb\xbf'))
            self.assertNotIn(b'\r', raw)


if __name__ == '__main__':
    unittest.main()
