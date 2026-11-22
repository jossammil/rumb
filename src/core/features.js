// Small facts about GeoJSON features, shared by the map, statistics and Compare.

/** A feature's stable ID: its GeoJSON id, else a Census-style GEOID property. */
export const featureId = (f) => String(f.id ?? f.properties?.GEOID);

export const isPolygon = (f) =>
  ["Polygon", "MultiPolygon"].includes(f.geometry?.type);

// Bookkeeping and key columns that are never offered as measures.
const NOT_MEASURES = /^(__rumb_|__atlas_|ogc_fid$|fid$|geoid$)/i;

/** Property names holding a finite number in at least one feature, in first-seen order. */
export function numericFields(features) {
  const set = new Set();
  for (const f of features)
    for (const [k, v] of Object.entries(f.properties ?? {}))
      if (typeof v === "number" && Number.isFinite(v) && !NOT_MEASURES.test(k))
        set.add(k);
  return [...set];
}

/** Distinct string values of one property, sorted (for "study area: county" choices). */
export function groups(features, field) {
  if (!field) return [];
  return [
    ...new Set(
      features.map((f) => f.properties?.[field]).filter((x) => typeof x === "string"),
    ),
  ].sort();
}
