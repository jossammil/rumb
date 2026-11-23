// Moran statistics use row-standardized weights over the analysis universe:
// first-order contiguity (queen or rook, from a neighbor graph) or distance
// weights (k nearest, a band, inverse distance) built between the eligible
// areas' projected points. Binary rows keep GeoDa's arithmetic exactly;
// weighted rows divide each weighted sum by the row's total.
import { DISTANCE_KINDS, describeWeights, distanceWeights, weightsSpec, weightsSummary } from "./neighbors.js";
import { randomGenerator } from "./random.js";

// The browser build puts GeoDaLib's wasm in a versioned folder beside the
// worker (scripts/build.mjs); tests in Node read it from node_modules.
function lisaWasm() {
  if (typeof __LISA_WASM__ !== "undefined")
    return new URL(__LISA_WASM__, self.location.href).href;
  return new URL("../../node_modules/@geoda/lisa/wasm/geoda-lisa.wasm", import.meta.url).href;
}

const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export function adjustFdr(pValues) {
  const ordered = pValues
    .map((p, index) => ({ p, index }))
    .sort((a, b) => a.p - b.p);
  const adjusted = new Array(ordered.length);
  let upper = 1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    upper = Math.min(upper, (ordered[i].p * ordered.length) / (i + 1));
    adjusted[ordered[i].index] = upper;
  }
  return adjusted;
}

function analysisUniverse(values, neighbors, studyIds, denominators, spec, points) {
  const study = studyIds == null ? null : new Set(studyIds.map(String));
  const byId = Object.create(null);
  const eligible = new Set();
  const byDistance = DISTANCE_KINDS.has(spec.kind);
  const allIds = [
    ...new Set([...Object.keys(values), ...Object.keys(byDistance ? points || {} : neighbors || {})]),
  ].sort();
  for (const id of allIds) {
    const value = Number.isFinite(values[id]) ? values[id] : null;
    let reason = null;
    if (study && !study.has(id)) reason = "Outside study area";
    else if (denominators?.[id] === 0) reason = "Zero denominator";
    else if (value === null) reason = "Missing estimate";
    else if (byDistance && !points?.[id]) reason = "No location";
    byId[id] = {
      value,
      z: null,
      lag: null,
      localI: null,
      p: null,
      q: null,
      cluster: "NA",
      neighbors: [],
      reason,
    };
    if (!reason) eligible.add(id);
  }
  if (byDistance) return distanceUniverse([...eligible], byId, spec, points);
  const ids = [];
  for (const id of eligible) {
    const adjacent = [...new Set((neighbors[id] ?? []).map(String))]
      .filter((j) => j !== id && eligible.has(j))
      .sort();
    if (!adjacent.length) {
      byId[id].reason = "No eligible neighbors";
      continue;
    }
    ids.push(id);
    byId[id].neighbors = adjacent;
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  const rows = ids.map((id) => byId[id].neighbors.map((j) => index.get(j)));
  const edges = rows.map((row) => new Set(row));
  if (rows.some((row, i) => row.some((j) => !edges[j]?.has(i)))) {
    throw new Error("Contiguity must be symmetric. Check the neighbor file.");
  }
  return { ids, byId, rows, w: null, threshold: null };
}

// Distance weights are built among the eligible areas only, so every area
// keeps its k neighbors inside the study area. Areas a band leaves alone drop out.
function distanceUniverse(candidates, byId, spec, points) {
  const built = distanceWeights(spec, candidates.map((id) => points[id]));
  const keep = candidates.map((_, i) => built.rows[i].length > 0);
  const position = new Map();
  candidates.forEach((id, i) => {
    if (keep[i]) position.set(i, position.size);
    else byId[id].reason = "No eligible neighbors";
  });
  const ids = candidates.filter((_, i) => keep[i]);
  const rows = [],
    w = built.w ? [] : null;
  candidates.forEach((id, i) => {
    if (!keep[i]) return;
    rows.push(built.rows[i].map((j) => position.get(j)));
    if (w) w.push(built.w[i]);
    byId[id].neighbors = built.rows[i].map((j) => candidates[j]).sort();
  });
  return { ids, byId, rows, w, threshold: built.threshold, symmetric: built.symmetric };
}

// Row totals of the weights, or null for binary rows (whose total is the count).
const rowTotals = (w) => w && w.map((row) => row.reduce((s, x) => s + x, 0));

function globalI(z, rows, sumSquares, w = null, totals = null) {
  let product = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let sum = 0;
    if (w) {
      const wi = w[i];
      for (let k = 0; k < row.length; k++) sum += wi[k] * z[row[k]];
      product += (z[i] * sum) / totals[i];
    } else {
      for (let k = 0; k < row.length; k++) sum += z[row[k]];
      product += (z[i] * sum) / row.length;
    }
  }
  return product / sumSquares;
}

