# Utah Canyoneering Trip Planner

[![Deploy site to GitHub Pages](https://github.com/conrice8/canyoneering-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/conrice8/canyoneering-app/actions/workflows/deploy.yml)

An interactive map and filterable table of **753 technical canyons in Utah**, built to help
canyoneers quickly find routes that match their gear, skill, and schedule. It started as a Tableau
dashboard and is now a fast, self-contained static website — no Tableau license, no install.

### ▶ Live site: **https://conrice8.github.io/canyoneering-app/**

---

## What it does

- **Map + table, always in sync.** A Leaflet map (region-colored pins) sits beside a sortable,
  filterable table. Filtering narrows both at once; clicking a pin or a row selects the canyon and
  opens a detail panel.
- **Rich filtering.** Search by name, plus min quality · max rope needed · max distance · max #
  rappels · good-in-season · vehicle access · risk / water / technical / time-commitment rating ·
  region.
- **Rope-inventory matcher.** Enter the length of rope you own and the app highlights which canyons
  you're equipped for — short canyons grey out, the rope column shows ✓ / ✗, and map pins fade out.
  A "Hide canyons I don't have rope for" toggle filters them entirely.
- **Plain-language trip readiness.** The detail panel summarizes each canyon in human terms
  ("You're good to go — 40 ft to spare", "Short by 50 ft", or "Rope: unknown") and flags which
  planning fields RopeWiki doesn't record.
- **Honest about missing data.** Unknown values show as `—` rather than a misleading `0`, and the
  risk filter distinguishes a genuine *Standard* rating from *unknown*.

## How it's built

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML / CSS / JavaScript — no framework, no build step |
| Map | [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles (via CDN) |
| Data pipeline | Python + [pandas](https://pandas.pydata.org/) (`site/build/extract_data.py`) |
| Hosting | GitHub Pages, auto-deployed from `site/` on every push (GitHub Actions) |

## The data

The site is powered by `site/data/canyons.json`, generated from the authoritative RopeWiki master
spreadsheet (`Rope Wiki Data/Canyon Working.xlsx`). The build script:

- de-duplicates on `pageid` (757 rows → **753** unique canyons; 747 have coordinates and appear on
  the map),
- coerces types and strips HTML out of the rating text,
- and adds computed fields based on the original Tableau calculations, tuned so *unknown* never
  reads as a real value:
  - `rope_length_needed` = `longest_rappel_ft × 2 + 10`, but `null` when the longest rappel is
    unknown and `0` only for genuinely no-rappel canyons.
  - `risk_level` = the RopeWiki hazard flag (`PG` / `R` / `X` / `XX`), else `"Standard"` for a
    rated-but-unflagged canyon, else `null` when it has no rating at all.

> RopeWiki only prints a hazard flag when a canyon is *worse* than normal, so a blank flag on a
> rated canyon means "standard risk", not missing data — the filter reflects that.

## Repository layout

```
site/                     The deployable static website
  index.html              Page shell (filters · map+table · detail panel)
  css/styles.css          Styling (desert/sandstone theme, responsive)
  js/app.js               Data load, map, table, filters, rope matcher
  js/regions.js           Region → color map
  data/canyons.json       Generated data that powers the site
  build/extract_data.py   Regenerates canyons.json from the spreadsheet
  README.md               Deeper build/run notes
Rope Wiki Data/           Source spreadsheets (RopeWiki exports + cleaned data)
Canyoneering Trip Planning V1 (1).twbx   The original Tableau workbook
.github/workflows/        GitHub Pages deploy workflow
```

## Local development

The page loads `data/canyons.json` with `fetch()`, which browsers block over `file://`, so serve
the `site/` folder over HTTP:

```bash
python -m http.server 8765 --directory "site"
```

Then open **http://localhost:8765/**. (Port 8765 avoids a conflict with another local project on
port 8000.)

To rebuild the data after editing the spreadsheet (`pip install pandas openpyxl` first):

```bash
python site/build/extract_data.py
```

See **[`site/README.md`](site/README.md)** for the full build details.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which publishes the `site/` folder to
GitHub Pages automatically. To update the live site:

```bash
git add -A && git commit -m "your message" && git push
```

The live URL refreshes within a minute or so.

## Credits

Built by **Conner Rice, Truman Porter, and Luke Spencer**. Canyon data from
[RopeWiki](https://ropewiki.com/). Always verify route details on RopeWiki and check conditions
before heading out — canyoneering is inherently dangerous.
