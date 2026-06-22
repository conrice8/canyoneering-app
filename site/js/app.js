/* ===========================================================================
   Utah Canyoneering Trip Planner — app logic
   Loads canyons.json, renders a Leaflet map + sortable/filterable table that
   stay in sync, and a detail panel for the selected canyon.
   =========================================================================== */
"use strict";

let ALL = [];           // every canyon
let FILTERED = [];      // current filter result (drives map + table)
let selectedId = null;  // pageid of selected canyon
let sortKey = "quality_score";
let sortDir = "desc";   // "asc" | "desc"

let map, markerLayer;
const markers = new Map();   // pageid -> Leaflet marker

// --- Table column definitions ---------------------------------------------
const COLUMNS = [
  { key: "name",               label: "Canyon",      num: false },
  { key: "region",             label: "Region",      num: false },
  { key: "quality_score",      label: "Quality",     num: true,  dec: 1 },
  { key: "rope_length_needed", label: "Rope (ft)",   num: true,  dec: 0 },
  { key: "num_rappels",        label: "Rappels",     num: true,  dec: 0 },
  { key: "longest_rappel_ft",  label: "Longest (ft)",num: true,  dec: 0 },
  { key: "technical_class",    label: "Tech",        num: false },
  { key: "water_rating",       label: "Water",       num: false },
  { key: "risk_level",         label: "Risk",        num: false },
  { key: "time_commitment",    label: "Time",        num: false },
  { key: "distance_mi",        label: "Dist (mi)",   num: true,  dec: 1 },
  { key: "vehicle_required",   label: "Vehicle",     num: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function fmtNum(v, dec) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return dec ? Number(v).toFixed(dec) : String(Math.round(v));
}
function ropewikiUrl(pageid) {
  return `https://ropewiki.com/index.php?curid=${pageid}`;
}

// Risk levels ordered low -> high hazard (drives chip order + sorting).
const RISK_ORDER = ["Standard", "PG", "R", "X", "XX"];

// --- Rope inventory ("I have N ft of rope") --------------------------------
function ropeHave() {
  const v = parseFloat(document.getElementById("rope-have").value);
  return Number.isFinite(v) && v > 0 ? v : null;
}
// "ready" | "short" | "unknown" when a rope length is entered, else null.
function ropeStatus(c, have) {
  if (have == null) return null;
  if (c.rope_length_needed == null) return "unknown";
  return c.rope_length_needed <= have ? "ready" : "short";
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
fetch("data/canyons.json")
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then(data => {
    ALL = data;
    initMap();
    buildDynamicFilters();
    buildLegend();
    buildTableHead();
    wireControls();
    applyFilters();
  })
  .catch(err => {
    document.getElementById("table-body").innerHTML =
      `<tr><td colspan="${COLUMNS.length}" style="padding:24px;color:#a14a2c">
        Could not load data/canyons.json (${esc(err.message)}).<br>
        Run the site through a local server, e.g. <code>python -m http.server 8765 --directory site</code>.
      </td></tr>`;
  });

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
function initMap() {
  map = L.map("map", { scrollWheelZoom: true }).setView([38.5, -111.4], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function renderMarkers() {
  markerLayer.clearLayers();
  markers.clear();
  const have = ropeHave();
  const pts = [];
  FILTERED.forEach(c => {
    if (!c.mappable) return;
    // Fade canyons I can't run; ring the ones I can.
    const rs = ropeStatus(c, have);
    const style = rs === "short"   ? { fillOpacity: 0.18, color: "#fff",    weight: 1 }
               :  rs === "ready"   ? { fillOpacity: 0.95, color: "#1f7a3d", weight: 2 }
               :  rs === "unknown" ? { fillOpacity: 0.55, color: "#fff",    weight: 1 }
               :                     { fillOpacity: 0.85, color: "#fff",    weight: 1 };
    const m = L.circleMarker([c.latitude, c.longitude], {
      radius: 6,
      fillColor: regionColor(c.region),
      color: style.color,
      weight: style.weight,
      fillOpacity: style.fillOpacity,
    });
    m.bindPopup(popupHtml(c));
    m.on("click", () => select(c.pageid, { fromMap: true }));
    m.addTo(markerLayer);
    markers.set(c.pageid, m);
    pts.push([c.latitude, c.longitude]);
  });
}

function popupHtml(c) {
  return `<strong>${esc(c.name)}</strong><br>
    <span style="color:#5c534a">${esc(c.region || "")}</span><br>
    Quality ${fmtNum(c.quality_score, 1)} · Rope ${fmtNum(c.rope_length_needed, 0)} ft<br>
    Rating ${esc(c.rating_clean || c.rating_raw || "—")}`;
}

// ---------------------------------------------------------------------------
// Dynamic filter chips (built from the data so values always match)
// ---------------------------------------------------------------------------
function distinct(key, sortFn) {
  const set = new Set();
  ALL.forEach(c => { if (c[key] !== null && c[key] !== undefined) set.add(c[key]); });
  return [...set].sort(sortFn);
}

function chip(value, label, swatch) {
  const sw = swatch
    ? `<span class="swatch" style="background:${swatch}"></span>` : "";
  return `<label class="chip">${sw}<input type="checkbox" value="${esc(value)}" /> ${esc(label)}</label>`;
}

function buildDynamicFilters() {
  const numericalish = (a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true });

  const riskSort = (a, b) => {
    const ia = RISK_ORDER.indexOf(a), ib = RISK_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  };
  document.getElementById("risk-chips").innerHTML =
    distinct("risk_level", riskSort).map(v => chip(v, v)).join("");
  document.getElementById("water-chips").innerHTML =
    distinct("water_rating", numericalish).map(v => chip(v, v)).join("");
  document.getElementById("tech-chips").innerHTML =
    distinct("technical_class", numericalish).map(v => chip(v, v)).join("");
  document.getElementById("time-chips").innerHTML =
    distinct("time_commitment", numericalish).map(v => chip(v, v)).join("");
  document.getElementById("region-chips").innerHTML =
    distinct("region").map(v => chip(v, v, regionColor(v))).join("");

  // Set slider ranges from the data
  const maxRope = Math.max(...ALL.map(c => c.rope_length_needed || 0));
  const maxDist = Math.ceil(Math.max(...ALL.map(c => c.distance_mi || 0)));
  const maxRap  = Math.max(...ALL.map(c => c.num_rappels || 0));
  setSlider("max-rope", maxRope, "rope-val");
  setSlider("max-dist", maxDist, "dist-val");
  setSlider("max-rappels", maxRap, "rap-val");
}

function setSlider(id, max, valId) {
  const el = document.getElementById(id);
  el.max = max;
  el.value = max;
  document.getElementById(valId).textContent = "any";
}

function buildLegend() {
  const regions = distinct("region");
  document.getElementById("legend").innerHTML =
    `<h4>Region</h4>` + regions.map(r =>
      `<div class="legend-row"><span class="swatch" style="background:${regionColor(r)}"></span>${esc(r)}</div>`
    ).join("");
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
function buildTableHead() {
  document.getElementById("table-head").innerHTML = COLUMNS.map(col =>
    `<th data-key="${col.key}" class="${col.num ? "num" : ""}">${esc(col.label)}<span class="arrow"></span></th>`
  ).join("");
  document.querySelectorAll("#table-head th").forEach(th => {
    th.addEventListener("click", () => onSort(th.dataset.key));
  });
  updateSortArrows();
}

function onSort(key) {
  if (sortKey === key) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortKey = key;
    const col = COLUMNS.find(c => c.key === key);
    sortDir = col.num ? "desc" : "asc";
  }
  updateSortArrows();
  renderTable();
}

function updateSortArrows() {
  document.querySelectorAll("#table-head th").forEach(th => {
    const a = th.querySelector(".arrow");
    a.textContent = th.dataset.key === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "";
  });
}

function sortRows(rows) {
  const col = COLUMNS.find(c => c.key === sortKey);
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    const na = va === null || va === undefined || va === "";
    const nb = vb === null || vb === undefined || vb === "";
    if (na && nb) return 0;
    if (na) return 1;        // nulls always last
    if (nb) return -1;
    if (col.num) return (va - vb) * dir;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
  });
}

function cellHtml(c, col) {
  if (col.key === "region") {
    return `<td><span class="region-cell"><span class="swatch" style="background:${regionColor(c.region)}"></span>${esc(c.region || "—")}</span></td>`;
  }
  if (col.key === "vehicle_required") {
    return `<td>${c.vehicle_required ? "High-clear." : "Car OK"}</td>`;
  }
  if (col.key === "rope_length_needed") {
    const rs = ropeStatus(c, ropeHave());
    const mark = rs === "ready" ? ' <span class="rope-mark ok" title="You have enough rope">✓</span>'
              :  rs === "short" ? ' <span class="rope-mark no" title="Needs more rope than you have">✗</span>'
              :  "";
    return `<td class="num">${fmtNum(c.rope_length_needed, col.dec)}${mark}</td>`;
  }
  if (col.num) {
    return `<td class="num">${fmtNum(c[col.key], col.dec)}</td>`;
  }
  return `<td>${esc(c[col.key] || "—")}</td>`;
}

function renderTable() {
  const rows = sortRows(FILTERED);
  const body = document.getElementById("table-body");
  const emptyMsg = document.getElementById("empty-msg");

  if (!rows.length) {
    body.innerHTML = "";
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;
  const have = ropeHave();
  body.innerHTML = rows.map(c => {
    const rs = ropeStatus(c, have);
    const cls = [c.pageid === selectedId ? "selected" : "", rs ? "rope-" + rs : ""]
      .filter(Boolean).join(" ");
    return `<tr data-id="${c.pageid}" class="${cls}">` +
      COLUMNS.map(col => cellHtml(c, col)).join("") + "</tr>";
  }).join("");

  body.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", () => select(Number(tr.dataset.id), { fromTable: true }));
  });
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function checkedValues(containerId) {
  return new Set(
    [...document.querySelectorAll(`#${containerId} input:checked`)].map(i => i.value)
  );
}

function applyFilters() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const minQuality = parseFloat(document.getElementById("min-quality").value);
  const maxRopeEl = document.getElementById("max-rope");
  const maxDistEl = document.getElementById("max-dist");
  const maxRapEl  = document.getElementById("max-rappels");
  const maxRope = parseFloat(maxRopeEl.value), ropeIsMax = maxRopeEl.value === maxRopeEl.max;
  const maxDist = parseFloat(maxDistEl.value), distIsMax = maxDistEl.value === maxDistEl.max;
  const maxRap  = parseFloat(maxRapEl.value),  rapIsMax  = maxRapEl.value === maxRapEl.max;

  const seasons = checkedValues("season-chips");
  const risks   = checkedValues("risk-chips");
  const waters  = checkedValues("water-chips");
  const techs   = checkedValues("tech-chips");
  const times   = checkedValues("time-chips");
  const regions = checkedValues("region-chips");
  const vehicle = document.querySelector('input[name="vehicle"]:checked').value;
  const have = ropeHave();
  const hideShort = document.getElementById("rope-hide").checked;

  FILTERED = ALL.filter(c => {
    if (q && !(c.name || "").toLowerCase().includes(q)) return false;

    // Rope inventory: optionally drop canyons that need more rope than I carry.
    if (have != null && hideShort && ropeStatus(c, have) === "short") return false;

    // Min quality: a positive minimum excludes unknown-quality canyons.
    if (minQuality > 0 && !(c.quality_score >= minQuality)) return false;

    // Max sliders: null/unknown values pass; only known violations are dropped.
    if (!ropeIsMax && c.rope_length_needed != null && c.rope_length_needed > maxRope) return false;
    if (!distIsMax && c.distance_mi != null && c.distance_mi > maxDist) return false;
    if (!rapIsMax  && c.num_rappels  != null && c.num_rappels  > maxRap)  return false;

    // Seasons: match if good in ANY selected season.
    if (seasons.size && ![...seasons].some(s => c[s])) return false;

    if (risks.size  && !risks.has(c.risk_level))       return false;
    if (waters.size && !waters.has(c.water_rating))    return false;
    if (techs.size  && !techs.has(c.technical_class))  return false;
    if (times.size  && !times.has(c.time_commitment))  return false;
    if (regions.size && !regions.has(c.region))        return false;

    if (vehicle === "passenger" && c.vehicle_required === true) return false;
    if (vehicle === "required"  && c.vehicle_required !== true) return false;

    return true;
  });

  renderMarkers();
  renderTable();

  // Keep selection only if still visible
  if (selectedId !== null && !FILTERED.some(c => c.pageid === selectedId)) {
    clearSelection();
  }
}

