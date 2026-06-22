# Utah Canyoneering Trip Planner — Website

A static, self-hosted web version of the original Tableau dashboard
(`Canyoneering Trip Planning V1 (1).twbx`). It shows **753 Utah technical
canyons** on an interactive map plus a searchable / sortable / filterable table,
with a detail panel for the selected canyon. No Tableau license required to view.

## Project layout

```
site/
  index.html            Page shell (filters · map+table · detail panel)
  css/styles.css        Styling (desert/sandstone theme, responsive layout)
  js/regions.js         Region → color map (shared by map pins, legend, table)
  js/app.js             Data load, map, table, filters, selection
  data/canyons.json     The data that powers the site (generated — see below)
  build/extract_data.py Regenerates canyons.json from the source spreadsheet
  README.md             This file
```

## Running it locally

The page loads `data/canyons.json` with `fetch()`, which browsers block over
`file://`. So serve the folder over HTTP (any static server works):

```bash
# use a dedicated port + absolute path (port 8000 is taken by another
# project on this machine, which serves the wrong site)
python -m http.server 8765 --directory "C:\Users\Conne\code\canyoneering-app\site"
```

Then open **http://localhost:8765/** in a browser.

> Internet access is required the first time you load it: the map library
> (Leaflet) and the map tiles (OpenStreetMap) come from a CDN.

## Regenerating the data

The data is extracted from **`../Rope Wiki Data/Canyon Working.xlsx`** (the
authoritative master). To rebuild `data/canyons.json` after the spreadsheet
changes:

```bash
python site/build/extract_data.py
```

Requires `pandas` (`pip install pandas openpyxl`). The script:

- de-duplicates on `pageid` (the source has 4 duplicates → **753** unique rows),
- coerces types (numbers, real booleans, `NaN` → `null`),
- strips HTML out of `rating_raw` and normalizes `technical_class` (`"3.0"` → `"3"`),
- and adds computed fields based on the Tableau workbook's calculated fields,
  tweaked so "unknown" never reads as a real value:
  - `rope_length_needed = longest_rappel_ft * 2 + 10` — but `null` when the longest
    rappel is unknown (187 canyons) and `0` only for genuinely no-rappel canyons (116).
    The old logic collapsed both to `0`, making 303 canyons look like they "need 0 ft".
  - `rappelling = longest_rappel_ft > 0` (`null` when the longest rappel is unknown)
  - `risk_level` = the RopeWiki hazard flag (`PG`/`R`/`X`/`XX`); else `"Standard"` when
    the canyon is rated but unflagged (543 canyons — RopeWiki only prints a flag when a
    canyon is *worse* than normal); else `null` when it has no rating at all (111).

It prints a build report (row counts, season totals, any coordinates outside
Utah). 747 of the 753 canyons have coordinates and appear on the map; all 753
appear in the table.

### Data note: seasons
The per-region CSVs in `Rope Wiki Data/Cleaned CSV Files (NOT SEASONS)/` are an
earlier partial clean. The season flags in `Canyon Working.xlsx` were verified
correct (Spring 469 · Summer 337 · Fall 475 · Winter 202 after de-dup) and are
the source used here.

## Filters

Search by name · min quality · max rope needed · max distance · max # rappels ·
good-in-season · vehicle access · risk / water / technical / time-commitment
rating · region. Filters drive the map and table together; clicking a map pin or
a table row selects the canyon and opens its detail panel.

**Rope inventory.** Enter your rope length under "My rope length (ft)" and the
table/map highlight which canyons you're equipped for: rows you can't run are
greyed out and the Rope column shows ✓ / ✗ (markers fade on the map). Tick
"Hide canyons I don't have rope for" to filter them out entirely. The detail
panel shows a plain-language **trip-readiness** summary ("Short by 50 ft",
"You're good to go", or "Rope: unknown" when the longest rappel isn't recorded).

## Deploying

Because it's fully static, you can host the `site/` folder on any static host
(GitHub Pages, Netlify, S3, etc.) — just publish the folder as-is.

## Optional: open without a server
If you want to double-click `index.html` instead of running a server, the build
script can be extended to also emit `data/canyons.js`
(`window.CANYONS = [...]`) and `index.html` can load that file directly. Ask if
you'd like that variant added.
