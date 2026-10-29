import hashlib
import json
from pathlib import Path
import re
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class DistributionTests(unittest.TestCase):
    def test_vendor_checksums(self):
        checks = json.loads((ROOT / 'vendor/checksums.json').read_text())
        self.assertGreater(len(checks), 10)
        for name, digest in checks.items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), digest, name)

    def test_no_remote_runtime_imports(self):
        for name in ['index.html', 'js/gestures.js', 'js/gesture-worker.js']:
            source = (ROOT / name).read_text(encoding='utf-8')
            self.assertNotRegex(source, r'https://(?:unpkg|cdn\.jsdelivr|storage\.googleapis)')
        self.assertTrue((ROOT / 'vendor/models/hand_landmarker.task').stat().st_size > 1000000)

    def test_embedded_runtime_and_license(self):
        self.assertIn('..\\..', (ROOT / 'runtime/python/python313._pth').read_text())
        self.assertTrue((ROOT / 'runtime/python/LICENSE.txt').is_file())
        self.assertTrue((ROOT / 'vendor/mediapipe/LICENSE').is_file())
        self.assertTrue((ROOT / 'vendor/three/LICENSE').is_file())

    def test_release_excludes_private_data(self):
        archive = ROOT / 'dist/memory-atlas-windows-x64.zip'
        self.assertTrue(archive.exists(), 'Build release before running distribution tests')
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            for name in names:
                self.assertNotRegex(name, r'(?:^|/)(?:回忆库|demo-photos|test-results|\.claude|downloads|__pycache__)(?:/|$)')
                self.assertNotIn('original.js', name)
            self.assertIn('memory-atlas/runtime/python/python.exe', names)
            self.assertIn('memory-atlas/vendor/models/hand_landmarker.task', names)
            source = package.read('memory-atlas/images-manifest.js').decode()
            files = json.loads(re.search(r'IMAGE_FILES = (.*);', source)[1])
            self.assertEqual(len(files), 12)
            for file in files:
                self.assertTrue(file.startswith('sample-photos/'))
                self.assertIn('memory-atlas/' + file, names)
        expected = archive.with_suffix('.zip.sha256').read_text().split()[0]
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), expected)


if __name__ == '__main__':
    unittest.main()
