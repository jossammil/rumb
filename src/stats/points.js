// Point patterns in the region's projected plane (metres in; miles and
// square miles out):
// - average nearest neighbor (Clark & Evans 1954): the mean distance to the
//   nearest other point against its expectation under complete spatial
//   randomness (CSR) in the study area, with a z test;
// - Ripley's K as L(d) − d (Besag 1977), with no edge correction, against
//   an envelope of simulated CSR patterns drawn inside the region's outline;
// - centrography: the (weighted) mean center, the median center (Weiszfeld's
//   iteration), the standard distance and the standard deviational ellipse,
//   with the √2 correction Esri adopted (Wang, Shi & Stump 2015);
// - kernel density with the quartic kernel (Silverman 1986, eq. 4.5), and
//   Esri's spatial variant of Silverman's rule for the default bandwidth.
// Pure.
import { pnorm } from "./dist.js";
import { pointInPolygon } from "../geo/spatial.js";

export const METRES_PER_MILE = 1609.344;
const SQ_MILE = METRES_PER_MILE * METRES_PER_MILE;
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);

/** The area of projected polygons (each a list of rings: outer, then holes). */
export function polygonArea(polygons) {
  const ring = (r) => {
    let a = 0;
    for (let i = 0; i + 1 < r.length; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    return Math.abs(a) / 2;
  };
  return polygons.reduce((s, rings) => s + ring(rings[0]) - rings.slice(1).reduce((h, r) => h + ring(r), 0), 0);
}

/** Whether a projected point lies inside any of the polygons. */
export const inside = (p, polygons) => polygons.some((rings) => pointInPolygon(p, rings));

/** Each point's distance to its nearest other point. */
export function nearestDistances(xy) {
  return xy.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < xy.length; j++) if (j !== i) best = Math.min(best, dist(p, xy[j]));
    return best;
  });
}

/** The average nearest neighbor ratio and its z test (two-sided). */
export function averageNearestNeighbor(xy, area) {
  const n = xy.length;
  if (n < 3) throw new Error("A point pattern needs at least three points.");
  const observed = nearestDistances(xy).reduce((s, d) => s + d, 0) / n;
  const expected = 0.5 / Math.sqrt(n / area);
  const se = 0.26136 / Math.sqrt((n * n) / area);
  const z = (observed - expected) / se;
  return {
    n,
    area: area / SQ_MILE,
    observed: observed / METRES_PER_MILE,
    expected: expected / METRES_PER_MILE,
    ratio: observed / expected,
    z,
    p: 2 * pnorm(-Math.abs(z)),
  };
}

/**
 * L(d) − d for each distance d (metres, ascending), from all point pairs, no
 * edge correction. Pairs are counted into the distance bands directly, so
 * large patterns need no sort.
 */
export function ripleyL(xy, area, distances) {
  const n = xy.length,
    m = distances.length,
    max = distances[m - 1],
    max2 = max * max,
    squared = distances.map((d) => d * d);
  const bands = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const [xi, yi] = xy[i];
    for (let j = i + 1; j < n; j++) {
      const dx = xy[j][0] - xi,
        dy = xy[j][1] - yi,
        d2 = dx * dx + dy * dy;
      if (d2 > max2) continue;
      // The first band that holds this pair.
      let lo = 0,
        hi = m - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (squared[mid] >= d2) hi = mid;
        else lo = mid + 1;
      }
      bands[lo]++;
    }
  }
  let pairs = 0;
  return distances.map((d, k) => {
    pairs += bands[k];
    // Each unordered pair counts twice in K.
    const K = (area * 2 * pairs) / (n * (n - 1));
    return Math.sqrt(K / Math.PI) - d;
  });
}

/** n points uniformly at random inside the polygons, by rejection within their bounding box. */
export function randomPoints(n, polygons, random) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons)
    for (const [x, y] of rings[0]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const out = [];
  while (out.length < n) {
    const p = [x0 + random() * (x1 - x0), y0 + random() * (y1 - y0)];
    if (inside(p, polygons)) out.push(p);
  }
  return out;
}

/** The pointwise min and max of L(d) − d over simulated CSR patterns of the same size. */
export function envelope(n, polygons, area, distances, simulations, random) {
  const lo = distances.map(() => Infinity),
    hi = distances.map(() => -Infinity);
  for (let s = 0; s < simulations; s++) {
    const L = ripleyL(randomPoints(n, polygons, random), area, distances);
    L.forEach((v, i) => {
      lo[i] = Math.min(lo[i], v);
      hi[i] = Math.max(hi[i], v);
    });
  }
  return { lo, hi };
}

