"""Generate original procedural landscape illustrations using only the stdlib."""
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
PALETTES = [((26, 42, 73), (235, 155, 101)), ((35, 73, 92), (197, 207, 179)),
            ((57, 46, 79), (216, 151, 148)), ((32, 67, 70), (214, 192, 133))]


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def generate():
    folder = ROOT / 'sample-photos'
    folder.mkdir(exist_ok=True)
    w, h = 900, 600
    for n in range(12):
        top, bottom = PALETTES[n % len(PALETTES)]
        rows = bytearray()
        sunx, suny = 190 + (n * 107) % 520, 170 + (n % 3) * 28
        for y in range(h):
            rows.append(0)
            for x in range(w):
                k = y / h
                rgb = [int(a * (1 - k) + b * k) for a, b in zip(top, bottom)]
                distance = math.hypot(x - sunx, y - suny)
                if distance < 29:
                    rgb = [249, 219, 161]
                for layer in range(3):
                    ridge = 345 + layer * 73 + math.sin(x / (130 - layer * 25) + n + layer) * (32 + layer * 9) + math.sin(x / 61 + n) * 14
                    if y > ridge:
                        rgb = [int(v * (.49 - layer * .1)) for v in top]
                rows.extend(rgb)
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
        (folder / f'landscape-{n + 1:02}.png').write_bytes(png)
    print('Generated 12 original procedural demo illustrations.')


if __name__ == '__main__':
    generate()
