// The map's spatial filter as DuckDB spatial SQL, for imported tables too big
// to filter in the page (ported from map_project's sql_layer_select). Distances
// use the region's projected coordinates, as the map does. Pure.
import { ident, sqlString } from "../data/sql.js";

/** Well-known text for a GeoJSON geometry in longitude/latitude. */
export function toWKT(g) {
  const pt = (c) => c[0] + " " + c[1];
  const line = (cs) => "(" + cs.map(pt).join(", ") + ")";
  const poly = (rings) => "(" + rings.map(line).join(", ") + ")";
  switch (g.type) {
    case "Point":
      return "POINT (" + pt(g.coordinates) + ")";
    case "MultiPoint":
      return "MULTIPOINT (" + g.coordinates.map((c) => "(" + pt(c) + ")").join(", ") + ")";
    case "LineString":
      return "LINESTRING " + line(g.coordinates);
    case "MultiLineString":
      return "MULTILINESTRING (" + g.coordinates.map(line).join(", ") + ")";
    case "Polygon":
      return "POLYGON " + poly(g.coordinates);
    case "MultiPolygon":
      return "MULTIPOLYGON (" + g.coordinates.map(poly).join(", ") + ")";
    case "GeometryCollection":
      return "GEOMETRYCOLLECTION (" + g.geometries.map(toWKT).join(", ") + ")";
    default:
      throw new Error("Unknown geometry type " + g.type);
  }
}

/**
 * The target CRS for ST_Transform, as SQL text: the region's EPSG code when it
 * has one, else its PROJ string. DuckDB-WASM 1.32.0 (spatial 1.4.3) takes the
 * PROJ string form ("+proj=aea …") in Chrome and WebKit, matching sf to
 * nanometres, so PROJJSON is not needed. `crs` is the catalog's
 * region.projection.
 */
export function crsSQL(crs) {
  if (crs?.epsg) return `'EPSG:${crs.epsg}'`;
  if (crs?.proj) return sqlString(crs.proj);
  return "'EPSG:4326'";
}

/**
 * SELECT * FROM table WHERE <the filter>. `base` holds the buffer's selected
 * geometries (longitude/latitude GeoJSON); `crs` the region's projection
 * ({ epsg } or { proj }, as in the catalog).
 */
export function filterSQL(table, geometry, filter, { crs, base = [] }) {
  const target = crsSQL(crs);
  const projected = (expr) => `ST_Transform(${expr}, 'EPSG:4326', ${target}, always_xy := true)`;
  const metres = (filter.miles || 0) * 1609.344;
  let where;
  if (filter.kind === "radius")
    where = `ST_DWithin(${projected(ident(geometry))}, ${projected(`ST_Point(${filter.center[0]}, ${filter.center[1]})`)}, ${metres})`;
  else if (filter.kind === "polygon") {
    const ring = [...filter.ring, filter.ring[0]];
    where = `ST_Intersects(${ident(geometry)}, ST_GeomFromText('${toWKT({ type: "Polygon", coordinates: [ring] })}'))`;
  } else {
    const wkt = toWKT({ type: "GeometryCollection", geometries: base });
    where = `ST_DWithin(${projected(ident(geometry))}, ${projected(`ST_GeomFromText('${wkt}')`)}, ${metres})`;
  }
  return "SELECT *\nFROM " + ident(table) + "\nWHERE " + where;
}
