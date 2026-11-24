// Kulldorff's spatial scan statistic, Poisson model, purely spatial
// (Kulldorff 1997): circular windows grown around each area's center, one
// area at a time in order of distance, up to a share of the total population
// (and optionally a radius). Each window's log-likelihood ratio compares the
// rate inside with the rate outside; the windows with the largest ratios are
// the most likely clusters. Significance comes from Monte Carlo replicates:
// the total case count redistributed in proportion to population, and the
// largest ratio recorded each time. Secondary clusters may not overlap a
// stronger one. Checked against smerc::scan.test. Pure.
import { multinomial, randomGenerator, suffixSums } from "./random.js";

/**
 * The window's log-likelihood ratio, for c cases where e were expected out of
 * C in all. `direction` "high" scores excesses, "low" deficits, "both" either.
 */
export function llr(c, e, C, direction = "high") {
  if (c > e ? direction === "low" : c < e ? direction === "high" : true) return 0;
  const inside = c > 0 ? c * Math.log(c / e) : 0;
  const outside = C - c > 0 ? (C - c) * Math.log((C - c) / (C - e)) : 0;
  return inside + outside;
}

/**
 * A work budget for the scan: window entries × replicates. Each replicate
 * walks every entry once; about this many steps take 20–30 seconds in a
 * browser tab. Mississippi's tracts at 50% of the population and 999
 * replicates need about 0.4 billion.
 */
export const SCAN_BUDGET = 2e9;

const MILE = 1609.344;

// The digit `pass` (11 bits, least significant first) of a non-negative
// double's bit pattern, whose order is the numbers' order.
function digit(lo, hi, pass) {
  switch (pass) {
    case 0:
      return lo & 2047;
    case 1:
      return (lo >>> 11) & 2047;
    case 2:
      return ((lo >>> 22) | (hi << 10)) & 2047;
    case 3:
      return (hi >>> 1) & 2047;
    case 4:
      return (hi >>> 12) & 2047;
    default:
      return hi >>> 23;
  }
}

/**
 * Areas ordered by squared distance from a center, ties by index, in typed
 * scratch arrays reused for every center. An LSD radix sort over the bits of
 * the squared distances is stable, so ties keep index order, exactly as a
 * comparison sort on (distance, index) would.
 */
function distanceOrder(xy) {
  const n = xy.length,
    xs = Float64Array.from(xy, (p) => p[0]),
    ys = Float64Array.from(xy, (p) => p[1]);
  const d2 = new Float64Array(n),
    bits = new Uint32Array(d2.buffer),
    area = new Int32Array(n),
    count = new Int32Array(2048);
  let a = new Int32Array(n),
    b = new Int32Array(n);
  const sorted = new Int32Array(n),
    dist2 = new Float64Array(n);
  /** Fills sorted[0 … m) with the areas within maxMetres of center i, nearest first; returns m. */
  const fill = (i, maxMetres) => {
    const x0 = xs[i],
      y0 = ys[i],
      capped = maxMetres < Infinity;
    let m = 0;
    for (let j = 0; j < n; j++) {
      const v = (xs[j] - x0) ** 2 + (ys[j] - y0) ** 2;
      if (capped && Math.sqrt(v) > maxMetres) continue;
      d2[m] = v;
      area[m] = j;
      a[m] = m;
      m++;
    }
    for (let pass = 0; pass < 6; pass++) {
      count.fill(0);
      for (let k = 0; k < m; k++) count[digit(bits[2 * a[k]], bits[2 * a[k] + 1], pass)]++;
      if (m === 0 || count[digit(bits[2 * a[0]], bits[2 * a[0] + 1], pass)] === m) continue;
      let sum = 0;
      for (let c = 0; c < 2048; c++) {
        const t = count[c];
        count[c] = sum;
        sum += t;
      }
      for (let k = 0; k < m; k++) {
        const p = a[k];
        b[count[digit(bits[2 * p], bits[2 * p + 1], pass)]++] = p;
      }
      [a, b] = [b, a];
    }
    for (let k = 0; k < m; k++) {
      sorted[k] = area[a[k]];
      dist2[k] = d2[a[k]];
    }
    return m;
  };
  return Object.assign(fill, { sorted, dist2 });
}

