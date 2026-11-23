// Hot and cold spots: the local Getis–Ord Gi* statistic (Ord & Getis 1995),
// with the global General G (Getis & Ord 1992) and Geary's C (Geary 1954;
// Cliff & Ord 1981). Pure.
//
// Gi* includes each area in its own neighborhood. Its z-score is unchanged
// when a row of weights is rescaled, so binary and row-standardized weights
// give the same Gi*. Self weight is 1 for binary weights; with inverse
// distance it equals the row's largest weight, as if the area were as near
// as its nearest neighbor. Inference is the normal approximation by default
// (as in ArcGIS Hot Spot Analysis and spdep::localG), or conditional
// permutations (as in GeoDa), with optional Benjamini–Hochberg control of
// the false discovery rate. Areas are binned by confidence: 99, 95 or 90%.
import { pnorm } from "./dist.js";
import { randomGenerator } from "./random.js";
import { adjustFdr, checkSettings, extremeThreshold, prepareUniverse } from "./stats.js";

export const BINS = [
  ["H99", "Hot spot, 99% confidence", 0.01],
  ["H95", "Hot spot, 95% confidence", 0.05],
  ["H90", "Hot spot, 90% confidence", 0.1],
  ["C90", "Cold spot, 90% confidence", 0.1],
  ["C95", "Cold spot, 95% confidence", 0.05],
  ["C99", "Cold spot, 99% confidence", 0.01],
];

/** The confidence bin of a z-score and its (adjusted) p-value. */
export function binOf(z, p) {
  if (!(p <= 0.1) || z === 0) return "NS";
  const level = p <= 0.01 ? "99" : p <= 0.05 ? "95" : "90";
  return (z > 0 ? "H" : "C") + level;
}

/** Each row with its own index added, and the weights to match. */
function withSelf(rows, w) {
  const selfRows = rows.map((row, i) => [i, ...row]);
  const selfW = w
    ? w.map((row) => [Math.max(...row), ...row])
    : rows.map((row) => new Array(row.length + 1).fill(1));
  return { rows: selfRows, w: selfW };
}

/** Gi* z-scores for values x over rows (each including itself) with weights w. */
export function giStar(x, rows, w) {
  const n = x.length;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const s = Math.sqrt(x.reduce((t, v) => t + v * v, 0) / n - mean * mean);
  return rows.map((row, i) => {
    let sum = 0,
      W = 0,
      S1 = 0;
    for (let k = 0; k < row.length; k++) {
      const wk = w[i][k];
      sum += wk * x[row[k]];
      W += wk;
      S1 += wk * wk;
    }
    return (sum - mean * W) / (s * Math.sqrt((n * S1 - W * W) / (n - 1)));
  });
}

// Conditional permutations: each area keeps its value; its neighbors' values
// are drawn without replacement from all other areas (a reversible partial
// Fisher–Yates shuffle). Two-sided about the null expectation, ties included.
function giPermutationP(x, rows, w, permutations, random) {
  const n = x.length,
    total = x.reduce((s, v) => s + v, 0);
  const pool = Int32Array.from({ length: n }, (_, i) => i);
  const swaps = new Int32Array(n);
  return rows.map((row, i) => {
    // rows[i][0] is i itself; the rest are its neighbors.
    const k = row.length - 1,
      wi = w[i];
    let observed = wi[0] * x[i],
      otherWeight = 0;
    for (let m = 1; m <= k; m++) {
      observed += wi[m] * x[row[m]];
      otherWeight += wi[m];
    }
    const expected = wi[0] * x[i] + (otherWeight * (total - x[i])) / (n - 1);
    const threshold = extremeThreshold(observed, expected);
    if (threshold <= 0) return 1;
    pool[i] = n - 1;
    let extreme = 0;
    for (let draw = 0; draw < permutations; draw++) {
      let sum = wi[0] * x[i];
      for (let m = 0; m < k; m++) {
        const j = m + Math.floor(random() * (n - 1 - m));
        swaps[m] = j;
        const picked = pool[j];
        pool[j] = pool[m];
        pool[m] = picked;
        sum += wi[m + 1] * x[picked];
      }
      if (Math.abs(sum - expected) >= threshold) extreme++;
      for (let m = k - 1; m >= 0; m--) {
        const j = swaps[m];
        const tmp = pool[m];
        pool[m] = pool[j];
        pool[j] = tmp;
      }
    }
    pool[i] = i;
    return (extreme + 1) / (permutations + 1);
  });
}

