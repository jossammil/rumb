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

/**
 * A layer's look. Stack entries store the reader's choices (core/stack.js);
 * these are the MapLibre-facing values, and the defaults reproduce the
 * reference layer's original look.
 */
export const DEFAULT_STYLE = {
  fillOpacity: 0.94,
  outlineOpacity: 0.68,
  outlineWidth: null, // null: thin, growing with zoom
  outlineColor: null, // null: the theme's outline color
  lineWidth: 3,
  pointRadius: 5,
  pointOpacity: 1,
  pointStrokeWidth: 1,
  shape: "circle",
  label: null, // a field name to label features with
};

/** The MapLibre look for a stack entry's choices ({ opacity, size, shape, outline, outlineColor }, label). */
export function entryStyle(entry, kind) {
  const look = entry?.style || {},
    out = { label: entry?.label || null };
  if (look.opacity != null) {
    out.fillOpacity = look.opacity;
    out.pointOpacity = look.opacity;
  }
  if (look.size != null) {
    out.pointRadius = look.size;
    if (kind === "line") out.lineWidth = look.size;
  }
  if (look.shape) out.shape = look.shape;
  if (look.outline != null) out.outlineWidth = look.outline;
  if (look.outlineColor) out.outlineColor = look.outlineColor;
  return out;
}

const zoomed = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops];
/** An opacity that fades for features a filter leaves out (properties.__rumb_out). */
const fade = (value, by = 0.16) => ["case", ["==", ["get", "__rumb_out"], true], value * by, value];
const is = (type) => ["==", ["geometry-type"], type];
/** Shape images are 24 px with a half-size of 8 (map/shapes.js). */
const SHAPE_HALF = 8;

/**
 * [{ id, band, interactive, spec }] for a rumb layer of a given kind, with
 * theme colors { outline, pointStroke, label, halo } and a style (DEFAULT_STYLE keys).
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
      paint: { "fill-color": color, "fill-opacity": fade(st.fillOpacity) },
    });
    add("outline", "area", false, {
      type: "line",
      ...(mixed && { filter: is("Polygon") }),
      paint: {
        "line-color": st.outlineColor || colors.outline,
        "line-opacity": fade(st.outlineWidth == null ? st.outlineOpacity : 0.9, 0.3),
        "line-width": st.outlineWidth == null ? zoomed([4, 0.35, 7, 0.75, 11, 1.4]) : st.outlineWidth,
      },
    });
  }
  if (kind === "line" || mixed)
    add("line", "area", true, {
      type: "line",
      ...(mixed && { filter: is("LineString") }),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": st.lineWidth, "line-opacity": fade(st.pointOpacity) },
    });
  if (kind === "point" || mixed) {
    const filter = mixed ? { filter: is("Point") } : {};
    if (st.shape === "circle" || !st.shape)
      add("point", "point", true, {
        type: "circle",
        ...filter,
        paint: {
          "circle-radius": st.pointRadius,
          "circle-color": color,
          "circle-opacity": fade(st.pointOpacity),
          "circle-stroke-color": colors.pointStroke,
          "circle-stroke-width": st.pointStrokeWidth,
          "circle-stroke-opacity": fade(st.pointOpacity),
        },
      });
    else
      // A different id from the circle layer: MapLibre keeps per-id symbol state,
      // so a layer id must never change type.
      add("shape", "point", true, {
        type: "symbol",
        ...filter,
        layout: {
          "icon-image": "rumb-shape-" + st.shape,
          "icon-size": st.pointRadius / SHAPE_HALF,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": color,
          "icon-opacity": fade(st.pointOpacity),
          "icon-halo-color": colors.pointStroke,
          "icon-halo-width": st.pointStrokeWidth,
        },
      });
  }
  if (st.label) {
    const points = kind === "point";
    add("label", "label", false, {
      type: "symbol",
      minzoom: points ? 8 : 5,
      layout: {
        "text-field": ["to-string", ["get", st.label]],
        "text-font": ["Arial"],
        "text-size": 11,
        "text-padding": 3,
        "text-max-width": 9,
        "text-optional": true,
        ...(points && { "text-offset": [0, 0.9], "text-anchor": "top" }),
      },
      paint: {
        "text-color": colors.label,
        "text-halo-color": colors.halo,
        "text-halo-width": 1.3,
        "text-opacity": fade(1, 0.3),
      },
    });
  }
  return out;
}

/** A signature of a layer's MapLibre layers: ids and types; when it changes they are rebuilt. */
export const specShape = (specs) => specs.map((s) => s.id + ":" + s.spec.type).join(",");

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
