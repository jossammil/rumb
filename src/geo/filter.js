// The map's spatial filter: which features of a layer fall within a radius of
// a point, within a distance of the selected features (a buffer), or inside a
// drawn polygon. Distances are straight lines in the region's projected plane,
// in miles, like map_pdo's (EPSG:3814 metres / 1609.344). Pure.
//
// filter = { kind: "radius", center: [lon, lat], miles, orSelection }
//        | { kind: "buffer", layer, ids: [...], miles }
//        | { kind: "polygon", ring: [[lon, lat], …] }
import { METRES_PER_MILE } from "./measure.js";
import { bbox, boxDistance, geometryDistance, mapGeometry, pointDistance, pointInPolygon } from "./spatial.js";

export const FILTER_KINDS = ["radius", "buffer", "polygon"];

/** Projected features of a collection, computed once per collection and projection. */
const indexes = new WeakMap();
export function projectedIndex(collection, projection, idOf) {
  let byProjection = indexes.get(collection);
  if (!byProjection) indexes.set(collection, (byProjection = new WeakMap()));
  let index = byProjection.get(projection);
  if (!index) {
    index = collection.features.map((f) => {
      const geometry = mapGeometry(f.geometry, projection.forward);
      return { id: idOf(f), geometry, box: bbox(geometry), point: f.geometry?.type === "Point" };
    });
    byProjection.set(projection, index);
  }
  return index;
}

/** A filter made safe (or null): known kind, finite numbers, enough vertices. */
export function normalizeFilter(f) {
  if (!f || !FILTER_KINDS.includes(f.kind)) return null;
  const miles = Number(f.miles);
  const lonlat = (p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[1]) <= 90;
  if (f.kind === "radius")
    return lonlat(f.center) && miles > 0 && miles <= 500
      ? { kind: "radius", center: [f.center[0], f.center[1]], miles, orSelection: !!f.orSelection }
      : null;
  if (f.kind === "buffer")
    return typeof f.layer === "string" && Array.isArray(f.ids) && f.ids.length && miles >= 0 && miles <= 500
      ? { kind: "buffer", layer: f.layer, ids: f.ids.map(String), miles }
      : null;
  return Array.isArray(f.ring) && f.ring.length >= 3 && f.ring.every(lonlat)
    ? { kind: "polygon", ring: f.ring.map((p) => [p[0], p[1]]) }
    : null;
}

/**
 * Ids of the features kept by a filter, and each one's distance in miles (for
 * radius filters). `index` comes from projectedIndex; `context` carries the
 * projection, the buffer's base geometries (projected) and, for orSelection,
 * the selected areas (projected polygons).
 */
export function applyFilter(filter, index, { projection, base = [], selectedAreas = [] }) {
  const kept = new Map();
  if (filter.kind === "radius") {
    const c = projection.forward(filter.center),
      r = filter.miles * METRES_PER_MILE,
      box = [c[0], c[1], c[0], c[1]];
    for (const f of index) {
      if (boxDistance(box, f.box) > r) continue;
      const d = pointDistance(c, f.geometry);
      if (d <= r) kept.set(f.id, d / METRES_PER_MILE);
    }
    // map_pdo's rule: also keep what lies in the selected areas.
    for (const area of selectedAreas) {
      const abox = bbox(area);
      for (const f of index)
        if (!kept.has(f.id) && boxDistance(abox, f.box) === 0 && geometryDistance(f.geometry, area) === 0)
          kept.set(f.id, pointDistance(c, f.geometry) / METRES_PER_MILE);
    }
    return kept;
  }
  if (filter.kind === "buffer") {
    const r = filter.miles * METRES_PER_MILE;
    const bases = base.map((g) => ({ g, box: bbox(g) }));
    for (const f of index)
      for (const b of bases)
        if (boxDistance(b.box, f.box) <= r) {
          const d = geometryDistance(f.geometry, b.g);
          if (d <= r) {
            kept.set(f.id, Math.min(kept.get(f.id) ?? Infinity, d / METRES_PER_MILE));
          }
        }
    return kept;
  }
  const ring = filter.ring.map(projection.forward);
  const area = { type: "Polygon", coordinates: [[...ring, ring[0]]] },
    abox = bbox(area);
  for (const f of index) {
    if (boxDistance(abox, f.box) > 0) continue;
    const inside = f.point ? pointInPolygon(f.geometry.coordinates, area.coordinates) : geometryDistance(f.geometry, area) === 0;
    if (inside) kept.set(f.id, 0);
  }
  return kept;
}

/** "Within 25 mi of 32.30 N 90.18 W" and the like, given a way to write positions. */
export function describeFilter(f, where = (p) => p.join(", ")) {
  if (!f) return "";
  if (f.kind === "radius") return "Within " + f.miles + " mi of " + where(f.center) + (f.orSelection ? ", or in the selected areas" : "");
  if (f.kind === "buffer") return "Within " + f.miles + " mi of " + f.ids.length + " selected " + (f.ids.length === 1 ? "feature" : "features");
  return "Inside a drawn area (" + f.ring.length + " points)";
}
