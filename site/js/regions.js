// Region -> color map. Shared by the map pins, the legend, and the table chips
// so a region is always the same color everywhere. Palette = Tableau 10 (the
// look the original dashboard used), one stable color per Utah region.
const REGION_COLORS = {
  "Capitol Reef":               "#4E79A7",
  "Central Utah":               "#F28E2B",
  "Dinosaur National Monument": "#E15759",
  "Escalante":                  "#76B7B2",
  "Glen Canyon":                "#59A14F",
  "Moab":                       "#EDC948",
  "San Rafael Swell":           "#B07AA1",
  "Southeast Utah":             "#FF9DA7",
  "Southwest Utah":             "#9C755F",
  "Wasatch Front":              "#499894",
};

const REGION_FALLBACK = "#BAB0AC";

function regionColor(region) {
  return REGION_COLORS[region] || REGION_FALLBACK;
}
