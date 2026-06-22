"""
Extract canyon data from the RopeWiki master spreadsheet into a clean JSON file
that powers the static website.

Source : ../../Rope Wiki Data/Canyon Working.xlsx   (the user's authoritative master)
Output : ../data/canyons.json

Run:
    python site/build/extract_data.py

Computed fields (based on the Tableau workbook's calculated fields recovered from
the .twb XML, with two data-honesty tweaks so "unknown" never masquerades as a value):
    rope_length_needed = longest_rappel_ft * 2 + 10   (None if longest unknown, 0 if no rappel)
    rappelling         = longest_rappel_ft > 0         (None if longest unknown)
    risk_level         = the RopeWiki hazard flag (PG/R/X/XX); else "Standard" when the
                         canyon is rated but unflagged; else None when it has no rating
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Paths (resolved relative to this file so the script works from any CWD)
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent          # site/build
SITE = HERE.parent                              # site
PROJECT = SITE.parent                           # canyoneering-app
SRC_XLSX = PROJECT / "Rope Wiki Data" / "Canyon Working.xlsx"
OUT_JSON = SITE / "data" / "canyons.json"

# Utah bounding box (loose) used only to flag suspicious coordinates.
UT_LAT = (36.0, 42.5)
UT_LON = (-114.5, -108.5)

# Column type groups -------------------------------------------------------
INT_COLS = ["pageid", "num_rappels", "longest_rappel_ft"]
FLOAT_COLS = [
    "quality_score", "time_lowhours", "time_highhours",
    "distance_mi", "shuttle_minutes", "latitude", "longitude",
]
BOOL_COLS = [
    "season_spring", "season_summer", "season_fall", "season_winter",
    "vehicle_required",
]
TEXT_COLS = [
    "name", "coords", "region", "subregion", "rating_raw", "rating_clean",
    "longest_raw", "best_season_raw", "best_season_notes", "shuttle_raw",
    "vehicle_raw", "technical_class", "water_rating", "time_commitment",
    "risk_rating",
]

_TAG_RE = re.compile(r"<[^>]+>")


def clean_text(value):
    """Strip HTML tags/entities and surrounding whitespace; '' / NaN -> None."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    s = str(value)
    s = _TAG_RE.sub("", s)                       # drop <i>...</i> etc.
    s = (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'"))
    s = s.strip()
    return s or None


def to_int(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        return int(round(float(value)))
    except (ValueError, TypeError):
        return None


def to_float(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        f = float(value)
        return None if math.isnan(f) else f
    except (ValueError, TypeError):
        return None


def to_bool(value):
    if isinstance(value, bool):
        return value
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return False
    s = str(value).strip().upper()
    return s in ("TRUE", "1", "1.0", "YES", "Y", "T")


def main():
    if not SRC_XLSX.exists():
        raise SystemExit(f"Source spreadsheet not found: {SRC_XLSX}")

    df = pd.read_excel(SRC_XLSX)
    total_rows = len(df)

    # --- Dedupe on pageid (keep first), log what we drop --------------------
    dup_mask = df["pageid"].duplicated(keep="first")
    dropped = df.loc[dup_mask, ["pageid", "name"]].values.tolist()
    df = df.loc[~dup_mask].copy()

    records = []
    coord_warnings = []
    season_counts = {c: 0 for c in
                     ("season_spring", "season_summer", "season_fall", "season_winter")}
    mappable = 0

    for _, row in df.iterrows():
        rec = {}
        for c in INT_COLS:
            rec[c] = to_int(row.get(c))
        for c in FLOAT_COLS:
            rec[c] = to_float(row.get(c))
        for c in BOOL_COLS:
            rec[c] = to_bool(row.get(c))
        for c in TEXT_COLS:
            rec[c] = clean_text(row.get(c))

        # technical_class arrives as a float-like string ("3.0") -> "3"
        tc = rec.get("technical_class")
        if tc:
            m = re.match(r"^(\d+)(?:\.0+)?$", tc)
            if m:
                rec["technical_class"] = m.group(1)

        # Computed fields ---------------------------------------------------
        # rope_length_needed reproduces the Tableau calc (longest * 2 + 10) but
        # keeps "no rappel" (0) distinct from "longest unknown" (None). The old
        # logic collapsed both to 0, so 303 canyons read as "needs 0 ft of rope"
        # when 187 of them simply had no longest-rappel recorded.
        lr = rec.get("longest_rappel_ft")
        if lr is None:
            rec["rope_length_needed"] = None
            rec["rappelling"] = None              # unknown
        elif lr > 0:
            rec["rope_length_needed"] = lr * 2 + 10
            rec["rappelling"] = True
        else:                                     # lr == 0 -> genuinely no rappel
            rec["rope_length_needed"] = 0
            rec["rappelling"] = False

        # risk_level: RopeWiki only prints a hazard flag (PG/R/X/XX) when a
        # canyon is *more* dangerous than normal, so a blank flag on an
        # otherwise-rated canyon means "standard" risk, not missing data. Only
        # canyons with no rating at all have a truly unknown risk level.
        if rec.get("risk_rating"):
            rec["risk_level"] = rec["risk_rating"]
        elif rec.get("rating_clean") or rec.get("rating_raw"):
            rec["risk_level"] = "Standard"
        else:
            rec["risk_level"] = None

        # Map usability flag + coordinate sanity ----------------------------
        lat, lon = rec.get("latitude"), rec.get("longitude")
        has_coords = lat is not None and lon is not None
        rec["mappable"] = bool(has_coords)
        if has_coords:
            mappable += 1
            if not (UT_LAT[0] <= lat <= UT_LAT[1] and UT_LON[0] <= lon <= UT_LON[1]):
                coord_warnings.append((rec.get("name"), lat, lon))

        for c in season_counts:
            if rec.get(c):
                season_counts[c] += 1

        records.append(rec)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, separators=(",", ":"))

    # --- Build report ------------------------------------------------------
    print(f"Source        : {SRC_XLSX}")
    print(f"Rows in       : {total_rows}")
    print(f"Duplicates    : {len(dropped)} dropped -> {len(records)} unique rows")
    for pid, name in dropped:
        print(f"   - dup pageid {pid}: {name}")
    print(f"Mappable rows : {mappable} (have lat/long)")
    rope_unknown = sum(1 for r in records if r["rope_length_needed"] is None)
    rope_zero = sum(1 for r in records if r["rope_length_needed"] == 0)
    print(f"Rope length   : {rope_unknown} unknown (-> null) + {rope_zero} no-rappel (0) "
          f"+ {len(records) - rope_unknown - rope_zero} with a value")
    risk_levels = Counter(r["risk_level"] for r in records)
    print("Risk levels   : " + ", ".join(
        f"{k or 'unknown'}={risk_levels[k]}"
        for k in ["Standard", "PG", "R", "X", "XX", None]
        if k in risk_levels))
    print(f"Season TRUE   : "
          f"spring={season_counts['season_spring']} "
          f"summer={season_counts['season_summer']} "
          f"fall={season_counts['season_fall']} "
          f"winter={season_counts['season_winter']}")
    if coord_warnings:
        print(f"Coord warnings: {len(coord_warnings)} outside Utah bbox")
        for name, lat, lon in coord_warnings[:10]:
            print(f"   ! {name}: {lat}, {lon}")
    else:
        print("Coord warnings: none (all mappable coords inside Utah bbox)")
    print(f"Wrote         : {OUT_JSON} ({OUT_JSON.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
