#!/usr/bin/env python3
"""Draw the Close to Tray icon. Run from this directory to refresh the PNGs."""

import struct
import zlib
from pathlib import Path

BLUE = (19, 115, 230, 255)
WHITE = (255, 255, 255, 255)
FLAP = (232, 242, 255, 255)


def in_round_rect(x, y, left, top, right, bottom, radius):
    if x < left or y < top or x >= right or y >= bottom:
        return False
    cx = left + radius if x < left + radius else right - radius - 1 if x >= right - radius else x
    cy = top + radius if y < top + radius else bottom - radius - 1 if y >= bottom - radius else y
    if cx == x and cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def pixel(x, y, size):
    margin = max(1, round(size * 0.06))
    radius = max(2, round(size * 0.22))
    if not in_round_rect(x, y, margin, margin, size - margin, size - margin, radius):
        return (0, 0, 0, 0)

    def sx(value):
        return margin + (value / 48) * (size - 2 * margin)

    left, right = sx(10), sx(38)
    top, bottom = sx(16), sx(34)
    mid_x, mid_y = sx(24), sx(25)
    flap_y = sx(17)

    # Envelope body.
    if left <= x < right and top <= y < bottom:
        # Flap: a triangle pointing down, drawn above the body center.
        if y <= mid_y and abs(x - mid_x) <= (y - flap_y) * (mid_x - left) / max(1, (mid_y - flap_y)):
            return FLAP
        return WHITE
    return BLUE


def write_png(path, size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel(x, y, size))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def main():
    here = Path(__file__).resolve().parent
    for size, name in ((32, "icon-32.png"), (48, "icon-48.png"), (96, "icon-96.png"), (128, "tray.png")):
        write_png(here / name, size)


if __name__ == "__main__":
    main()
