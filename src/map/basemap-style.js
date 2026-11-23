// The MapLibre style: a Natural Earth backdrop for the region, Census roads and
// an optional 1° grid, with hidden anchor layers that mark where stacked data
// layers go (map/layer-specs.js), plus sources for Compare and the selection.
// Data features carry __rumb_id and __rumb_color. Colors come from the theme
// (mapColors), so the backdrop can change with it while data colors stay put.

/** A hidden layer that marks where a band of stacked layers ends. */
const anchor = (id) => ({ id, type: "background", layout: { visibility: "none" }, paint: {} });

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
    accent: get("--accent", "#c47a10"),
    info: get("--sem-info", "#3a7fb0"),
    road: get("--map-road", "#b7a98a"),
    roadMinor: get("--map-road-minor", "#cfc5ad"),
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
    "cmp-outline": { "line-color": c.outline },
    "sel-neighbor": { "line-color": c.neighbor },
    "sel-line": { "line-color": c.selected },
    "sel-point": { "circle-color": c.selected, "circle-stroke-color": c.pointStroke },
    "roads-secondary": { "line-color": c.roadMinor },
    "roads-primary": { "line-color": c.road },
    "road-labels": { "text-color": c.label, "text-halo-color": c.halo },
    graticule: { "line-color": c.boundary },
    "sketch-fill": { "fill-color": c.accent },
    "sketch-line": { "line-color": c.accent },
    "sketch-points": { "circle-color": c.accent, "circle-stroke-color": c.halo },
    "locate-accuracy": { "fill-color": c.info, "fill-outline-color": c.info },
    "locate-dot": {
      "circle-color": ["case", ["==", ["get", "kind"], "me"], c.info, c.accent],
      "circle-stroke-color": c.halo,
    },
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
      roads: src(empty),
      graticule: src(empty),
      cmp: src(empty),
      selection: src(empty),
      sketch: src(empty),
      locate: src(empty),
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
      // Compare draws its scored areas from its own source while the stack is hidden.
      {
        id: "cmp-fill",
        type: "fill",
        source: "cmp",
        paint: { "fill-color": ["get", "__rumb_color"], "fill-opacity": 0.94 },
      },
      {
        id: "cmp-outline",
        type: "line",
        source: "cmp",
        paint: { ...paint["cmp-outline"], "line-opacity": 0.68, "line-width": width([4, 0.35, 7, 0.75, 11, 1.4]) },
      },
      // Stacked layers' fills, outlines and lines go just before this anchor.
      anchor("anchor-areas"),
      // Roads (Census TIGER numbered routes) sit above area fills so they stay
      // readable over a choropleth, and below points and selections.
      {
        id: "roads-secondary",
        type: "line",
        source: "roads",
        minzoom: 7,
        filter: ["==", ["get", "class"], "secondary"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { ...paint["roads-secondary"], "line-opacity": 0.8, "line-width": width([7, 0.5, 10, 1.1, 13, 2.4]) },
      },
      {
        id: "roads-primary",
        type: "line",
        source: "roads",
        filter: ["==", ["get", "class"], "primary"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { ...paint["roads-primary"], "line-opacity": 0.9, "line-width": width([5, 0.7, 8, 1.5, 12, 3.4]) },
      },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        layout: { visibility: "none" },
        paint: { ...paint.graticule, "line-width": 0.8, "line-opacity": 0.7, "line-dasharray": [1, 3] },
      },
      // Stacked layers' points go just before this anchor, above the roads.
      anchor("anchor-points"),
      // The selection and its neighbors, from whichever layer they belong to.
      {
        id: "sel-neighbor",
        type: "line",
        source: "selection",
        filter: ["==", ["get", "role"], "neighbor"],
        paint: { ...paint["sel-neighbor"], "line-width": 2, "line-dasharray": [2, 1] },
      },
      {
        id: "sel-line",
        type: "line",
        source: "selection",
        filter: ["all", ["==", ["get", "role"], "selected"], ["!=", ["geometry-type"], "Point"]],
        paint: { ...paint["sel-line"], "line-width": 3.3 },
      },
      {
        id: "sel-point",
        type: "circle",
        source: "selection",
        filter: ["all", ["==", ["get", "role"], "selected"], ["==", ["geometry-type"], "Point"]],
        paint: { ...paint["sel-point"], "circle-radius": 6, "circle-stroke-width": 3 },
      },
      // Field tools: a measured or drawn shape, and a position (yours or one typed).
      {
        id: "sketch-fill",
        type: "fill",
        source: "sketch",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { ...paint["sketch-fill"], "fill-opacity": 0.14 },
      },
      {
        id: "sketch-line",
        type: "line",
        source: "sketch",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { ...paint["sketch-line"], "line-width": 2.2, "line-dasharray": [3, 1.5] },
      },
      {
        id: "sketch-points",
        type: "circle",
        source: "sketch",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { ...paint["sketch-points"], "circle-radius": 4, "circle-stroke-width": 1.5 },
      },
      {
        id: "locate-accuracy",
        type: "fill",
        source: "locate",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { ...paint["locate-accuracy"], "fill-opacity": 0.12 },
      },
      {
        id: "locate-dot",
        type: "circle",
        source: "locate",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          ...paint["locate-dot"],
          "circle-radius": 6,
          "circle-stroke-width": 2.5,
        },
      },
      // Stacked layers' labels go just before this anchor.
      anchor("anchor-labels"),
      {
        id: "road-labels",
        type: "symbol",
        source: "roads",
        minzoom: 9,
        layout: {
          ...label,
          "text-field": ["get", "ref"],
          "text-size": 10,
          "symbol-placement": "line",
          "symbol-spacing": 320,
        },
        paint: { ...paint["road-labels"], "text-halo-width": 1.4 },
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

/** Meridians and parallels every `step` degrees across an extent [w, s, e, n]. */
export function graticuleLines([west, south, east, north], step = 1) {
  const features = [];
  const line = (coordinates, value, axis) =>
    features.push({ type: "Feature", properties: { value, axis }, geometry: { type: "LineString", coordinates } });
  for (let x = Math.ceil(west / step) * step; x <= east; x += step)
    line([[x, south], [x, north]], x, "lon");
  for (let y = Math.ceil(south / step) * step; y <= north; y += step)
    line([[west, y], [east, y]], y, "lat");
  return { type: "FeatureCollection", features };
}
