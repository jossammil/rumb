// Distance-based spatial weights for the statistics: k nearest neighbors, a
// distance band, and inverse distance within a band, all measured between
// points in the region's projected plane (EPSG:3814 metres for Mississippi).
// Polygons are represented by their area-weighted centroids, or by centers
// of population where the data ships them. Pure.
//
// A weights set is { rows, w, symmetric, threshold }: rows[i] lists the
// indices of i's neighbors, w[i] their weights in the same order (null for
// binary weights). The analyses row-standardize: each row is divided by its
// sum. Ties in distance break by index, and indices follow sorted ids, so
// every build is deterministic.

export const WEIGHT_KINDS = ["queen", "rook", "knn", "band", "idw"];
export const DISTANCE_KINDS = new Set(["knn", "band", "idw"]);
export const METRES_PER_MILE = 1609.344;
/** The automatic band is the largest nearest-neighbor distance, widened by this much so that pair counts. */
const BAND_SLACK = 1e-9;

/** A weights spec made safe: a known kind and parameters in range. */
export function weightsSpec(spec = {}) {
  const kind = WEIGHT_KINDS.includes(spec.kind) ? spec.kind : "queen";
  const k = Math.min(30, Math.max(1, Math.round(Number(spec.k) || 6)));
  const miles = Number(spec.miles);
  return {
    kind,
    k,
    miles: miles >= 0.1 && miles <= 200 ? miles : null,
    power: Number(spec.power) === 2 ? 2 : 1,
    symmetric: !!spec.symmetric,
  };
}

/** "6 nearest neighbors", "Within 12.3 mi", "Shared edge or corner (queen)"… */
export function describeWeights(spec, threshold) {
  const s = weightsSpec(spec);
  const band = s.miles ?? (threshold != null ? threshold / METRES_PER_MILE : null);
  const within = band != null ? "within " + band.toFixed(1) + " mi" : "within the smallest distance that leaves no area alone";
  switch (s.kind) {
    case "queen":
      return "Shared edge or corner (queen)";
    case "rook":
      return "Shared edge only (rook)";
    case "knn":
      return s.k + " nearest neighbor" + (s.k > 1 ? "s" : "") + (s.symmetric ? ", made symmetric" : "");
    case "band":
      return "Every area " + within;
    case "idw":
      return "Inverse distance" + (s.power === 2 ? " squared" : "") + ", " + within;
  }
}

// ---- centroids ----------------------------------------------------------------

function ringMoments(ring, ox, oy) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const x0 = ring[i][0] - ox,
      y0 = ring[i][1] - oy,
      x1 = ring[i + 1][0] - ox,
      y1 = ring[i + 1][1] - oy;
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return { a: a / 2, cx: cx / 6, cy: cy / 6 };
}

/**
 * The planar centroid of a projected geometry: area-weighted over polygon
 * parts (holes subtracted), length-weighted over lines, the mean of points.
 */
export function centroid(geometry) {
  const type = geometry?.type,
    c = geometry?.coordinates;
  if (type === "Point") return [c[0], c[1]];
  if (type === "MultiPoint") return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
  if (type === "Polygon" || type === "MultiPolygon") {
    const polygons = type === "Polygon" ? [c] : c;
    const [ox, oy] = polygons[0][0][0];
    let area = 0,
      mx = 0,
      my = 0;
    for (const rings of polygons)
      rings.forEach((ring, r) => {
        const m = ringMoments(ring, ox, oy);
        // Shells add and holes subtract, whatever their winding.
        const sign = (r === 0 ? 1 : -1) * Math.sign(m.a);
        area += sign * m.a;
        mx += sign * m.cx;
        my += sign * m.cy;
      });
    if (area > 0) return [ox + mx / area, oy + my / area];
    return centroid({ type: "MultiPoint", coordinates: polygons.flat(2) });
  }
  if (type === "LineString" || type === "MultiLineString") {
    const lines = type === "LineString" ? [c] : c;
    let len = 0,
      mx = 0,
      my = 0;
    for (const line of lines)
      for (let i = 0; i + 1 < line.length; i++) {
        const l = Math.sqrt((line[i + 1][0] - line[i][0]) ** 2 + (line[i + 1][1] - line[i][1]) ** 2);
        len += l;
        mx += l * (line[i][0] + line[i + 1][0]) / 2;
        my += l * (line[i][1] + line[i + 1][1]) / 2;
      }
    if (len > 0) return [mx / len, my / len];
    return centroid({ type: "MultiPoint", coordinates: lines.flat() });
  }
  if (type === "GeometryCollection") return centroid({ type: "MultiPoint", coordinates: geometry.geometries.map(centroid) });
  return null;
}