/**
 * Centrography of (weighted) points: mean center, median center, standard
 * distance and the standard deviational ellipse { cx, cy, theta, sx, sy }:
 * sx is the spread along the x axis turned clockwise by θ, sy along the y
 * axis turned the same way (Yuill 1971).
 */
export function centrography(xy, weights = null) {
  const w = weights || xy.map(() => 1);
  const W = w.reduce((s, v) => s + v, 0);
  if (!(W > 0)) throw new Error("The weights must add up to more than zero.");
  const mx = xy.reduce((s, p, i) => s + w[i] * p[0], 0) / W,
    my = xy.reduce((s, p, i) => s + w[i] * p[1], 0) / W;
  // Weiszfeld's iteration for the point minimizing the weighted sum of distances.
  let cx = mx,
    cy = my;
  for (let iter = 0; iter < 1000; iter++) {
    let nx = 0,
      ny = 0,
      den = 0;
    for (let i = 0; i < xy.length; i++) {
      const d = Math.max(dist(xy[i], [cx, cy]), 1e-9);
      nx += (w[i] * xy[i][0]) / d;
      ny += (w[i] * xy[i][1]) / d;
      den += w[i] / d;
    }
    const step = Math.hypot(nx / den - cx, ny / den - cy);
    cx = nx / den;
    cy = ny / den;
    if (step < 1e-6) break;
  }
  let sxx = 0,
    syy = 0,
    sxy = 0;
  xy.forEach(([x, y], i) => {
    const dx = x - mx,
      dy = y - my;
    sxx += w[i] * dx * dx;
    syy += w[i] * dy * dy;
    sxy += w[i] * dx * dy;
  });
  const standardDistance = Math.sqrt((sxx + syy) / W);
  // tan θ = ((Σx̃² − Σỹ²) + √((Σx̃² − Σỹ²)² + 4(Σx̃ỹ)²)) / (2 Σx̃ỹ) (Yuill 1971).
  const a = sxx - syy,
    theta = sxy === 0 ? (a >= 0 ? Math.PI / 2 : 0) : Math.atan((a + Math.sqrt(a * a + 4 * sxy * sxy)) / (2 * sxy));
  const cos = Math.cos(theta),
    sin = Math.sin(theta);
  let su = 0,
    sv = 0;
  xy.forEach(([x, y], i) => {
    const dx = x - mx,
      dy = y - my;
    su += w[i] * (dx * cos - dy * sin) ** 2;
    sv += w[i] * (dx * sin + dy * cos) ** 2;
  });
  // The √2 makes one standard deviation hold about 68% of points (Wang et al. 2015).
  const sx = Math.SQRT2 * Math.sqrt(su / W),
    sy = Math.SQRT2 * Math.sqrt(sv / W);
  return {
    mean: [mx, my],
    median: [cx, cy],
    standardDistance,
    ellipse: { cx: mx, cy: my, theta, sx, sy },
  };
}

/** The ellipse as a ring of projected points. */
export function ellipseRing({ cx, cy, theta, sx, sy }, steps = 72) {
  // u runs along (cos θ, −sin θ) and v along (sin θ, cos θ), the axes sx and sy were measured on.
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (2 * Math.PI * (i % steps)) / steps;
    const u = sx * Math.cos(t),
      v = sy * Math.sin(t);
    return [cx + u * Math.cos(theta) + v * Math.sin(theta), cy - u * Math.sin(theta) + v * Math.cos(theta)];
  });
}

/**
 * Esri's default search radius: 0.9 × min(SD, √(1/ln 2) × Dm) × n^−0.2, with
 * SD the standard distance and Dm the median distance from the mean center
 * (both weighted when there are weights; n is then their sum).
 */
export function defaultBandwidth(xy, weights = null) {
  const { mean, standardDistance } = centrography(xy, weights);
  const w = weights || xy.map(() => 1);
  const d = xy.map((p, i) => [dist(p, mean), w[i]]).sort((a, b) => a[0] - b[0]);
  const half = w.reduce((s, v) => s + v, 0) / 2;
  let acc = 0,
    median = d.at(-1)[0];
  for (const [di, wi] of d) {
    acc += wi;
    if (acc >= half) {
      median = di;
      break;
    }
  }
  const n = w.reduce((s, v) => s + v, 0);
  return 0.9 * Math.min(standardDistance, Math.sqrt(1 / Math.LN2) * median) * n ** -0.2;
}

