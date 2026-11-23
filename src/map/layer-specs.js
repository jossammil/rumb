// MapLibre layers for one stacked rumb layer, built from plain data so they can
// be tested without a map. Each rumb layer has its own GeoJSON source,
// `lyr-<id>`, and up to five MapLibre layers. They sit in three bands of the
// style, each closed by a hidden anchor layer:
//   areas  (fills, outlines, lines)   below the roads   → before "anchor-areas"
//   points (circles)                  above the roads   → before "anchor-points"
//   labels (text)                     above selections  → before "anchor-labels"
// Within a band, layers follow the stack order, bottom to top. So points always
// draw over polygons, and the stack order decides which polygons cover which.

export const ANCHORS = { area: "anchor-areas", point: "anchor-points", label: "anchor-labels" };

/** The MapLibre source id for a rumb layer. */
export const sourceId = (id) => "lyr-" + id;

/** Geometry kinds: a catalog layer says what it holds; query layers may mix. */
export const KINDS = ["polygon", "point", "line", "mixed"];

/** The look every layer starts with (the reference layer's look before stacking). */
export const DEFAULT_STYLE = {
  fillOpacity: 0.94,
  outlineOpacity: 0.68,
  lineWidth: 3,
  pointRadius: 5,
  pointStrokeWidth: 1,
};

const zoomed = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops];
const is = (type) => ["==", ["geometry-type"], type];

/**
 * [{ id, band, interactive, spec }] for a rumb layer of a given kind, with
 * theme colors { outline, pointStroke } and a style (DEFAULT_STYLE keys).
 */
export function layerSpecs(id, kind, colors, style = {}) {
  const st = { ...DEFAULT_STYLE, ...style };
  const source = sourceId(id);
  const color = ["get", "__rumb_color"];
  const mixed = kind === "mixed";
  const out = [];
  const add = (suffix, band, interactive, spec) =>
    out.push({ id: source + "-" + suffix, band, interactive, spec: { id: source + "-" + suffix, source, ...spec } });
  if (kind === "polygon" || mixed) {
    add("fill", "area", true, {
      type: "fill",
      ...(mixed && { filter: is("Polygon") }),
      paint: { "fill-color": color, "fill-opacity": st.fillOpacity },
    });
    add("outline", "area", false, {
      type: "line",
      ...(mixed && { filter: is("Polygon") }),
      paint: {
        "line-color": colors.outline,
        "line-opacity": st.outlineOpacity,
        "line-width": zoomed([4, 0.35, 7, 0.75, 11, 1.4]),
      },
    });
  }
  if (kind === "line" || mixed)
    add("line", "area", true, {
      type: "line",
      ...(mixed && { filter: is("LineString") }),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": st.lineWidth },
    });
  if (kind === "point" || mixed)
    add("point", "point", true, {
      type: "circle",
      ...(mixed && { filter: is("Point") }),
      paint: {
        "circle-radius": st.pointRadius,
        "circle-color": color,
        "circle-stroke-color": colors.pointStroke,
        "circle-stroke-width": st.pointStrokeWidth,
      },
    });
  return out;
}

/** The kind a GeoJSON feature collection needs: one geometry family, or "mixed". */
export function kindOf(features) {
  const kinds = new Set();
  for (const f of features) {
    const t = f.geometry?.type || "";
    kinds.add(t.includes("Polygon") ? "polygon" : t.includes("Line") ? "line" : t.includes("Point") ? "point" : "mixed");
    if (kinds.size > 1) return "mixed";
  }
  return [...kinds][0] || "mixed";
}

/**
 * MapLibre layer ids in draw order for a stack (bottom to top), band by band.
 * specsOf(id) returns that layer's specs.
 */
export function orderMapLayers(ids, specsOf) {
  const bands = { area: [], point: [], label: [] };
  for (const id of ids) for (const s of specsOf(id)) bands[s.band].push(s.id);
  return [...bands.area, ...bands.point, ...bands.label];
}
