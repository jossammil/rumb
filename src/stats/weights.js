import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import STRtree from "jsts/org/locationtech/jts/index/strtree/STRtree.js";
import RelateOp from "jsts/org/locationtech/jts/operation/relate/RelateOp.js";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp.js";

// DE-9IM relations on the original polygons include partial shared edges and holes.
export function polygonNeighbors(features, rule) {
  if (rule !== "queen" && rule !== "rook")
    throw new Error("Choose queen or rook contiguity.");
  const ids = features.map((feature) => {
    const id = feature.id ?? feature.properties?.GEOID;
    if (id == null || id === "")
      throw new Error("Each polygon needs a stable feature ID.");
    return String(id);
  });
  if (new Set(ids).size !== ids.length)
    throw new Error("Polygon feature IDs must be unique.");
  const reader = new GeoJSONReader();
  const index = new STRtree();
  const entries = features.map((feature, i) => {
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
      throw new Error(
        "Contiguity analysis requires a polygon layer. Aggregate points to areas first.",
      );
    }
    const geometry = reader.read(feature.geometry);
    if (geometry.isEmpty() || !IsValidOp.isValid(geometry))
      throw new Error("Invalid polygon geometry for feature " + ids[i] + ".");
    const bounds = geometry.getEnvelopeInternal();
    const entry = { i, geometry, bounds };
    index.insert(bounds, entry);
    return entry;
  });
  const neighbors = Object.fromEntries(ids.map((id) => [id, []]));
  for (const { i, geometry, bounds } of entries) {
    const candidates = index.query(bounds).iterator();
    while (candidates.hasNext()) {
      const other = candidates.next();
      if (other.i <= i) continue;
      const relation = RelateOp.relate(geometry, other.geometry);
      // Interior/interior must be empty. Boundary/boundary must intersect,
      // in one dimension for a rook edge or in any dimension for queen.
      if (!relation.matches(rule === "queen" ? "F***T****" : "F***1****"))
        continue;
      neighbors[ids[i]].push(ids[other.i]);
      neighbors[ids[other.i]].push(ids[i]);
    }
  }
  for (const row of Object.values(neighbors)) row.sort();
  return neighbors;
}
