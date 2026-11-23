// A layer's data for export: its features (all, the ones a filter keeps, or
// the selected ones) with their properties, how the map drew them
// (style_color, style_class) and, for a radius or buffer filter, how far each
// is (distance_mi). CSV rows add longitude and latitude for points. Pure.
import { csvText } from "./csv.js";

const INTERNAL = /^__/;

/**
 * Export-ready GeoJSON features. `ids` (a Set) limits them; `drawn` is the
 * layer's features as last drawn (with __rumb_color and __rumb_class);
 * `distances` a Map of id → miles.
 */
export function exportFeatures(features, { ids = null, drawn = [], distances = null, idOf }) {
  const look = new Map(drawn.map((f) => [String(f.properties.__rumb_id), f.properties]));
  const out = [];
  for (const f of features) {
    const id = idOf(f);
    if (ids && !ids.has(id)) continue;
    const props = Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => !INTERNAL.test(k)));
    const d = look.get(id);
    if (d) {
      props.style_color = d.__rumb_color ?? null;
      props.style_class = d.__rumb_class ?? null;
    }
    if (distances) props.distance_mi = distances.has(id) ? Math.round(distances.get(id) * 1000) / 1000 : null;
    out.push({ type: "Feature", id, properties: props, geometry: f.geometry });
  }
  return out;
}

/** CSV text of export features: id first, then every property, then lon/lat for points. */
export function featuresCSV(features) {
  const columns = [];
  const seen = new Set(["id"]);
  for (const f of features)
    for (const k of Object.keys(f.properties))
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
  const points = features.length > 0 && features.every((f) => f.geometry?.type === "Point");
  const header = ["id", ...columns, ...(points ? ["lon", "lat"] : [])];
  const rows = features.map((f) => [
    f.id,
    ...columns.map((k) => f.properties[k]),
    ...(points ? f.geometry.coordinates.slice(0, 2) : []),
  ]);
  return csvText([header, ...rows]);
}

/** A GeoJSON FeatureCollection of export features. */
export const featuresGeoJSON = (features) => JSON.stringify({ type: "FeatureCollection", features });

/** A safe file name stem: "fire_stations_2020-filtered". */
export const exportName = (layerId, scope) =>
  (String(layerId).replace(/[^a-z0-9_-]+/gi, "_") + (scope === "all" ? "" : "-" + scope)).slice(0, 80);
