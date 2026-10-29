import base64
import copy
import functools
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from urllib.parse import quote
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_library import Library
from serve import Handler, ROOT

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO7sAAAAASUVORK5CYII=')
IMAGE = 'data:image/png;base64,' + base64.b64encode(PNG).decode()


def fixture(key='test-album'):
    return {'id': key, 'title': '本地回忆测试', 'place': '测试地点', 'date': '2026-10-27',
            'note': '测试中文文字', 'cityCode': '370200', 'countyCode': '370211', 'point': [120.18, 35.96],
            'photos': [{'id': 'photo-one', 'name': '中文照片.png', 'data': IMAGE, 'thumbnail': IMAGE}]}


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.lib = Library(Path(self.tmp.name) / '回忆库')

    def tearDown(self):
        self.tmp.cleanup()

    def test_files_and_restart(self):
        self.lib.save([fixture()])
        folder = self.lib.root / 'albums/test-album'
        self.assertEqual((folder / 'originals/photo-one.png').read_bytes(), PNG)
        self.assertEqual((folder / 'thumbnails/photo-one.png').read_bytes(), PNG)
        meta = json.loads((folder / 'album.json').read_text(encoding='utf-8'))
        self.assertEqual(meta['note'], '测试中文文字')
        self.assertNotIn('data', meta['photos'][0])
        restarted = Library(self.lib.root)
        self.assertEqual(restarted.albums()[0]['photos'][0]['original'], '/api/photos/test-album/photo-one/original')
        self.assertEqual(json.loads((self.lib.root / 'library.json').read_text(encoding='utf-8'))['albums'][0]['id'], 'test-album')

    def test_delete_recycles_whole_album(self):
        self.lib.save([fixture(), fixture('keep-album')])
        self.lib.delete('test-album')
        self.assertEqual([a['id'] for a in self.lib.albums()], ['keep-album'])
        trash = list((self.lib.root / '回收站').iterdir())
        self.assertEqual(len(trash), 1)
        self.assertEqual((trash[0] / 'originals/photo-one.png').read_bytes(), PNG)
        self.assertTrue((trash[0] / 'album.json').is_file())
        self.lib.delete('test-album')

    def test_invalid_batch_does_not_partially_save(self):
        bad = fixture('bad'); bad['photos'][0]['data'] = 'data:image/png;base64,not-an-image'
        with self.assertRaises(ValueError):
            self.lib.save([fixture(), bad])
        self.assertEqual(self.lib.albums(), [])
        self.assertEqual(list((self.lib.root / '.staging').iterdir()), [])

    def test_overwrite_and_invalid_overwrite_preserves_existing(self):
        self.lib.save([fixture()])
        updated = fixture(); updated['title'] = '更新后'
        self.lib.save([updated])
        bad = fixture(); bad['point'] = [999, 1]
        with self.assertRaises(ValueError): self.lib.save([bad])
        self.assertEqual(self.lib.albums()[0]['title'], '更新后')

    def test_index_failure_rolls_back(self):
        self.lib.save([fixture()])
        self.lib._index = lambda: (_ for _ in ()).throw(OSError('模拟磁盘写入失败'))
        with self.assertRaises(OSError): self.lib.delete('test-album')
        self.assertEqual(len(self.lib.albums()), 1)
        updated = fixture(); updated['title'] = '不应写入'
        with self.assertRaises(OSError): self.lib.save([updated])
        self.assertEqual(self.lib.albums()[0]['title'], '本地回忆测试')

    def test_path_traversal_rejected(self):
        for key in ('../outside', 'a/b', 'a\\b', '..', ''):
            with self.assertRaises(ValueError): self.lib.delete(key)
        data = fixture(); data['photos'][0]['id'] = '../../escape'
        with self.assertRaises(ValueError): self.lib.save([data])


class QuietHandler(Handler):
    def log_message(self, *args): pass


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'tests')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        self.server.library = Library(Path(self.tmp.name) / '回忆库')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.thread.join(); self.server.server_close(); self.tmp.cleanup()

    def request(self, path, payload=None, headers=None, method=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.url + quote(path), data=data, headers=headers or ({'Content-Type': 'application/json'} if data else {}), method=method)
        return urllib.request.urlopen(req)

    def test_api_roundtrip_and_deleted_photo_inaccessible(self):
        with self.request('/api/albums', {'albums': [fixture()]}) as r: self.assertEqual(r.status, 200)
        with self.request('/api/albums') as r: self.assertEqual(json.load(r)[0]['title'], '本地回忆测试')
        with self.request('/api/photos/test-album/photo-one/original') as r: self.assertEqual(r.read(), PNG)
        with self.request('/api/library') as r: self.assertEqual(json.load(r)['storage'], 'filesystem')
        with self.request('/api/albums/delete', {'id': 'test-album'}) as r: self.assertEqual(r.status, 200)
        with self.assertRaises(urllib.error.HTTPError) as error: self.request('/api/photos/test-album/photo-one/original')
        self.assertEqual(error.exception.code, 404)

    def test_cross_origin_and_non_json_writes_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/albums', {'albums': [fixture()]}, {'Origin':'http://another-site.example','Content-Type':'application/json'})
        self.assertEqual(error.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/albums', {'albums': [fixture()]}, {'Content-Type':'text/plain'})
        self.assertEqual(error.exception.code, 400)
        self.assertEqual(self.server.library.albums(), [])

    def test_raw_library_and_trash_not_served(self):
        self.server.library.save([fixture()]); self.server.library.delete('test-album')
        route = '/' + (self.server.library.root.relative_to(ROOT)).as_posix() + '/library.json'
        for method in ('GET', 'HEAD'):
            with self.assertRaises(urllib.error.HTTPError) as error: self.request(route, method=method)
            self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main(verbosity=2)
