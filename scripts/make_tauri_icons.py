"""
Generate the icon set the Tauri desktop app needs.

Reuses the pure-stdlib rasterizer in make_icons.py (teal rounded square,
heartbeat + capsule) so the desktop app, the PWA and Android all share one
look. No Pillow / cairo required.

Produces:
  src-tauri/icons/32x32.png
  src-tauri/icons/128x128.png
  src-tauri/icons/128x128@2x.png
  src-tauri/icons/icon.png
  src-tauri/icons/icon.ico   (PNG-in-ICO, valid for Windows)

Run:  python scripts/make_tauri_icons.py
"""

import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from make_icons import render, write_png  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "src-tauri", "icons")


def png_bytes_for(size: int, tmp_path: str) -> bytes:
    """Render at `size`, write it out, and return the raw PNG bytes."""
    write_png(tmp_path, size, size, render(size))
    with open(tmp_path, "rb") as f:
        return f.read()


def write_ico(path: str, sizes) -> None:
    """
    Build a .ico containing PNG images.

    Vista and later accept PNG-compressed icon entries, which means we can
    reuse the rasterizer instead of emitting uncompressed BMP bitmaps.
    """
    tmp = os.path.join(OUT_DIR, "_tmp_ico.png")

    payloads = []
    for size in sizes:
        payloads.append((size, png_bytes_for(size, tmp)))

    if os.path.exists(tmp):
        os.remove(tmp)

    count = len(payloads)
    header = struct.pack("<HHH", 0, 1, count)

    offset = 6 + 16 * count
    entries = b""
    data = b""
    for size, blob in payloads:
        # 0 encodes 256 in the width/height byte fields.
        dimension = 0 if size >= 256 else size
        entries += struct.pack(
            "<BBBBHHII",
            dimension,
            dimension,
            0,       # colour count (0 = 256+)
            0,       # reserved
            1,       # colour planes
            32,      # bits per pixel
            len(blob),
            offset,
        )
        data += blob
        offset += len(blob)

    with open(path, "wb") as f:
        f.write(header + entries + data)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    for size in (32, 128, 256, 512):
        out = os.path.join(OUT_DIR, f"{size}x{size}.png")
        write_png(out, size, size, render(size))
        print(f"wrote {out}")

    # Tauri's expected filenames.
    for src, name in ((128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")):
        out = os.path.join(OUT_DIR, name)
        write_png(out, src, src, render(src))
        print(f"wrote {out}")

    ico = os.path.join(OUT_DIR, "icon.ico")
    write_ico(ico, (16, 32, 48, 64, 256))
    print(f"wrote {ico}")


if __name__ == "__main__":
    main()
