// Point-in-polygon counts: how many points of a layer fall inside each area,
// on projected display geometry (geo/filter.js indexes). Points on a boundary
// are not counted, as ST_Within leaves them out. Pure.
import { pointInPolygon, parts } from "./spatial.js";

/** Map(area id → count) for projected area and point indexes ({ id, geometry, box }). */
export function countPoints(areas, points) {
  const counts = new Map(areas.map((a) => [a.id, 0]));
  const polys = areas.map((a) => ({ id: a.id, box: a.box, rings: parts(a.geometry).filter((p) => p.type === "polygon") }));
  for (const p of points) {
    if (!p.point) continue;
    const [x, y] = p.geometry.coordinates;
    for (const a of polys) {
      const b = a.box;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (a.rings.some((part) => pointInPolygon([x, y], part.rings))) {
        counts.set(a.id, counts.get(a.id) + 1);
        break;
      }
    }
  }
  return counts;
}
