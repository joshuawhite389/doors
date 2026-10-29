# Vendored map libraries and assets

Served from Doors' own origin so the map and the page fonts never depend on a CDN at runtime (one doc-shot take came out blank on an
unpkg hiccup, 2026-10-22). Files are byte-identical to the published packages; licenses sit beside each.

| Path | Source | Version | License |
|---|---|---|---|
| `maplibre-gl-5.24.0/` | npm `maplibre-gl` (`dist/`) | 5.24.0 | BSD-3-Clause (`LICENSE.txt`) |
| `pmtiles-4.5.0/` | npm `pmtiles` (`dist/pmtiles.js`) | 4.5.0 | BSD-3-Clause (`LICENSE`, from github.com/protomaps/PMTiles) |
| `protomaps-basemaps-5.7.2/` | npm `@protomaps/basemaps` (`dist/basemaps.js`) | 5.7.2 | BSD-3-Clause (`LICENSE.md`, from github.com/protomaps/basemaps) |
| `basemaps-assets/fonts/` | github.com/protomaps/basemaps-assets (folders renamed: spaces → `-`; `map.js` `ownGlyphs` maps the URLs) | commit 028c18f7 | SIL Open Font License (`fonts/OFL.txt`) |
| `fonts/inter/`, `fonts/intertight/`, `fonts/fonts.css` | Google Fonts (css2, Inter 400–600 + Inter Tight 500–800, variable woff2, all 7 subsets), 2026-10-22; the CSS's URLs point here | Inter v20, Inter Tight v9 | SIL Open Font License (`OFL.txt` in each, from github.com/google/fonts) |
| `basemaps-assets/sprites/v4/light*` | github.com/protomaps/basemaps-assets | commit 028c18f7 | MIT, derived from tangrams/icons (`sprites/LICENSE.md`) |

The fonts and sprites serve only the Protomaps fallback (`public/ui/map.js`, with the self-hosted `public/tiles/*.pmtiles`).
To update: `npm pack <name>@<version>` and copy `dist/`; for the assets, the repo's archive at a pinned commit.
