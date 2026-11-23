// The outline of a buffer around projected geometries, for drawing a filter on
// the map (the filter itself uses exact distances, geo/filter.js). JTS buffers
// a geometry collection as the union of its parts' buffers.
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

/** A projected (multi)polygon `metres` around the given projected GeoJSON geometries. */
export function bufferOutline(geometries, metres) {
  const g = new GeoJSONReader().read({ type: "GeometryCollection", geometries });
  return new GeoJSONWriter().write(BufferOp.bufferOp(g, metres, 8));
}