/** The spatial lag of z: each row's weighted mean. */
function spatialLag(z, rows, w, totals) {
  return rows.map((row, i) => {
    let sum = 0;
    for (let k = 0; k < row.length; k++) sum += (w ? w[i][k] : 1) * z[row[k]];
    return sum / (w ? totals[i] : row.length);
  });
}

export function extremeThreshold(observed, expected) {
  // Addition order changes at permutation time. Equal statistics include floating-point ties.
  const distance = Math.abs(observed - expected);
  return distance - 1e-12 * Math.max(1, distance);
}

function globalPermutationP(
  z,
  rows,
  sumSquares,
  observed,
  permutations,
  random,
  w = null,
  totals = null,
) {
  const expected = -1 / (z.length - 1);
  const threshold = extremeThreshold(observed, expected);
  const shuffled = z.slice();
  let extreme = 0;
  for (let draw = 0; draw < permutations; draw++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    if (Math.abs(globalI(shuffled, rows, sumSquares, w, totals) - expected) >= threshold)
      extreme++;
  }
  return (extreme + 1) / (permutations + 1);
}

function localPermutationP(z, rows, observed, permutations, random, w = null, totals = null) {
  // Each focal value stays fixed. Sample its neighbor count without replacement
  // from all other eligible areas, using a reversible partial Fisher-Yates shuffle.
  const pool = Int32Array.from({ length: z.length }, (_, i) => i);
  const swaps = new Int32Array(z.length);
  return rows.map((row, i) => {
    const expected = (-z[i] * z[i]) / (z.length - 1);
    const threshold = extremeThreshold(observed[i], expected);
    // With equal weights, an area next to every other one cannot vary.
    if (threshold <= 0 || (!w && row.length === z.length - 1)) return 1;
    const wi = w?.[i];
    pool[i] = z.length - 1;
    let extreme = 0;
    for (let draw = 0; draw < permutations; draw++) {
      let sum = 0;
      for (let k = 0; k < row.length; k++) {
        const j = k + Math.floor(random() * (z.length - 1 - k));
        swaps[k] = j;
        const selected = pool[j];
        pool[j] = pool[k];
        pool[k] = selected;
        sum += wi ? wi[k] * z[selected] : z[selected];
      }
      const simulated = (z[i] * sum) / (wi ? totals[i] : row.length);
      if (Math.abs(simulated - expected) >= threshold) extreme++;
      for (let k = row.length - 1; k >= 0; k--) {
        const j = swaps[k];
        const tmp = pool[k];
        pool[k] = pool[j];
        pool[j] = tmp;
      }
    }
    pool[i] = i;
    return (extreme + 1) / (permutations + 1);
  });
}

/** Throws a readable message for an inference setting out of range. */
export function checkSettings({ permutations, seed, alpha }) {
  if (!Number.isInteger(permutations) || permutations < 1 || permutations > 99999)
    throw new Error("Choose a permutation count between 1 and 99,999.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Use an unsigned 32-bit seed.");
  if (!(alpha > 0 && alpha < 1)) throw new Error("Choose a significance level between 0 and 1.");
}

/**
 * The areas an analysis uses, from the same inputs as analyze(): { ids,
 * byId, rows, w, weights }. Ineligible areas stay in byId with a reason.
 */
