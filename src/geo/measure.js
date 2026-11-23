// Lengths and areas measured in the region's projected plane, in miles and
// square miles (the units map_pdo and map_project report). Pure.

export const METRES_PER_MILE = 1609.344;

/** Total length in metres of a path of projected points [[x, y], …]. */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** Area in square metres of a ring of projected points (closed or not), by the shoelace formula. */
export function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i],
      [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * A measurement of lon/lat vertices: { miles, closedMiles, squareMiles }.
 * Area (and the length around) needs three vertices.
 */
export function measurePath(lonlats, projection) {
  const xy = lonlats.map((p) => projection.forward(p));
  const miles = pathLength(xy) / METRES_PER_MILE;
  if (xy.length < 3) return { miles, closedMiles: null, squareMiles: null };
  return {
    miles,
    closedMiles: pathLength([...xy, xy[0]]) / METRES_PER_MILE,
    squareMiles: ringArea(xy) / METRES_PER_MILE ** 2,
  };
}

/** "0.42 mi", "12.3 mi", "1,204 mi"; square miles the same way. */
export function formatMiles(value, unit = "mi") {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = value < 1 ? 2 : value < 100 ? 1 : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " " + unit;
}
