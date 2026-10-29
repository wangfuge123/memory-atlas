"""Filesystem memory library; metadata and photo files stay on this computer."""
import base64
import binascii
import json
import math
import os
import re
import shutil
import threading
import uuid
from pathlib import Path


class Library:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.lock = threading.RLock()
        for name in ('albums', '.staging', '回收站'):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        if not (self.root / 'library.json').exists():
            self._index()

    @staticmethod
    def identifier(value):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
            raise ValueError('相册或照片编号无效')
        return value

    def inside(self, path):
        path = path.resolve()
        if not path.is_relative_to(self.root):
            raise ValueError('资料路径超出回忆库')
        return path

    def _albums(self):
        result = []
        for folder in sorted((self.root / 'albums').iterdir()):
            if not folder.is_dir():
                continue
            album = json.loads(self.inside(folder / 'album.json').read_text(encoding='utf-8'))
            for p in album['photos']:
                prefix = f"/api/photos/{album['id']}/{p['id']}"
                p['url'], p['original'] = prefix + '/thumb', prefix + '/original'
            result.append(album)
        return result

    def albums(self):
        with self.lock:
            return self._albums()

    def _index(self):
        contents = {'format': 'memory-atlas-library', 'version': 1,
                    'albums': [{'id': a['id'], 'title': a['title'], 'path': f"albums/{a['id']}/album.json"} for a in self._albums()]}
        tmp = self.root / 'library.json.tmp'
        tmp.write_text(json.dumps(contents, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(tmp, self.root / 'library.json')

    @staticmethod
    def image(data):
        if not isinstance(data, str):
            raise ValueError('缺少照片数据')
        match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)', data)
        if not match:
            raise ValueError('仅支持 JPG、PNG、WebP 照片')
        try:
            raw = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('照片编码无效') from None
        kind = match[1]
        valid = (kind == 'jpeg' and raw.startswith(b'\xff\xd8\xff') or
                 kind == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n') or
                 kind == 'webp' and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP')
        if not valid:
            raise ValueError('照片内容与格式不匹配')
        return raw, {'jpeg': '.jpg', 'png': '.png', 'webp': '.webp'}[kind]

    def prepare(self, data, folder):
        key = self.identifier(data.get('id'))
        fields = {}
        for field, limit in [('title', 80), ('place', 80), ('date', 32), ('note', 2000)]:
            value = data.get(field)
            if not isinstance(value, str) or len(value) > limit:
                raise ValueError('回忆文字字段无效')
            fields[field] = value
        if not fields['title'].strip() or not fields['place'].strip():
            raise ValueError('请填写回忆标题和地点')
        for field in ('cityCode', 'countyCode'):
            if not isinstance(data.get(field), str) or not re.fullmatch(r'\d{6}', data[field]):
                raise ValueError('行政区域编号无效')
            fields[field] = data[field]
        point = data.get('point')
        if (not isinstance(point, list) or len(point) != 2 or
            not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in point) or
            abs(point[0]) > 180 or abs(point[1]) > 90):
            raise ValueError('回忆坐标无效')
        photos = data.get('photos')
        if not isinstance(photos, list) or not photos:
            raise ValueError('请至少添加一张照片')
        (folder / 'originals').mkdir(parents=True)
        (folder / 'thumbnails').mkdir()
        saved, seen = [], set()
        for photo in photos:
            pid = self.identifier(photo.get('id'))
            if pid in seen or not isinstance(photo.get('name'), str):
                raise ValueError('照片编号重复或文件名无效')
            seen.add(pid)
            raw, ext = self.image(photo.get('data'))
            thumb, thumb_ext = self.image(photo.get('thumbnail'))
            original, thumbnail = f'originals/{pid}{ext}', f'thumbnails/{pid}{thumb_ext}'
            (folder / original).write_bytes(raw)
            (folder / thumbnail).write_bytes(thumb)
            saved.append({'id': pid, 'name': photo['name'], 'file': original, 'thumbnail': thumbnail, 'size': len(raw)})
        album = {'id': key, **fields, 'point': point, 'photos': saved}
        (folder / 'album.json').write_text(json.dumps(album, ensure_ascii=False, indent=2), encoding='utf-8')
        return key

    def save(self, albums):
        if not isinstance(albums, list):
            raise ValueError('相册列表无效')
        with self.lock:
            stage = self.inside(self.root / '.staging' / str(uuid.uuid4()))
            stage.mkdir()
            committed, ids = [], set()
            try:
                for i, album in enumerate(albums):
                    key = self.prepare(album, stage / str(i))
                    if key in ids:
                        raise ValueError('相册编号重复')
                    ids.add(key)
                for i, album in enumerate(albums):
                    target = self.inside(self.root / 'albums' / album['id'])
                    previous = stage / f'previous-{i}'
                    existed = target.exists()
                    if existed:
                        target.rename(previous)
                    try:
                        (stage / str(i)).rename(target)
                    except Exception:
                        if existed:
                            previous.rename(target)
                        raise
                    committed.append((target, previous, existed))
                self._index()
            except Exception:
                for target, previous, existed in reversed(committed):
                    shutil.rmtree(self.inside(target))
                    if existed:
                        previous.rename(target)
                raise
            finally:
                shutil.rmtree(self.inside(stage))

    def delete(self, key):
        with self.lock:
            target = self.inside(self.root / 'albums' / self.identifier(key))
            if not target.exists():
                return
            trash = self.inside(self.root / '回收站' / f'{key}-{uuid.uuid4()}')
            target.rename(trash)
            try:
                self._index()
            except Exception:
                trash.rename(target)
                raise

    def photo(self, album_id, photo_id, variant):
        with self.lock:
            folder = self.inside(self.root / 'albums' / self.identifier(album_id))
            album = json.loads((folder / 'album.json').read_text(encoding='utf-8'))
            photo = next((p for p in album['photos'] if p['id'] == self.identifier(photo_id)), None)
            if not photo or variant not in ('original', 'thumb'):
                raise FileNotFoundError('照片不存在')
            return self.inside(folder / photo['file' if variant == 'original' else 'thumbnail'])