/** Quartic kernel density at a location (per square mile), bandwidth r in metres. */
export function quarticDensity(at, xy, weights, r) {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const d2 = (xy[i][0] - at[0]) ** 2 + (xy[i][1] - at[1]) ** 2;
    if (d2 < r * r) s += (weights ? weights[i] : 1) * (1 - d2 / (r * r)) ** 2;
  }
  return ((3 / Math.PI) * s * SQ_MILE) / (r * r);
}

/**
 * A density surface on square cells inside the outline: { cell, bandwidth,
 * cells: [[x, y, density]] } with cell centers in metres and density per
 * square mile. Cells with no density are left out.
 */
export function densityGrid(xy, weights, polygons, { bandwidth, cell } = {}) {
  if (xy.length < 2) throw new Error("A density surface needs at least two points.");
  const r = bandwidth || defaultBandwidth(xy, weights);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons)
    for (const [x, y] of rings[0]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const size = cell || Math.min(x1 - x0, y1 - y0) / 100;
  const cells = [];
  for (let y = y0 + size / 2; y < y1; y += size)
    for (let x = x0 + size / 2; x < x1; x += size) {
      if (!inside([x, y], polygons)) continue;
      const v = quarticDensity([x, y], xy, weights, r);
      if (v > 0) cells.push([x, y, v]);
    }
  return { cell: size, bandwidth: r, cells };
}

/**
 * The point-pattern analysis the Spatial analysis section runs: average
 * nearest neighbor, L(d) − d with a CSR envelope, and centrography. `points`
 * and `pointWeights` are keyed by id; `polygons` is the projected outline.
 */
export function pointPattern({ points, pointWeights: weights, polygons, permutations = 99, seed = 12345 }, random) {
  const ids = Object.keys(points).sort().filter((id) => points[id]);
  const xy = ids.map((id) => points[id]);
  const w = weights ? ids.map((id) => (Number.isFinite(weights[id]) && weights[id] > 0 ? weights[id] : 0)) : null;
  const area = polygonArea(polygons);
  const ann = averageNearestNeighbor(xy, area);
  // Distances up to a quarter of the outline's shorter side, in 25 steps.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons)
    for (const [x, y] of rings[0]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const step = Math.min(x1 - x0, y1 - y0) / 4 / 25;
  const distances = Array.from({ length: 25 }, (_, i) => (i + 1) * step);
  const L = ripleyL(xy, area, distances);
  // Large patterns take fewer simulated patterns for the envelope.
  const simulations = Math.min(permutations, xy.length > 1500 ? 19 : xy.length > 500 ? 39 : 99);
  const band = envelope(xy.length, polygons, area, distances, simulations, random);
  const nearest = nearestDistances(xy);
  const byId = Object.create(null);
  ids.forEach((id, i) => (byId[id] = { cluster: "P", nearest: nearest[i] / METRES_PER_MILE, weight: w?.[i] ?? null, neighbors: [], reason: null }));
  const centers = centrography(xy, w);
  const miles = (v) => v / METRES_PER_MILE;
  return {
    method: "points",
    n: xy.length,
    ann,
    ripley: {
      d: distances.map(miles),
      L: L.map(miles),
      lo: band.lo.map(miles),
      hi: band.hi.map(miles),
      simulations,
      above: L.filter((v, i) => v > band.hi[i]).length,
      below: L.filter((v, i) => v < band.lo[i]).length,
    },
    centers,
    weighted: !!weights,
    byId,
    permutations: simulations,
    seed,
    alpha: 0.05,
    fdr: false,
    methodNote:
      "Average nearest neighbor (Clark & Evans) against the area of the region's outline; Ripley's L(d) − d without edge correction, against the range of " +
      simulations +
      " simulated random patterns inside the outline; " +
      (weights ? "weighted " : "") +
      "mean and median (Weiszfeld) centers, standard distance and the standard deviational ellipse (with the √2 correction).",
  };
}

/** The ellipse's major and minor axes (metres) and the major axis's bearing, degrees clockwise from north (0–180). */
export function ellipseAxes({ theta, sx, sy }) {
  // sx runs along (cos θ, −sin θ), sy along (sin θ, cos θ) in (east, north).
  const [ex, ny] = sx >= sy ? [Math.cos(theta), -Math.sin(theta)] : [Math.sin(theta), Math.cos(theta)];
  let bearing = (Math.atan2(ex, ny) * 180) / Math.PI;
  bearing = ((bearing % 180) + 180) % 180;
  return { major: Math.max(sx, sy), minor: Math.min(sx, sy), bearing };
}