// Weight sums for the global statistics: S0 = Σ w, S1 = ½ Σ (w_ij + w_ji)²,
// S2 = Σ_i (w_i· + w_·i)², over a dense copy (n is at most a few thousand).
function weightSums(rows, w, n) {
  const pairs = new Map();
  const key = (i, j) => i * n + j;
  const out = new Float64Array(n),
    into = new Float64Array(n);
  let S0 = 0;
  rows.forEach((row, i) =>
    row.forEach((j, m) => {
      const v = w ? w[i][m] : 1;
      pairs.set(key(i, j), (pairs.get(key(i, j)) || 0) + v);
      out[i] += v;
      into[j] += v;
      S0 += v;
    }),
  );
  // S1 = ½ Σ_ij (w_ij + w_ji)²: each unordered pair once, a self pair as 2 w_ii².
  let S1 = 0;
  for (const [k, v] of pairs) {
    const i = Math.floor(k / n),
      j = k % n;
    if (i === j) S1 += 2 * v * v;
    else {
      const back = pairs.get(key(j, i));
      if (back === undefined) S1 += v * v;
      else if (i < j) S1 += (v + back) ** 2;
    }
  }
  let S2 = 0;
  for (let i = 0; i < n; i++) S2 += (out[i] + into[i]) ** 2;
  return { S0, S1, S2 };
}

/** Getis & Ord's General G with its randomization moments (values must be ≥ 0). */
export function generalG(x, rows, w = null) {
  const n = x.length;
  let num = 0;
  rows.forEach((row, i) => row.forEach((j, m) => (num += (w ? w[i][m] : 1) * x[i] * x[j])));
  const m1 = x.reduce((s, v) => s + v, 0),
    m2 = x.reduce((s, v) => s + v * v, 0),
    m3 = x.reduce((s, v) => s + v ** 3, 0),
    m4 = x.reduce((s, v) => s + v ** 4, 0);
  const G = num / (m1 * m1 - m2);
  const { S0, S1, S2 } = weightSums(rows, w, n);
  const expected = S0 / (n * (n - 1));
  const B0 = (n * n - 3 * n + 3) * S1 - n * S2 + 3 * S0 * S0;
  const B1 = -((n * n - n) * S1 - 2 * n * S2 + 6 * S0 * S0);
  const B2 = -(2 * n * S1 - (n + 3) * S2 + 6 * S0 * S0);
  const B3 = 4 * (n - 1) * S1 - 2 * (n + 1) * S2 + 8 * S0 * S0;
  const B4 = S1 - S2 + S0 * S0;
  const EG2 =
    (B0 * m2 * m2 + B1 * m4 + B2 * m1 * m1 * m2 + B3 * m1 * m3 + B4 * m1 ** 4) /
    ((m1 * m1 - m2) ** 2 * n * (n - 1) * (n - 2) * (n - 3));
  const variance = EG2 - expected * expected;
  return { G, expected, variance, z: (G - expected) / Math.sqrt(variance) };
}

