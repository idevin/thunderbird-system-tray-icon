#!/usr/bin/env python3
"""Draw the Close to Tray icon: an envelope set down into a tray.

Run from this directory to refresh the PNGs.
"""

import struct
import zlib
from pathlib import Path

BLUE = (19, 115, 230, 255)
WHITE = (255, 255, 255, 255)
FLAP = (214, 230, 250, 255)
CLEAR = (0, 0, 0, 0)


def in_round_rect(x, y, left, top, right, bottom, radius):
    if x < left or y < top or x >= right or y >= bottom:
        return False
    if radius <= 0:
        return True
    if x < left + radius and y < top + radius:
        return (x - (left + radius)) ** 2 + (y - (top + radius)) ** 2 <= radius ** 2
    if x >= right - radius and y < top + radius:
        return (x - (right - radius)) ** 2 + (y - (top + radius)) ** 2 <= radius ** 2
    if x < left + radius and y >= bottom - radius:
        return (x - (left + radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius ** 2
    if x >= right - radius and y >= bottom - radius:
        return (x - (right - radius)) ** 2 + (y - (bottom - radius)) ** 2 <= radius ** 2
    return True


def envelope_part(u, v, left, top, right, bottom):
    if not in_round_rect(u, v, left, top, right, bottom, 4):
        return None
    mid_x = (left + right) / 2
    mid_y = (top + bottom) / 2
    span = mid_y - top
    reach = ((right - left) / 2) * (mid_y - v) / span if span else 0
    if top <= v <= mid_y and abs(u - mid_x) <= reach:
        return FLAP
    return WHITE


def color_at(x, y, size):
    """x and y are pixel-center coordinates in a `size` square."""
    u = (x / size) * 96
    v = (y / size) * 96
    if not in_round_rect(u, v, 0, 0, 96, 96, 22):
        return CLEAR

    # Envelope sitting in the opening, above the floor of the tray.
    part = envelope_part(u, v, 24, 16, 72, 64)
    if part is not None:
        return part

    # Tray: a thick U, open at the top.
    outer = in_round_rect(u, v, 8, 54, 88, 84, 8)
    hole = in_round_rect(u, v, 16, 44, 80, 74, 6)
    if outer and not hole:
        return WHITE
    return BLUE


def write_png(path, size):
    samples = 4
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    px = x + (sx + 0.5) / samples
                    py = y + (sy + 0.5) / samples
                    color = color_at(px, py, size)
                    for i in range(4):
                        acc[i] += color[i]
            count = samples * samples
            row.extend(round(channel / count) for channel in acc)
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
    for size, name in (
        (32, "icon-32.png"),
        (48, "icon-48.png"),
        (96, "icon-96.png"),
        (128, "icon-128.png"),
        (128, "tray.png"),
    ):
        write_png(here / name, size)


if __name__ == "__main__":
    main()
