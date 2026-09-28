"""
Generate PWA icons (icon-192.png, icon-512.png) for Health Tracker.

Pure stdlib rasterizer: teal rounded-square background, a white heartbeat
polyline and a white capsule (pill). No Pillow / cairo needed.

Run:  python scripts/make_icons.py
"""

import math
import os
import struct
import zlib

BG = (0x0F, 0x76, 0x6E)   # teal 600
FG = (0xFF, 0xFF, 0xFF)   # white
ACCENT = (0x0F, 0x76, 0x6E)

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


def write_png(path, width, height, pixels):
    """pixels: list of rows, each row a list of (r,g,b,a)."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def inside_rounded_rect(x, y, w, h, radius):
    r = radius
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    # Clamp to inner rect to test corner arcs only
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def point_in_rotated_rect(px, py, cx, cy, w, h, angle_deg):
    """Test point inside a rectangle centred at (cx,cy) rotated by angle."""
    a = math.radians(angle_deg)
    cos_a, sin_a = math.cos(-a), math.sin(-a)
    dx, dy = px - cx, py - cy
    lx = dx * cos_a - dy * sin_a
    ly = dx * sin_a + dy * cos_a
    return abs(lx) <= w / 2 and abs(ly) <= h / 2


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def dist_to_polyline(px, py, pts):
    best = float("inf")
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        best = min(best, dist_to_segment(px, py, x1, y1, x2, y2))
    return best


# Heartbeat polyline in a 64x64 design grid, positioned in the lower half.
HEART_PTS = [
    (8, 34), (17, 34), (21, 25), (26, 43),
    (31, 19), (36, 49), (40, 34), (56, 34),
]

# Capsule in the upper-right of the design grid.
CAP_CX, CAP_CY = 45.0, 19.0
CAP_W, CAP_H = 22.0, 11.0
CAP_ANGLE = -45.0


def render(size):
    """Render the icon at `size` x `size` and return RGBA pixel rows."""
    s = size / 64.0          # scale from design grid to output
    radius = 14 * s
    heart_w = 4.0 * s        # stroke half-width for the heartbeat
    band_w = 1.8 * s         # capsule divider half-width

    rows = []
    for y in range(size):
        row = []
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            if not inside_rounded_rect(px, py, size, size, radius):
                row.append((0, 0, 0, 0))
                continue

            # Capsule takes priority (drawn on top of the heartbeat).
            if point_in_rotated_rect(px, py, CAP_CX * s, CAP_CY * s,
                                     CAP_W * s, CAP_H * s, CAP_ANGLE):
                # Divider line across the middle of the capsule, in the
                # capsule's local long axis.
                a = math.radians(CAP_ANGLE)
                cos_a, sin_a = math.cos(-a), math.sin(-a)
                dx, dy = px - CAP_CX * s, py - CAP_CY * s
                lx = dx * cos_a - dy * sin_a
                if abs(lx) <= band_w:
                    row.append(ACCENT + (255,))
                else:
                    row.append(FG + (255,))
                continue

            # Heartbeat stroke.
            d = dist_to_polyline(px, py, [(p[0] * s, p[1] * s) for p in HEART_PTS])
            if d <= heart_w:
                row.append(FG + (255,))
                continue

            row.append(BG + (255,))
        rows.append(row)
    return rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        pixels = render(size)
        out = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(out, size, size, pixels)
        print(f"wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()