/**
 * The first pass over the windows: how many areas each center's window
 * holds, the total (window entries) and a histogram of the entries by
 * distance from their center in whole miles (bin b holds b − 1 < d ≤ b; the
 * last bin, 301, everything past 300 mi), from which a radius cap's entries
 * follow without another pass.
 */
function windowSizes(xy, population, maxPop, maxMetres) {
  const n = xy.length,
    limit = maxPop * population.reduce((s, p) => s + p, 0);
  const nearest = distanceOrder(xy),
    { sorted, dist2 } = nearest,
    sizes = new Int32Array(n),
    histogram = new Float64Array(302);
  let entries = 0;
  for (let i = 0; i < n; i++) {
    const m = nearest(i, maxMetres);
    let pop = 0,
      k = 0;
    for (; k < m; k++) {
      pop += population[sorted[k]];
      if (pop > limit) break;
      histogram[Math.min(301, Math.ceil(Math.sqrt(dist2[k]) / MILE))]++;
    }
    sizes[i] = k;
    entries += k;
  }
  return { sizes, entries, histogram, nearest };
}

/**
 * Every circular window: for each center, the other areas nearest first (ties
 * by index), cut where the population would pass maxPop × total or the
 * distance would pass maxMetres. Returns { starts, order } in flat typed
 * arrays: window k of center i holds order[starts[i] … starts[i] + k]. Built
 * in two passes, sizes then members, so nothing larger than the result is
 * ever held.
 */
export function windows(xy, population, { maxPop = 0.5, maxMetres = Infinity } = {}) {
  return fillWindows(windowSizes(xy, population, maxPop, maxMetres), maxMetres);
}

// The second pass: the members, into arrays sized by the first.
function fillWindows({ sizes, entries, nearest }, maxMetres) {
  const n = sizes.length,
    starts = new Int32Array(n + 1),
    order = new Int32Array(entries);
  for (let i = 0; i < n; i++) starts[i + 1] = starts[i] + sizes[i];
  const { sorted } = nearest;
  for (let i = 0; i < n; i++) {
    nearest(i, maxMetres);
    order.set(sorted.subarray(0, sizes[i]), starts[i]);
  }
  return { starts, order };
}

/**
 * What a scan too large for the budget could change: the largest whole-mile
 * radius (up to 300) whose windows fit with the same replicates, and the
 * most replicates of 999 and 99, fewer than asked, that fit as the windows
 * stand. Returns { entries, replicates, work, budget, miles, fewerReplicates,
 * message }; either suggestion is null when none fits.
 */
export function scanAdvice({ entries, histogram }, replicates, budget = SCAN_BUDGET) {
  let miles = null,
    within = histogram[0];
  for (let r = 1; r <= 300; r++) {
    within += histogram[r];
    if (within * replicates <= budget) miles = r;
  }
  const fewerReplicates = [999, 99].find((r) => r < replicates && entries * r <= budget) ?? null;
  const options = [miles && "limit the radius to " + miles + " mi", fewerReplicates && "use " + fewerReplicates + " replicates under Test settings"].filter(Boolean);
  const message =
    "This scan is too large to run here: " + Math.round(entries).toLocaleString("en-US") + " windows, each tried " +
    replicates.toLocaleString("en-US") + " times. " +
    (options.length
      ? options.join(" or ").replace(/^./, (c) => c.toUpperCase()) + "."
      : "Choose a smaller largest window or a radius.");
  return { entries, replicates, work: entries * replicates, budget, miles, fewerReplicates, message };
}

/**
 * The best window over all centers for case counts `cases`: { llr, center,
 * size }. Windows stop at an area already `taken` (secondary clusters). The
 * ratio is computed only where the window's rate runs the chosen way.
 */