/** Geary's C over row-standardized weights, with its randomization variance. */
export function gearyC(x, rows, w = null) {
  const n = x.length,
    mean = x.reduce((s, v) => s + v, 0) / n;
  const z = x.map((v) => v - mean),
    z2 = z.reduce((s, v) => s + v * v, 0);
  const totals = rows.map((row, i) => (w ? w[i].reduce((s, v) => s + v, 0) : row.length));
  const sw = rows.map((row, i) => row.map((_, m) => (w ? w[i][m] : 1) / totals[i]));
  let num = 0;
  rows.forEach((row, i) => row.forEach((j, m) => (num += sw[i][m] * (x[i] - x[j]) ** 2)));
  const { S0, S1, S2 } = weightSums(rows, sw, n);
  const C = ((n - 1) * num) / (2 * S0 * z2);
  const K = (n * z.reduce((s, v) => s + v ** 4, 0)) / (z2 * z2);
  const n1 = n - 1;
  let variance = n1 * S1 * (n * n - 3 * n + 3 - n1 * K);
  variance -= 0.25 * n1 * S2 * (n * n + 3 * n - 6 - (n * n - n + 2) * K);
  variance += S0 * S0 * (n * n - 3 - n1 * n1 * K);
  variance /= n * (n - 2) * (n - 3) * S0 * S0;
  return { C, expected: 1, variance, z: (C - 1) / Math.sqrt(variance) };
}

// A global statistic's permutation p-value: shuffle all values, two-sided about its expectation.
function globalPermutationP(x, statistic, observed, expected, permutations, random) {
  const threshold = extremeThreshold(observed, expected);
  const shuffled = x.slice();
  let extreme = 0;
  for (let draw = 0; draw < permutations; draw++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    if (Math.abs(statistic(shuffled) - expected) >= threshold) extreme++;
  }
  return (extreme + 1) / (permutations + 1);
}

/**
 * Gi* for every eligible area, plus General G (for non-negative measures)
 * and Geary's C. Takes the same inputs as stats.analyze, and `inference`:
 * "normal" (default) or "permutation".
 */
export async function hotSpots(input) {
  const { values, permutations = 999, seed = 12345, alpha = 0.05, fdr = false, inference = "normal" } = input;
  checkSettings({ permutations, seed, alpha });
  const { ids, byId, rows, w, weights } = prepareUniverse(input);
  const n = ids.length;
  if (n < 4) throw new Error("Hot spot analysis needs at least four areas with values and eligible neighbors.");
  const x = ids.map((id) => byId[id].value);
  if (x.every((v) => v === x[0])) throw new Error("Hot spot analysis requires a measure with variation.");
  const self = withSelf(rows, w);
  const z = giStar(x, self.rows, self.w);
  const random = randomGenerator(seed);
  const p =
    inference === "permutation"
      ? giPermutationP(x, self.rows, self.w, permutations, random)
      : z.map((zi) => 2 * pnorm(-Math.abs(zi)));
  const q = adjustFdr(p);
  ids.forEach((id, i) => {
    const used = fdr ? q[i] : p[i];
    Object.assign(byId[id], { gi: z[i], p: p[i], q: q[i], cluster: binOf(z[i], used) });
  });
  // Global statistics: General G needs non-negative values.
  const positive = x.every((v) => v >= 0);
  const G = positive ? generalG(x, rows, w) : null;
  if (G) G.p = globalPermutationP(x, (s) => generalG(s, rows, w).G, G.G, G.expected, permutations, random);
  const C = gearyC(x, rows, w);
  C.p = globalPermutationP(x, (s) => gearyC(s, rows, w).C, C.C, 1, permutations, random);
  return {
    method: "gistar",
    n,
    mean: x.reduce((s, v) => s + v, 0) / n,
    inference,
    permutations,
    seed,
    alpha,
    fdr,
    byId,
    weights,
    generalG: G,
    geary: C,
    methodNote:
      "Getis–Ord Gi* including each area in its own neighborhood; " +
      (inference === "permutation"
        ? "two-sided conditional-permutation pseudo p-values"
        : "two-sided normal p-values") +
      (fdr ? " with Benjamini–Hochberg q-values" : "") +
      "; bins at 99, 95 and 90% confidence. General G and Geary's C with randomization moments and permutation p-values.",
  };
}
