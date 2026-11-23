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
 * Every circular window: for each center, the other areas nearest first (ties
 * by index), cut where the population would pass maxPop × total or the
 * distance would pass maxMetres. Returns { starts, order, radius } in flat
 * arrays: window k of center i holds order[starts[i] … starts[i] + k].
 */
export function windows(xy, population, { maxPop = 0.5, maxMetres = Infinity } = {}) {
  const n = xy.length,
    limit = maxPop * population.reduce((s, p) => s + p, 0);
  const starts = new Int32Array(n + 1),
    lists = [];
  for (let i = 0; i < n; i++) {
    const d = xy.map(([x, y], j) => [(x - xy[i][0]) ** 2 + (y - xy[i][1]) ** 2, j]);
    d.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const list = [];
    let pop = 0;
    for (const [d2, j] of d) {
      if (Math.sqrt(d2) > maxMetres) break;
      pop += population[j];
      if (pop > limit) break;
      list.push(j, Math.sqrt(d2));
    }
    starts[i + 1] = starts[i] + list.length / 2;
    lists.push(list);
  }
  const order = new Int32Array(starts[n]),
    radius = new Float64Array(starts[n]);
  lists.forEach((list, i) => {
    for (let k = 0; k < list.length / 2; k++) {
      order[starts[i] + k] = list[2 * k];
      radius[starts[i] + k] = list[2 * k + 1];
    }
  });
  return { starts, order, radius };
}

// The best window over all centers for case counts `cases`: { llr, center, size }.
function bestWindow(cases, expectedPer, C, zones, direction, minCases, skip) {
  const { starts, order } = zones;
  let best = { llr: 0, center: -1, size: 0 };
  for (let i = 0; i + 1 < starts.length; i++) {
    let c = 0,
      e = 0;
    for (let k = starts[i]; k < starts[i + 1]; k++) {
      const j = order[k];
      if (skip && skip[j]) break;
      c += cases[j];
      e += expectedPer[j];
      if (direction === "high" && c < minCases) continue;
      const v = llr(c, e, C, direction);
      if (v > best.llr) best = { llr: v, center: i, size: k - starts[i] + 1 };
    }
  }
  return best;
}

/**
 * The scan: ids and their cases, population and projected points. Options:
 * maxPop (share of the population, default 0.5), maxMiles, direction
 * ("high"), replicates (999), seed, minCases (2, as smerc), clusters (most
 * windows reported, 10) and alpha (0.05: clusters reported if p ≤ alpha,
 * the most likely one always).
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
  onProgress = () => {},
}) {
  const n = ids.length;
  if (n < 3) throw new Error("The scan needs at least three areas with counts.");
  const C = cases.reduce((s, c) => s + c, 0),
    P = population.reduce((s, p) => s + p, 0);
  if (!(C > 0)) throw new Error("The scan needs at least one case.");
  if (!Number.isInteger(replicates) || replicates < 9 || replicates > 99999)
    throw new Error("Choose between 9 and 99,999 replicates.");
  const expectedPer = population.map((p) => (C * p) / P);
  const zones = windows(points, population, { maxPop, maxMetres: maxMiles ? maxMiles * 1609.344 : Infinity });
  // Observed clusters: the best window, then the best that overlaps none chosen so far.
  const found = [],
    taken = new Uint8Array(n);
  for (let r = 0; r < clusters; r++) {
    const best = bestWindowAvoiding(cases, expectedPer, C, zones, direction, minCases, taken);
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
    maxima[r] = bestWindow(simulated, expectedPer, C, zones, direction, minCases).llr;
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
      radius: zones.radius[zones.starts[f.center] + f.size - 1],
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

// The best window that touches no area already taken (secondary clusters).
function bestWindowAvoiding(cases, expectedPer, C, zones, direction, minCases, taken) {
  const { starts, order } = zones;
  let best = { llr: 0, center: -1, size: 0 };
  for (let i = 0; i + 1 < starts.length; i++) {
    let c = 0,
      e = 0;
    for (let k = starts[i]; k < starts[i + 1]; k++) {
      const j = order[k];
      if (taken[j]) break;
      c += cases[j];
      e += expectedPer[j];
      if (direction === "high" && c < minCases) continue;
      const v = llr(c, e, C, direction);
      if (v > best.llr) best = { llr: v, center: i, size: k - starts[i] + 1 };
    }
  }
  return best;
}

/**
 * The scan over a layer's areas, keyed by id: `cases` and `population` by
 * id, projected `points`, an optional study area. Areas without a count, a
 * population or a location are left out and say why. Returns a result the
 * method registry reads (stats/methods.js, "scan").
 */
export function scanAreas({ cases, population, points, studyIds, maxPop = 0.25, maxMiles = null, direction = "high", permutations = 999, seed = 12345, onProgress }) {
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
    onProgress,
  });
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