function bestWindow(cases, expectedPer, C, zones, direction, minCases, taken) {
  const { starts, order } = zones,
    high = direction !== "low",
    low = direction !== "high",
    floor = direction === "high" ? minCases : -Infinity;
  let best = { llr: 0, center: -1, size: 0 };
  for (let i = 0; i + 1 < starts.length; i++) {
    let c = 0,
      e = 0;
    const end = starts[i + 1];
    for (let k = starts[i]; k < end; k++) {
      const j = order[k];
      if (taken[j]) break;
      c += cases[j];
      e += expectedPer[j];
      if (c > e ? high && c >= floor : c < e && low) {
        const v = llr(c, e, C, direction);
        if (v > best.llr) best = { llr: v, center: i, size: k - starts[i] + 1 };
      }
    }
  }
  return best;
}

// The largest ratio over every window, for one replicate: bestWindow's loop
// without the taken areas, kept apart so the hot loop stays simple.
function largestRatio(cases, expectedPer, C, zones, direction, minCases) {
  const { starts, order } = zones,
    high = direction !== "low",
    low = direction !== "high",
    floor = direction === "high" ? minCases : -Infinity;
  let best = 0;
  for (let i = 0, n = starts.length - 1; i < n; i++) {
    let c = 0,
      e = 0;
    const end = starts[i + 1];
    for (let k = starts[i]; k < end; k++) {
      const j = order[k];
      c += cases[j];
      e += expectedPer[j];
      if (c > e ? high && c >= floor : c < e && low) {
        const v = llr(c, e, C, direction);
        if (v > best) best = v;
      }
    }
  }
  return best;
}

/**
 * The scan: ids and their cases, population and projected points. Options:
 * maxPop (share of the population, default 0.5), maxMiles, direction
 * ("high"), replicates (999), seed, minCases (2, as smerc), clusters (most
 * windows reported, 10) and alpha (0.05: clusters reported if p ≤ alpha,
 * the most likely one always). A scan whose window entries × replicates pass
 * `budget` does not run and returns { advice } (scanAdvice) instead.
 */
export function scan({
  ids,
  cases,
  population,
  points,
  maxPop = 0.5,
  maxMiles = null,
  direction = "high",
  replicates = 999,
  seed = 12345,
  minCases = 2,
  clusters = 10,
  alpha = 0.05,
  budget = SCAN_BUDGET,
  onProgress = () => {},
}) {
  const n = ids.length;
  if (n < 3) throw new Error("The scan needs at least three areas with counts.");
  const C = cases.reduce((s, c) => s + c, 0),
    P = population.reduce((s, p) => s + p, 0);
  if (!(C > 0)) throw new Error("The scan needs at least one case.");
  if (!Number.isInteger(replicates) || replicates < 9 || replicates > 99999)
    throw new Error("Choose between 9 and 99,999 replicates.");
  const expectedPer = Float64Array.from(population, (p) => (C * p) / P);
  const maxMetres = maxMiles ? maxMiles * MILE : Infinity;
  const sizes = windowSizes(points, population, maxPop, maxMetres);
  if (sizes.entries * replicates > budget) return { advice: scanAdvice(sizes, replicates, budget) };
  const zones = fillWindows(sizes, maxMetres);
  sizes.nearest = null;
  // Observed clusters: the best window, then the best that overlaps none chosen so far.
  const found = [],
    taken = new Uint8Array(n);
  for (let r = 0; r < clusters; r++) {
    const best = bestWindow(cases, expectedPer, C, zones, direction, minCases, taken);
    if (best.center < 0 || best.llr <= 0) break;
    const members = [];
    for (let k = 0; k < best.size; k++) members.push(zones.order[zones.starts[best.center] + k]);
    for (const j of members) taken[j] = 1;
    found.push({ ...best, members });
  }
  // Monte Carlo: the largest ratio under the null, for every replicate.
  const random = randomGenerator(seed),
    tail = suffixSums(population),
    maxima = new Float64Array(replicates);
  for (let r = 0; r < replicates; r++) {
    const simulated = multinomial(C, population, random, tail);
    maxima[r] = largestRatio(simulated, expectedPer, C, zones, direction, minCases);
    if (r % 50 === 49) onProgress((r + 1) / replicates);
  }
  const pOf = (v) => (maxima.reduce((s, m) => s + (m >= v - 1e-9 * Math.max(1, v) ? 1 : 0), 0) + 1) / (replicates + 1);
  const result = found.map((f, rank) => {
    const c = f.members.reduce((s, j) => s + cases[j], 0),
      e = f.members.reduce((s, j) => s + expectedPer[j], 0),
      pop = f.members.reduce((s, j) => s + population[j], 0);
    return {
      rank: rank + 1,
      center: ids[f.center],
      members: f.members.map((j) => ids[j]),
      // The window's radius: the distance to its farthest member, the last added.
      radius: Math.sqrt(
        (points[f.members.at(-1)][0] - points[f.center][0]) ** 2 + (points[f.members.at(-1)][1] - points[f.center][1]) ** 2,
      ),
      cases: c,
      expected: e,
      population: pop,
      ratio: c / e,
      relativeRisk: c / e / ((C - c) / (C - e)),
      llr: f.llr,
      p: pOf(f.llr),
    };
  });
  return {
    clusters: result.filter((k, i) => i === 0 || k.p <= alpha),
    total: { cases: C, population: P, rate: C / P },
    maxima: Array.from(maxima),
  };
}

