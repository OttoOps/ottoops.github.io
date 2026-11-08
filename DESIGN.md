# Design

ottoops.com is one USGS-style 7.5-minute quadrangle sheet, read top to bottom
along a marked survey route. Tokens live in `assets/site.css` on `:root`, with a
dark set under `prefers-color-scheme` and `[data-theme="dark"]`.

## Color roles

| Token | Map ink | Use |
|---|---|---|
| `--paper` | map paper | page ground |
| `--ink`, `--ink-2` | black plate | text, secondary text |
| `--contour`, `--contour-index` | brown plate | hero contours, list rules |
| `--wood` | woodland tint | Apps field, contribution cells |
| `--water`, `--hydro` | blue plate | ClearBridge field, links, italic captions |
| `--survey` | red survey line | route, primary action, focus ring, selection |
| `--revision` | photorevision purple | work in progress only (Habit Quest) |

Fields own whole sections. Purple never appears on finished work.

## Type

Archivo variable, one family. Map lettering is `font-stretch: 72-78%`,
uppercase, `letter-spacing: .12-.16em` (section heads, labels). The name and big
numbers run at `font-stretch: 112%`, weight 800. Body is 100% width, 17px/1.62,
66ch measure, tabular numerals.

## Components

- Collar: header and footer outside the neatline (`.sheet`, 1px rule with
  corner ticks).
- Legend: bordered rows with a drawn map symbol per row.
- Benchmark triangle: wordmark, favicon, route waypoints.
- Survey line: career timeline on a year axis; vertical list under 860px.
- Overprint: dashed purple panel for in-progress work.

## Motion

One route draws with scroll; waypoints fill when reached. Hero index contours
draw in once. Section heads wipe in, field tints print downward, the survey line
and calendar fill on first view. Everything is static and fully visible under
`prefers-reduced-motion` or without JavaScript.

## Data

- `scripts/make_terrain.py` regenerates `assets/terrain.svg` from AWS Terrain
  Tiles (USGS 3DEP). Run with `uv run`.
- `scripts/github_snapshot.py` regenerates `assets/github.json` through `gh`.
