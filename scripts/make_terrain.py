# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow", "contourpy"]
# ///
"""Build the Mount Blue Sky terrain: assets/terrain.svg and terrain-dem.bin.gz.

Elevation comes from the public AWS Terrain Tiles (Terrarium encoding), whose
US source is USGS 3DEP. Run with `uv run scripts/make_terrain.py`. The output is
committed; GitHub Pages serves it as a static file.
"""

from __future__ import annotations

import gzip
import io
import math
import urllib.request
from pathlib import Path

import contourpy
import numpy as np
from PIL import Image

ZOOM = 12
CENTER = (39.5883, -105.6438)  # Mount Blue Sky summit
TILES_X, TILES_Y = 4, 3
INTERVAL_FT = 200
INDEX_EVERY = 5  # every fifth line is an index contour (1,000 ft)
SCALE = 0.5  # output units per source pixel
OUT = Path(__file__).resolve().parent.parent / "assets" / "terrain.svg"
DEM_OUT = OUT.with_name("terrain-dem.bin.gz")
DEM_STEP = 4  # source pixels per elevation cell
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_of(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch(x: int, y: int) -> np.ndarray:
    with urllib.request.urlopen(URL.format(z=ZOOM, x=x, y=y), timeout=30) as r:
        img = Image.open(io.BytesIO(r.read())).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def blur(a: np.ndarray, passes: int = 3) -> np.ndarray:
    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = (
            p[:-2, :-2] + p[:-2, 1:-1] + p[:-2, 2:]
            + p[1:-1, :-2] + p[1:-1, 1:-1] + p[1:-1, 2:]
            + p[2:, :-2] + p[2:, 1:-1] + p[2:, 2:]
        ) / 9
    return a


def simplify(pts: np.ndarray, tol: float) -> np.ndarray:
    """Ramer-Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    start, end = pts[0], pts[-1]
    seg = end - start
    norm = np.hypot(*seg)
    d = (
        np.abs(seg[0] * (pts[:, 1] - start[1]) - seg[1] * (pts[:, 0] - start[0])) / norm
        if norm
        else np.hypot(*(pts - start).T)
    )
    i = int(np.argmax(d))
    if d[i] > tol:
        left = simplify(pts[: i + 1], tol)
        return np.vstack([left[:-1], simplify(pts[i:], tol)])
    return np.vstack([start, end])


def write_dem(feet: np.ndarray) -> None:
    """Write the elevation grid the page reads for hill shading and readouts.

    One cell per DEM_STEP source pixels, in whole feet. Stored as gzipped
    little-endian int16 deltas in row order: each value is the difference from
    the cell before it, which compresses far better than the raw heights.
    """
    h, w = feet.shape
    grid = feet.reshape(h // DEM_STEP, DEM_STEP, w // DEM_STEP, DEM_STEP).mean((1, 3))
    flat = np.rint(grid).astype(np.int32).ravel()
    deltas = np.diff(flat, prepend=0).astype("<i2")
    DEM_OUT.write_bytes(gzip.compress(deltas.tobytes(), 9, mtime=0))
    print(f"wrote {DEM_OUT} {DEM_OUT.stat().st_size / 1024:.0f} KiB, "
          f"{grid.shape[1]}x{grid.shape[0]}, peak {flat.max()} ft")


def main() -> None:
    cx, cy = tile_of(*CENTER, ZOOM)
    x0, y0 = int(cx) - TILES_X // 2, int(cy) - TILES_Y // 2
    rows = [
        np.hstack([fetch(x0 + i, y0 + j) for i in range(TILES_X)])
        for j in range(TILES_Y)
    ]
    raw = np.vstack(rows) * 3.28084
    feet = blur(raw)
    h, w = feet.shape
    gen = contourpy.contour_generator(z=feet, line_type="Separate")
    lo = math.ceil(feet.min() / INTERVAL_FT) * INTERVAL_FT
    out_minor: list[str] = []
    out_index: list[str] = []
    for level in range(int(lo), int(feet.max()), INTERVAL_FT):
        is_index = (level // INTERVAL_FT) % INDEX_EVERY == 0
        for line in gen.lines(level):
            if len(line) < 12:
                continue
            pts = simplify(line * SCALE, 0.35)
            d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
            (out_index if is_index else out_minor).append(d)
    vw, vh = w * SCALE, h * SCALE
    write_dem(raw)
    sx, sy = (cx - x0) * 256 * SCALE, (cy - y0) * 256 * SCALE
    summit = (
        f'<g class="summit" transform="translate({sx:.1f} {sy:.1f})">'
        '<path d="M0 -6L5.5 3.5H-5.5Z"/><circle r="1.1"/>'
        '<text x="9" y="3.5">MOUNT BLUE SKY</text></g>'
    )
    n = 2**ZOOM

    def lat(ty: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))

    def lon(tx: float) -> float:
        return tx / n * 360 - 180

    print(f"bounds N {lat(y0):.4f} S {lat(y0 + TILES_Y):.4f} "
          f"W {lon(x0):.4f} E {lon(x0 + TILES_X):.4f}")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.0f} {vh:.0f}" '
        f'preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">'
        "<style>.c-minor,.c-index{fill:none;stroke:var(--contour,#c49a77);"
        "stroke-width:.45;vector-effect:non-scaling-stroke}"
        ".c-index{stroke:var(--contour-index,#9a6038);stroke-width:1.1}"
        ".summit{fill:var(--ink,#1c1d1a);font:600 7px/1 Archivo,sans-serif;"
        "letter-spacing:.16em}</style>"
        f'<path class="c-minor" d="{" ".join(out_minor)}"/>'
        + "".join(f'<path class="c-index" pathLength="1" d="{d}"/>' for d in out_index)
        + summit
        + "</svg>\n"
    )
    OUT.write_text(svg)
    print(f"wrote {OUT} {len(svg)/1024:.0f} KiB, {len(out_minor)} minor, "
          f"{len(out_index)} index, range {feet.min():.0f}-{feet.max():.0f} ft")


if __name__ == "__main__":
    main()