/**
 * The scan over a layer's areas, keyed by id: `cases` and `population` by
 * id, projected `points`, an optional study area. Areas without a count, a
 * population or a location are left out and say why. Returns a result the
 * method registry reads (stats/methods.js, "scan"), or { method: "scan",
 * advice } for a scan past the work budget.
 */
export function scanAreas({
  cases,
  population,
  points,
  studyIds,
  maxPop = 0.25,
  maxMiles = null,
  direction = "high",
  permutations = 999,
  seed = 12345,
  budget = SCAN_BUDGET,
  onProgress,
}) {
  const study = studyIds == null ? null : new Set(studyIds.map(String));
  const byId = Object.create(null),
    ids = [];
  for (const id of Object.keys(cases).sort()) {
    const c = cases[id],
      p = population[id];
    let reason = null;
    if (study && !study.has(id)) reason = "Outside study area";
    else if (!Number.isFinite(c) || c < 0) reason = "Missing count";
    else if (!(p > 0)) reason = "No population";
    else if (!points?.[id]) reason = "No location";
    byId[id] = { cases: Number.isFinite(c) ? c : null, population: p > 0 ? p : null, reason, cluster: "NA", neighbors: [] };
    if (!reason) ids.push(id);
  }
  const out = scan({
    ids,
    cases: ids.map((id) => cases[id]),
    population: ids.map((id) => population[id]),
    points: ids.map((id) => points[id]),
    maxPop,
    maxMiles,
    direction,
    replicates: permutations,
    seed,
    budget,
    onProgress,
  });
  if (out.advice) return { method: "scan", n: ids.length, advice: out.advice };
  const { total } = out;
  for (const id of ids) {
    const r = byId[id];
    r.expected = (total.cases * r.population) / total.population;
    r.cluster = "NS";
  }
  for (const k of out.clusters) for (const id of k.members) byId[id].cluster = "K" + k.rank;
  const missing = Object.values(byId).filter((r) => r.reason === "Missing count").length;
  return {
    method: "scan",
    n: ids.length,
    missing,
    clusters: out.clusters,
    total,
    byId,
    permutations,
    seed,
    alpha: 0.05,
    fdr: false,
    maxPop,
    maxMiles,
    direction,
    methodNote:
      "Kulldorff spatial scan, Poisson model, purely spatial: circular windows around each area's center of population up to " +
      Math.round(maxPop * 100) + "% of the population" + (maxMiles ? " and " + maxMiles + " mi" : "") +
      "; expected counts at the overall rate; Monte Carlo p-values from " + permutations +
      " multinomial replicates; secondary clusters do not overlap a stronger one.",
  };
}
