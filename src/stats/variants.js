// Two variants of Local Moran (Anselin 1995):
// - bivariate: an area's value against the spatial lag of a second measure
//   (Anselin, Syabri & Smirnov 2002), as GeoDa and spdep::localmoran_bv do;
// - EB-adjusted: Moran's I on rates standardized by Assunção & Reis's (1999)
//   empirical Bayes method, so areas with small populations do not dominate,
//   as spdep::EBImoran.mc and GeoDa's "EB Rate" Moran do.
// Both reuse the eligibility, weights and inference of stats.js. Pure.
import { randomGenerator } from "./random.js";
import { adjustFdr, analyze, checkSettings, extremeThreshold, prepareUniverse } from "./stats.js";

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const standardize = (v) => {
  const m = mean(v),
    sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  return v.map((x) => (x - m) / sd);
};

/**
 * Assunção–Reis empirical Bayes standardization of rates events/base:
 * z_i = (r_i − b) / √(a + b / base_i), with b the pooled rate and a the
 * method-of-moments between-area variance (raised to b / mean base when it
 * comes out negative, as spdep does). Returns { z, a, b }.
 */
export function ebStandardize(events, base) {
  const m = events.length,
    totalE = events.reduce((s, x) => s + x, 0),
    totalB = base.reduce((s, x) => s + x, 0);
  const b = totalE / totalB;
  const rates = events.map((e, i) => e / base[i]);
  const s2 = rates.reduce((s, r, i) => s + base[i] * (r - b) ** 2, 0) / totalB;
  let a = s2 - b / (totalB / m);
  if (a < 0) a = b / (totalB / m);
  return { z: rates.map((r, i) => (r - b) / Math.sqrt(a + b / base[i])), a, b };
}

/** Moran's I and LISA on EB-standardized rates: `events` and `base` by id. */
export async function ebMoran(input) {
  const { events, base } = input;
  const rates = Object.fromEntries(
    Object.keys(events).map((id) => [id, base[id] > 0 && Number.isFinite(events[id]) ? events[id] / base[id] : null]),
  );
  const { ids } = prepareUniverse({ ...input, values: rates, denominators: base });
  if (ids.length < 3) throw new Error("The study area needs at least three areas with counts and eligible neighbors.");
  const eb = ebStandardize(
    ids.map((id) => events[id]),
    ids.map((id) => base[id]),
  );
  const values = { ...rates };
  ids.forEach((id, i) => (values[id] = eb.z[i]));
  const result = await analyze({ ...input, values, denominators: base });
  // Keep each area's raw rate for the inspector beside its EB score.
  for (const id of Object.keys(result.byId)) result.byId[id].rate = rates[id];
  return {
    ...result,
    method: "eblisa",
    eb: { a: eb.a, b: eb.b },
    methodNote:
      "Assunção–Reis empirical Bayes standardization of rates (spdep's rule for a negative variance), then " +
      result.methodNote.charAt(0).toLowerCase() +
      result.methodNote.slice(1),
  };
}

/**
 * Bivariate Local Moran: z(x)_i times the weighted mean of z(y) over i's
 * neighbors. Inputs are those of stats.analyze plus `second` (y by id).
 * Conditional permutations keep x_i and draw the neighbors' y from the other
 * areas; the global statistic is Σ z(x) lag z(y) / Σ z(x)², the slope of the
 * bivariate Moran scatterplot.
 */
export async function bivariate(input) {
  const { values, second, permutations = 999, seed = 12345, alpha = 0.05, fdr = false } = input;
  checkSettings({ permutations, seed, alpha });
  // An area needs both measures.
  const both = Object.fromEntries(
    Object.entries(values).map(([id, v]) => [id, Number.isFinite(v) && Number.isFinite(second?.[id]) ? v : null]),
  );
  const { ids, byId, rows, w, weights } = prepareUniverse({ ...input, values: both });
  const n = ids.length;
  if (n < 3) throw new Error("The study area needs at least three areas with both measures and eligible neighbors.");
  const xs = ids.map((id) => values[id]),
    ys = ids.map((id) => second[id]);
  if (xs.every((v) => v === xs[0]) || ys.every((v) => v === ys[0]))
    throw new Error("Bivariate Moran’s I requires two measures that both vary.");
  const zx = standardize(xs),
    zy = standardize(ys);
  const totals = rows.map((row, i) => (w ? w[i].reduce((s, v) => s + v, 0) : row.length));
  const lagOf = (z) =>
    rows.map((row, i) => {
      let sum = 0;
      for (let k = 0; k < row.length; k++) sum += (w ? w[i][k] : 1) * z[row[k]];
      return sum / totals[i];
    });
  const lag = lagOf(zy);
  const local = zx.map((z, i) => z * lag[i]);
  const sxx = zx.reduce((s, z) => s + z * z, 0);
  const globalI = zx.reduce((s, z, i) => s + z * lag[i], 0) / sxx;
  const random = randomGenerator(seed);
  // Global: shuffle y over the areas, two-sided about the null expectation.
  const expected = -1 / (n - 1);
  const threshold = extremeThreshold(globalI, expected);
  const shuffled = zy.slice();
  let extreme = 0;
  for (let draw = 0; draw < permutations; draw++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const l = lagOf(shuffled);
    if (Math.abs(zx.reduce((s, z, i) => s + z * l[i], 0) / sxx - expected) >= threshold) extreme++;
  }
  const globalP = (extreme + 1) / (permutations + 1);
  // Local: conditional permutations of y among the other areas.
  const pool = Int32Array.from({ length: n }, (_, i) => i);
  const swaps = new Int32Array(n);
  const p = rows.map((row, i) => {
    const e = (zx[i] * -zy[i]) / (n - 1);
    const t = extremeThreshold(local[i], e);
    if (t <= 0) return 1;
    pool[i] = n - 1;
    let count = 0;
    for (let draw = 0; draw < permutations; draw++) {
      let sum = 0;
      for (let k = 0; k < row.length; k++) {
        const j = k + Math.floor(random() * (n - 1 - k));
        swaps[k] = j;
        const picked = pool[j];
        pool[j] = pool[k];
        pool[k] = picked;
        sum += (w ? w[i][k] : 1) * zy[picked];
      }
      if (Math.abs((zx[i] * sum) / totals[i] - e) >= t) count++;
      for (let k = row.length - 1; k >= 0; k--) {
        const j = swaps[k];
        const tmp = pool[k];
        pool[k] = pool[j];
        pool[j] = tmp;
      }
    }
    pool[i] = i;
    return (count + 1) / (permutations + 1);
  });
  const q = adjustFdr(p);
  ids.forEach((id, i) => {
    let cluster = "NS";
    if ((fdr ? q[i] : p[i]) <= alpha && zx[i] !== 0 && lag[i] !== 0)
      cluster = (zx[i] > 0 ? "H" : "L") + (lag[i] > 0 ? "H" : "L");
    Object.assign(byId[id], { second: second[id], z: zx[i], lag: lag[i], localI: local[i], p: p[i], q: q[i], cluster });
  });
  return {
    method: "bilisa",
    globalI,
    globalP,
    expectedI: expected,
    n,
    permutations,
    seed,
    alpha,
    fdr,
    byId,
    weights,
    methodNote:
      "Bivariate Local Moran: standardized measure times the row-standardized spatial lag of the standardized second measure; two-sided global shuffles of the second measure and local conditional permutations; Benjamini-Hochberg adjusted q-values.",
  };
}
