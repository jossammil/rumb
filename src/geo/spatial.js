// Plane geometry on projected coordinates (metres): bounding boxes, point in
// polygon, and distances between points, lines and polygons. Enough for the
// map's filters and counts without a database. Pure.

/** Every ring or line of a projected geometry as arrays of [x, y], with its role. */
export function parts(g) {
  if (!g) return [];
  switch (g.type) {
    case "Point":
      return [{ type: "point", coords: [g.coordinates] }];
    case "MultiPoint":
      return g.coordinates.map((c) => ({ type: "point", coords: [c] }));
    case "LineString":
      return [{ type: "line", coords: g.coordinates }];
    case "MultiLineString":
      return g.coordinates.map((c) => ({ type: "line", coords: c }));
    case "Polygon":
      return [{ type: "polygon", rings: g.coordinates }];
    case "MultiPolygon":
      return g.coordinates.map((rings) => ({ type: "polygon", rings }));
    case "GeometryCollection":
      return g.geometries.flatMap(parts);
    default:
      return [];
  }
}

/** A geometry with every position passed through fn([lon, lat]) → [x, y]. */
export function mapGeometry(g, fn) {
  if (!g) return g;
  const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.map(walk));
  if (g.type === "GeometryCollection") return { ...g, geometries: g.geometries.map((x) => mapGeometry(x, fn)) };
  return { type: g.type, coordinates: walk(g.coordinates) };
}

/** [minX, minY, maxX, maxY] of a geometry. */
export function bbox(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < b[0]) b[0] = c[0];
      if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0];
      if (c[1] > b[3]) b[3] = c[1];
    } else c.forEach(walk);
  };
  if (g?.type === "GeometryCollection") g.geometries.forEach((x) => walk(x.coordinates));
  else if (g) walk(g.coordinates);
  return b;
}

/** Distance between two boxes (0 when they overlap). */
export function boxDistance(a, b) {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]),
    dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy);
}

/** True when a point lies inside a ring (crossing number; points on an edge count as outside). */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when a point lies inside a polygon's outer ring and outside its holes. */
export const pointInPolygon = (p, rings) => pointInRing(p, rings[0]) && !rings.slice(1).some((h) => pointInRing(p, h));

/** Distance from a point to the segment a–b. */
export function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Each segment [a, b] of a part (its rings, its line, or a lone point). */
function* segments(part) {
  const lines = part.type === "polygon" ? part.rings : [part.coords];
  for (const line of lines) {
    if (line.length === 1) yield [line[0], line[0]];
    for (let i = 1; i < line.length; i++) yield [line[i - 1], line[i]];
  }
}

/** Distance from a point to a geometry: 0 inside a polygon. */
export function pointDistance(p, g) {
  let best = Infinity;
  for (const part of parts(g)) {
    if (part.type === "polygon" && pointInPolygon(p, part.rings)) return 0;
    for (const [a, b] of segments(part)) best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
}

const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
/** True when segments a–b and c–d share a point. */
function crosses(a, b, c, d) {
  const o1 = orient(a, b, c),
    o2 = orient(a, b, d),
    o3 = orient(c, d, a),
    o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p, q, r) =>
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/** Shortest distance between two geometries: 0 when they touch, cross or one contains the other. */
export function geometryDistance(g1, g2, { boxes } = {}) {
  const p1 = parts(g1),
    p2 = parts(g2);
  // A vertex of one inside a polygon of the other means they overlap.
  for (const [ours, theirs] of [[p1, p2], [p2, p1]])
    for (const a of ours) {
      const first = a.type === "polygon" ? a.rings[0][0] : a.coords[0];
      for (const b of theirs) if (b.type === "polygon" && pointInPolygon(first, b.rings)) return 0;
    }
  let best = Infinity;
  for (const a of p1)
    for (const b of p2)
      for (const [s1, e1] of segments(a))
        for (const [s2, e2] of segments(b)) {
          if (crosses(s1, e1, s2, e2)) return 0;
          best = Math.min(best, segmentDistance(s1, s2, e2), segmentDistance(e1, s2, e2), segmentDistance(s2, s1, e1), segmentDistance(e2, s1, e1));
        }
  return best;
}
