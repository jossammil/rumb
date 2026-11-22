// The MapLibre style: a Natural Earth backdrop for the region, then the data
// layer drawn from one GeoJSON source whose features carry __rumb_id and
// __rumb_color. Colors come from the theme (mapColors), so the backdrop can
// change with it while data colors stay put.

export const DATA_LAYERS = ["areas", "lines", "points"];

/** Map colors read from the theme's CSS tokens, with the original light look as fallback. */
export function mapColors(root = document.documentElement) {
  const css = getComputedStyle(root);
  const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    water: get("--map-water", "#c9ddda"),
    land: get("--map-land", "#e9ecdf"),
    river: get("--map-river", "#9cbfbd"),
    boundary: get("--map-boundary", "#a9b5a2"),
    outline: get("--map-outline", "#fcfdf3"),
    label: get("--map-label", "#566858"),
    region: get("--map-region-label", "#849480"),
    halo: get("--map-halo", "#f5f7ef"),
    town: get("--map-town", "#5e6e61"),
    neighbor: get("--map-neighbor", "#3d505c"),
    selected: get("--map-selected", "#1d2933"),
    pointStroke: get("--map-point-stroke", "#ffffff"),
  };
}

const kind = (name) => ["==", ["get", "kind"], name];
const label = {
  "text-font": ["Arial"],
  "text-field": ["get", "name"],
  "text-size": 11,
  "text-padding": 4,
};
const empty = { type: "FeatureCollection", features: [] };

/** Neutral data colors that follow the theme: unavailable values and "not significant". */
export function neutralColors(root = document.documentElement) {
  const css = getComputedStyle(root);
  return {
    na: css.getPropertyValue("--na").trim() || "#8a918b",
    ns: css.getPropertyValue("--cluster-ns").trim() || "#c9d0cc",
  };
}

/** Paint properties that follow the theme, by layer id. */
export function themedPaint(c) {
  return {
    ocean: { "background-color": c.water },
    "world-land": { "fill-color": c.land },
    land: { "fill-color": c.land },
    lakes: { "fill-color": c.water },
    rivers: { "line-color": c.river },
    states: { "line-color": c.boundary },
    outlines: { "line-color": c.outline },
    points: { "circle-stroke-color": c.pointStroke },
    neighbors: { "line-color": c.neighbor },
    selected: { "line-color": c.selected },
    "selected-point": { "circle-color": c.selected, "circle-stroke-color": c.pointStroke },
    "state-names": { "text-color": c.region, "text-halo-color": c.halo },
    "town-dots": { "circle-color": c.town, "circle-stroke-color": c.halo },
    towns: { "text-color": c.label, "text-halo-color": c.halo },
  };
}

export function buildStyle(region, regionPath, c = mapColors()) {
  const src = (data) => ({ type: "geojson", data });
  const labels = (region.backdrop?.labels || []).map(([name, lon, lat]) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Point", coordinates: [lon, lat] },
  }));
  const paint = themedPaint(c);
  const width = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops];
  return {
    version: 8,
    sources: {
      world: src(empty),
      context: src(region.backdrop?.context ? regionPath + region.backdrop.context : empty),
      regionNames: src({ type: "FeatureCollection", features: labels }),
      area: src(empty),
    },
    layers: [
      { id: "ocean", type: "background", paint: paint.ocean },
      { id: "world-land", type: "fill", source: "world", paint: paint["world-land"] },
      { id: "land", type: "fill", source: "context", filter: kind("land"), paint: paint.land },
      { id: "lakes", type: "fill", source: "context", filter: kind("lakes"), paint: paint.lakes },
      {
        id: "rivers",
        type: "line",
        source: "context",
        filter: kind("rivers"),
        paint: { ...paint.rivers, "line-width": width([4, 0.65, 8, 1.9]) },
      },
      {
        id: "states",
        type: "line",
        source: "context",
        filter: kind("states"),
        paint: { ...paint.states, "line-width": 1.35, "line-dasharray": [5, 2] },
      },
      {
        id: "areas",
        type: "fill",
        source: "area",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "__rumb_color"], "fill-opacity": 0.94 },
      },
      {
        id: "outlines",
        type: "line",
        source: "area",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          ...paint.outlines,
          "line-opacity": 0.68,
          "line-width": width([4, 0.35, 7, 0.75, 11, 1.4]),
        },
      },
      {
        id: "lines",
        type: "line",
        source: "area",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ["get", "__rumb_color"], "line-width": 3 },
      },
      {
        id: "points",
        type: "circle",
        source: "area",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "__rumb_color"],
          ...paint.points,
          "circle-stroke-width": 1,
        },
      },
      {
        id: "neighbors",
        type: "line",
        source: "area",
        filter: ["==", ["get", "__rumb_id"], ""],
        paint: { ...paint.neighbors, "line-width": 2, "line-dasharray": [2, 1] },
      },
      {
        id: "selected",
        type: "line",
        source: "area",
        filter: ["==", ["get", "__rumb_id"], ""],
        paint: { ...paint.selected, "line-width": 3.3 },
      },
      {
        id: "selected-point",
        type: "circle",
        source: "area",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "__rumb_id"], ""]],
        paint: { ...paint["selected-point"], "circle-radius": 6, "circle-stroke-width": 3 },
      },
      {
        id: "state-names",
        type: "symbol",
        source: "regionNames",
        layout: { ...label, "text-size": 12, "text-letter-spacing": 0.17 },
        paint: { ...paint["state-names"], "text-halo-width": 1 },
      },
      {
        id: "town-dots",
        type: "circle",
        source: "context",
        filter: kind("places"),
        paint: { ...paint["town-dots"], "circle-radius": 1.8, "circle-stroke-width": 0.6 },
      },
      {
        id: "towns",
        type: "symbol",
        source: "context",
        filter: kind("places"),
        layout: { ...label, "text-offset": [0, 0.8], "text-anchor": "top" },
        paint: { ...paint.towns, "text-halo-width": 1.4 },
      },
    ],
  };
}