// ---------------------------------------------------------------------------
// Selection / detail panel
// ---------------------------------------------------------------------------
function select(pageid, opts = {}) {
  selectedId = pageid;
  const c = ALL.find(x => x.pageid === pageid);
  if (!c) return;

  // Highlight table row
  document.querySelectorAll("#table-body tr").forEach(tr => {
    tr.classList.toggle("selected", Number(tr.dataset.id) === pageid);
  });
  const row = document.querySelector(`#table-body tr[data-id="${pageid}"]`);
  if (row && !opts.fromTable) row.scrollIntoView({ block: "nearest" });

  // Move/open map
  if (c.mappable) {
    if (!opts.fromMap) {
      map.flyTo([c.latitude, c.longitude], Math.max(map.getZoom(), 11), { duration: 0.6 });
    }
    const m = markers.get(pageid);
    if (m) m.openPopup();
  }

  renderDetail(c);
}

function clearSelection() {
  selectedId = null;
  document.getElementById("detail-content").hidden = true;
  document.getElementById("detail-placeholder").hidden = false;
  document.getElementById("detail").classList.remove("open");
  document.querySelectorAll("#table-body tr.selected").forEach(tr => tr.classList.remove("selected"));
}

function statBox(k, v, wide) {
  return `<div class="stat${wide ? " wide" : ""}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
}

// Plain-language "can I run this?" summary for the detail panel.
function readinessHtml(c) {
  const have = ropeHave();
  const need = c.rope_length_needed;
  let tone, status, line;

  if (need == null) {
    tone = "unknown"; status = "Rope: unknown";
    line = "RopeWiki doesn't list a longest rappel for this canyon, so the rope "
         + "requirement can't be computed. Check the route page before you go.";
  } else if (need === 0) {
    tone = "ready"; status = "No rappels recorded";
    line = "No rappels are listed — likely no rope required, but confirm on RopeWiki.";
  } else if (have == null) {
    tone = "neutral"; status = `Needs ~${need} ft of rope`;
    line = `Longest rappel is ${fmtNum(c.longest_rappel_ft, 0)} ft, so you'll want about `
         + `<strong>${need} ft</strong> of rope (double-strand + slack). Enter your rope `
         + "length in the sidebar to check your kit.";
  } else if (need <= have) {
    tone = "ready"; status = "You're good to go";
    line = `Your <strong>${have} ft</strong> rope covers the ~${need} ft this canyon needs `
         + `(${have - need} ft to spare).`;
  } else {
    tone = "short"; status = `Short by ${need - have} ft`;
    line = `This canyon needs about <strong>${need} ft</strong> of rope but you have `
         + `${have} ft — you'd come up ${need - have} ft short on the longest rappel.`;
  }

  // Honesty note about other planning fields that are missing.
  const gaps = [];
  if (c.distance_mi == null) gaps.push("trip distance");
  if (c.time_lowhours == null && c.time_highhours == null) gaps.push("trip time");
  if (c.num_rappels == null) gaps.push("number of rappels");
  if (c.shuttle_minutes == null && !c.shuttle_raw) gaps.push("shuttle");
  const gapNote = gaps.length
    ? `<p class="r-gap">Not recorded on RopeWiki: ${gaps.join(", ")}.</p>` : "";

  return `<div class="readiness ${tone}">
      <span class="r-status">${esc(status)}</span>
      <span class="r-line">${line}</span>
      ${gapNote}
    </div>`;
}