export function prepareUniverse({ values, neighbors, points, weights, studyIds, denominators }) {
  const spec = weightsSpec(weights);
  const universe = analysisUniverse(values, neighbors, studyIds, denominators, spec, points);
  return {
    ...universe,
    weights: {
      ...spec,
      threshold: universe.threshold,
      label: describeWeights(spec, universe.threshold),
      summary: weightsSummary(universe.rows),
    },
  };
}

export async function analyze({
  values,
  neighbors,
  points,
  weights,
  studyIds,
  denominators,
  permutations = 999,
  seed = 12345,
  alpha = 0.05,
  fdr = false,
}) {
  checkSettings({ permutations, seed, alpha });
  const spec = weightsSpec(weights);
  const { ids, byId, rows, w, threshold } = analysisUniverse(
    values,
    neighbors,
    studyIds,
    denominators,
    spec,
    points,
  );
  const totals = rowTotals(w);
  const n = ids.length;
  if (n < 3)
    throw new Error(
      "The study area needs at least three areas with values and eligible neighbors.",
    );
  const data = ids.map((id) => byId[id].value);
  const mean = average(data);
  const squared = data.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  if (
    !(squared > 0) ||
    !Number.isFinite(squared) ||
    data.every((v) => v === data[0])
  ) {
    throw new Error("Moran’s I requires a numeric measure with variation.");
  }
  const sd = Math.sqrt(squared / (n - 1));
  const z = data.map((value) => (value - mean) / sd);
  // For binary rows GeoDa supplies observed statistics and lags; weighted rows
  // use the same formula here. Inference below uses an explicit two-sided rule
  // that counts ties and gives invariant permutations a p-value of 1.
  let observed;
  if (w) {
    const lagValues = spatialLag(z, rows, w, totals);
    observed = { isValid: true, lagValues, lisaValues: z.map((zi, i) => zi * lagValues[i]) };
  } else {
    const lisa = await import("@geoda/lisa");
    lisa.setDeliveryWASM(lisaWasm());
    observed = await lisa.localMoran({
      data,
      neighbors: rows,
      permutation: 0,
      seed,
    });
  }
  if (
    !observed.isValid ||
    observed.lisaValues.length !== n ||
    !observed.lisaValues.every(Number.isFinite)
  ) {
    throw new Error(
      "The local Moran calculation did not produce a finite result for each eligible area.",
    );
  }
  const sumSquares = z.reduce((sum, v) => sum + v * v, 0);
  const statistic = globalI(z, rows, sumSquares, w, totals);
  const random = randomGenerator(seed);
  const globalP = globalPermutationP(
    z,
    rows,
    sumSquares,
    statistic,
    permutations,
    random,
    w,
    totals,
  );
  const p = localPermutationP(
    z,
    rows,
    observed.lisaValues,
    permutations,
    random,
    w,
    totals,
  );
  const q = adjustFdr(p);
  ids.forEach((id, i) => {
    const lag = observed.lagValues[i];
    let cluster = "NS";
    if ((fdr ? q[i] : p[i]) <= alpha && z[i] !== 0 && lag !== 0) {
      cluster = (z[i] > 0 ? "H" : "L") + (lag > 0 ? "H" : "L");
    }
    Object.assign(byId[id], {
      z: z[i],
      lag,
      localI: observed.lisaValues[i],
      p: p[i],
      q: q[i],
      cluster,
    });
  });
  return {
    globalI: statistic,
    globalP,
    expectedI: -1 / (n - 1),
    n,
    mean,
    sd,
    permutations,
    seed,
    alpha,
    fdr,
    byId,
    weights: { ...spec, threshold, label: describeWeights(spec, threshold), summary: weightsSummary(rows) },
    method: "lisa",
    methodNote:
      "GeoDa sample-standardized Local Moran I; row-standardized weights; two-sided global shuffles and local conditional permutations about the null expectation, with ties included; Benjamini-Hochberg adjusted q-values.",
  };
}
