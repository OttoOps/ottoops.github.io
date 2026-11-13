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
- Summit mark: an O ring with a two-peak ridge inside. Wordmark and favicon.
- Benchmark triangle: route waypoints only. Never as a logo: on its own it
  reads as a warning sign.
- Survey line: career timeline on a year axis; vertical list under 860px.
- Overprint: dashed purple panel for in-progress work.
- Shaded relief: a canvas under the hero contours, shaded from the elevation
  grid. Warm brown shadows on the light sheet, faint lights on the dark one.
- Readout: one line of map lettering in the hero with the pointer's latitude,
  longitude and elevation. A click leaves a spot elevation (cross and height).
- Stop card: bordered record under the career line for the chosen stop. Role,
  dates and one line, all copied from the resume.

## Motion

One route draws with scroll; waypoints fill when reached. Hero index contours
draw in once. Section heads wipe in, field tints print downward, the survey line
and calendar fill on first view. Everything is static and fully visible under
`prefers-reduced-motion` or without JavaScript.

## Interaction

The hero is the one authored moment: the light on the relief follows the
pointer and returns to the northwest when it leaves. Under reduced motion the
light stays in the northwest; readouts and spot elevations still work. Career
stops are buttons. Pointing at a calendar day reads its date and count in the
caption line. None of it carries content a visitor can't get without it.

## Data

- `scripts/make_terrain.py` regenerates `assets/terrain.svg` and the elevation
  grid `assets/terrain-dem.bin.gz` (256x192 cells, whole feet, gzipped int16
  deltas) from AWS Terrain Tiles (USGS 3DEP). Run with `uv run`.
- `scripts/github_snapshot.py` regenerates `assets/github.json` through `gh`.