function renderDetail(c) {
  const seasons = [
    ["Spring", c.season_spring], ["Summer", c.season_summer],
    ["Fall", c.season_fall], ["Winter", c.season_winter],
  ];
  const timeRange = (c.time_lowhours != null || c.time_highhours != null)
    ? `${fmtNum(c.time_lowhours, 0)}–${fmtNum(c.time_highhours, 0)} hrs` : "—";
  const shuttle = c.shuttle_minutes != null ? `${fmtNum(c.shuttle_minutes, 0)} min` : (c.shuttle_raw || "—");

  const html = `
    <h3>${esc(c.name)}</h3>
    <div class="detail-region">
      <span class="swatch" style="background:${regionColor(c.region)}"></span>
      ${esc(c.region || "")}${c.subregion ? " · " + esc(c.subregion) : ""}
    </div>

    ${readinessHtml(c)}

    <div class="stat-grid">
      ${statBox("Quality", fmtNum(c.quality_score, 1))}
      ${statBox("Rope needed", `${fmtNum(c.rope_length_needed, 0)} <span style="font-size:.7rem;font-weight:400">ft</span>`)}
      ${statBox("Longest rappel", `${fmtNum(c.longest_rappel_ft, 0)} <span style="font-size:.7rem;font-weight:400">ft</span>`)}
      ${statBox("# Rappels", fmtNum(c.num_rappels, 0))}
      ${statBox("Distance", `${fmtNum(c.distance_mi, 1)} <span style="font-size:.7rem;font-weight:400">mi</span>`)}
      ${statBox("Trip time", timeRange)}
    </div>

    <div class="detail-section">
      <h4>Rating</h4>
      <div class="detail-note">
        <span class="badge">${esc(c.rating_clean || c.rating_raw || "—")}</span><br>
        Technical ${esc(c.technical_class || "—")} ·
        Water ${esc(c.water_rating || "—")} ·
        Risk ${esc(c.risk_level || "—")} ·
        Time ${esc(c.time_commitment || "—")}
      </div>
    </div>

    <div class="detail-section">
      <h4>Best seasons</h4>
      <div class="season-pills">
        ${seasons.map(([n, on]) => `<span class="season-pill ${on ? "on" : ""}">${n}</span>`).join("")}
      </div>
      ${c.best_season_notes ? `<p class="detail-note" style="margin-top:6px">${esc(c.best_season_notes)}</p>` : ""}
    </div>

    <div class="detail-section">
      <h4>Access</h4>
      <p class="detail-note">
        Vehicle: <strong>${c.vehicle_required ? "High-clearance / 4×4" : "Passenger car OK"}</strong><br>
        Shuttle: ${esc(shuttle)}<br>
        ${c.coords ? "Coords: " + esc(c.coords) : ""}
      </p>
    </div>

    <a class="ropewiki-link" href="${ropewikiUrl(c.pageid)}" target="_blank" rel="noopener">
      View on RopeWiki ↗
    </a>
  `;
  const content = document.getElementById("detail-content");
  content.innerHTML = html;
  content.hidden = false;
  document.getElementById("detail-placeholder").hidden = true;
  document.getElementById("detail").classList.add("open");  // for narrow-screen drawer
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wireControls() {
  document.getElementById("search").addEventListener("input", applyFilters);

  // Sliders update their label live, then filter
  const sliderLabels = {
    "min-quality": ["quality-val", v => Number(v).toFixed(1)],
    "max-rope":    ["rope-val", null],
    "max-dist":    ["dist-val", null],
    "max-rappels": ["rap-val", null],
  };
  Object.entries(sliderLabels).forEach(([id, [labelId, fmt]]) => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      const atMax = el.value === el.max && id !== "min-quality";
      document.getElementById(labelId).textContent =
        atMax ? "any" : (fmt ? fmt(el.value) : el.value);
      applyFilters();
    });
  });

  // All checkbox/radio groups
  ["season-chips", "risk-chips", "water-chips", "tech-chips", "time-chips",
   "region-chips", "vehicle-radios"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyFilters);
  });

  // Rope inventory: re-filter AND refresh the open detail panel's readiness line.
  function onRopeChange() {
    applyFilters();
    if (selectedId !== null) {
      const c = ALL.find(x => x.pageid === selectedId);
      if (c) renderDetail(c);
    }
  }
  document.getElementById("rope-have").addEventListener("input", onRopeChange);
  document.getElementById("rope-hide").addEventListener("change", onRopeChange);

  document.getElementById("reset-btn").addEventListener("click", resetFilters);
}

function resetFilters() {
  document.getElementById("search").value = "";
  document.getElementById("min-quality").value = 0;
  document.getElementById("quality-val").textContent = "0.0";
  ["max-rope", "max-dist", "max-rappels"].forEach((id, i) => {
    const el = document.getElementById(id);
    el.value = el.max;
    document.getElementById(["rope-val", "dist-val", "rap-val"][i]).textContent = "any";
  });
  document.querySelectorAll('.sidebar input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.querySelector('input[name="vehicle"][value="any"]').checked = true;
  document.getElementById("rope-have").value = "";
  clearSelection();
  applyFilters();
}