// ---- weights ----------------------------------------------------------------------

const distance = (a, b) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));

/** Each point's k nearest others, nearest first (ties by index). */
export function knn(xy, k) {
  const n = xy.length;
  k = Math.min(k, n - 1);
  return xy.map((p, i) => {
    const best = [],
      dist = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = distance(p, xy[j]);
      if (best.length === k && d >= dist[k - 1]) continue;
      let at = best.length === k ? k - 1 : best.length;
      while (at > 0 && dist[at - 1] > d) {
        if (at < k) {
          best[at] = best[at - 1];
          dist[at] = dist[at - 1];
        }
        at--;
      }
      best[at] = j;
      dist[at] = d;
    }
    return best;
  });
}

/** The smallest distance at which every point has a neighbor: the largest nearest-neighbor distance. */
export function connectingBand(xy) {
  const nearest = knn(xy, 1);
  let max = 0;
  nearest.forEach((row, i) => {
    if (row.length) max = Math.max(max, distance(xy[i], xy[row[0]]));
  });
  return max * (1 + BAND_SLACK);
}

/** Every other point within `metres` of each point, by index. */
export function band(xy, metres) {
  const n = xy.length,
    rows = xy.map(() => []);
  // Sorting by x lets the scan stop at the band's edge.
  const order = [...xy.keys()].sort((a, b) => xy[a][0] - xy[b][0] || a - b);
  for (let a = 0; a < n; a++) {
    const i = order[a];
    for (let b = a + 1; b < n; b++) {
      const j = order[b];
      if (xy[j][0] - xy[i][0] > metres) break;
      if (distance(xy[i], xy[j]) <= metres) {
        rows[i].push(j);
        rows[j].push(i);
      }
    }
  }
  for (const row of rows) row.sort((a, b) => a - b);
  return rows;
}

/** The union of each row with the rows that name it. */
export function symmetrize(rows) {
  const sets = rows.map((row) => new Set(row));
  rows.forEach((row, i) => row.forEach((j) => sets[j].add(i)));
  return sets.map((s) => [...s].sort((a, b) => a - b));
}

/** Whether j ∈ N(i) exactly when i ∈ N(j). */
export function isSymmetric(rows) {
  const sets = rows.map((row) => new Set(row));
  return rows.every((row, i) => row.every((j) => sets[j]?.has(i)));
}

/**
 * Builds distance weights between projected points: { rows, w, symmetric,
 * threshold }. Inverse-distance weights treat pairs closer than a metre as a
 * metre apart, so coincident points do not get infinite weight.
 */
export function distanceWeights(spec, xy) {
  const s = weightsSpec(spec);
  if (!DISTANCE_KINDS.has(s.kind)) throw new Error("Contiguity weights come from shared boundaries, not distances.");
  if (s.kind === "knn") {
    if (xy.length <= s.k) throw new Error("There are not enough areas for " + s.k + " nearest neighbors.");
    let rows = knn(xy, s.k);
    if (s.symmetric) rows = symmetrize(rows);
    return { rows, w: null, symmetric: s.symmetric || isSymmetric(rows), threshold: null };
  }
  const threshold = s.miles != null ? s.miles * METRES_PER_MILE : connectingBand(xy);
  const rows = band(xy, threshold);
  const w = s.kind === "idw" ? rows.map((row, i) => row.map((j) => Math.max(1, distance(xy[i], xy[j])) ** -s.power)) : null;
  return { rows, w, symmetric: true, threshold };
}

/** Neighbor counts: { n, min, mean, max, islands, histogram: [[count, areas]…] }. */
export function weightsSummary(rows) {
  const counts = rows.map((r) => r.length);
  const tally = new Map();
  for (const c of counts) tally.set(c, (tally.get(c) || 0) + 1);
  const n = counts.length;
  return {
    n,
    min: n ? Math.min(...counts) : 0,
    mean: n ? counts.reduce((s, c) => s + c, 0) / n : 0,
    max: n ? Math.max(...counts) : 0,
    islands: counts.filter((c) => c === 0).length,
    histogram: [...tally].sort((a, b) => a[0] - b[0]),
  };
}

/** "6 neighbors each · no islands", "2–41 neighbors, 9.8 on average · 3 islands". */
export function summaryText(summary) {
  if (!summary) return "";
  const each = summary.min === summary.max;
  const count = each
    ? summary.min + " neighbor" + (summary.min === 1 ? "" : "s") + " each"
    : summary.min + "–" + summary.max + " neighbors, " + summary.mean.toFixed(1) + " on average";
  return count + " · " + (summary.islands ? summary.islands + " without neighbors" : "no islands");
}
