// Distribution functions against R (tests/stats-reference.json, written by
// scripts/reference-stats.R), and the seeded samplers by their moments and a
// goodness-of-fit test at fixed seeds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as d from "../src/stats/dist.js";
import { binomial, multinomial, randomGenerator, shuffle } from "../src/stats/random.js";

const ref = JSON.parse(readFileSync(new URL("./stats-reference.json", import.meta.url))).distributions;
const close = (got, want, tol, what) => {
  const err = got === want ? 0 : Math.abs(got - want) / Math.max(Math.abs(want), 1e-300);
  assert.ok(err <= tol, `${what}: ${got} vs R ${want} (relative error ${err.toExponential(2)})`);
};

test("distribution functions match R to 1e-12, deep tails included", () => {
  for (const r of ref.pnorm) {
    close(d.pnorm(r.x), r.lower, 1e-12, "pnorm " + r.x);
    close(d.pnorm(r.x, false), r.upper, 1e-12, "upper pnorm " + r.x);
  }
  for (const r of ref.pt) {
    close(d.pt(r.t, r.df), r.lower, 1e-12, `pt ${r.t} ${r.df}`);
    close(d.pt(r.t, r.df, false), r.upper, 1e-12, `upper pt ${r.t} ${r.df}`);
  }
  for (const r of ref.pf) {
    close(d.pf(r.f, r.d1, r.d2), r.lower, 1e-12, `pf ${r.f} ${r.d1} ${r.d2}`);
    close(d.pf(r.f, r.d1, r.d2, false), r.upper, 1e-12, `upper pf ${r.f} ${r.d1} ${r.d2}`);
  }
  for (const r of ref.pchisq) {
    close(d.pchisq(r.x, r.k), r.lower, 1e-12, `pchisq ${r.x} ${r.k}`);
    close(d.pchisq(r.x, r.k, false), r.upper, 1e-12, `upper pchisq ${r.x} ${r.k}`);
  }
  for (const r of ref.ppois) {
    close(d.ppois(r.k, r.lambda), r.lower, 1e-12, `ppois ${r.k} ${r.lambda}`);
    close(d.ppois(r.k, r.lambda, false), r.upper, 1e-12, `upper ppois ${r.k} ${r.lambda}`);
  }
  for (const r of ref.lgamma) assert.ok(Math.abs(d.lgamma(r.x) - r.y) <= 1e-13 * Math.max(1, Math.abs(r.y)), "lgamma " + r.x);
});

test("quantiles invert their distribution functions and match R", () => {
  // R's lower-tail quantiles lose precision when p is within 1e-12 of 1; there
  // the check is the round trip, which R's own upper tail confirms.
  for (const r of ref.qnorm) {
    close(d.qnorm(r.p), r.x, 1e-12, "qnorm " + r.p);
    close(d.pnorm(d.qnorm(r.p)), r.p, 1e-12, "pnorm(qnorm) " + r.p);
  }
  for (const r of ref.qt) close(d.qt(r.p, r.df), r.x, 1e-12, `qt ${r.p} ${r.df}`);
  for (const r of ref.qchisq) {
    const x = d.qchisq(r.p, r.k);
    close(x, r.x, 1e-10, `qchisq ${r.p} ${r.k}`);
    const tail = 1 - r.p;
    if (r.p > 0.5) close(d.pchisq(x, r.k, false), tail, 1e-12, `round trip ${r.p} ${r.k}`);
    else close(d.pchisq(x, r.k), r.p, 1e-12, `round trip ${r.p} ${r.k}`);
  }
  for (const r of ref.qgamma) close(d.qgamma(r.p, r.shape), r.x, 1e-12, `qgamma ${r.p} ${r.shape}`);
  assert.equal(d.qgamma(1e-8, 0.01), 0, "a quantile below the smallest double is 0, as in R");
});

test("exact Poisson limits match poisson.test", () => {
  for (const r of ref.poissonCI) {
    const [lo, hi] = d.poissonCI(r.count);
    close(lo, r.lower, 1e-12, "lower " + r.count);
    close(hi, r.upper, 1e-12, "upper " + r.count);
  }
});

test("the seeded stream is unchanged and shuffles are permutations", () => {
  const random = randomGenerator(12345);
  assert.deepEqual(Array.from({ length: 4 }, random), [
    0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
  ]);
  const order = shuffle([...Array(50).keys()], randomGenerator(7));
  assert.deepEqual([...order].sort((a, b) => a - b), [...Array(50).keys()]);
  assert.notDeepEqual(order, [...Array(50).keys()]);
});

// Pearson's chi-square over cells with expected counts of at least 5.
function goodnessOfFit(draws, n, p) {
  const tally = new Map();
  for (const k of draws) tally.set(k, (tally.get(k) || 0) + 1);
  const lpmf = (k) => d.lgamma(n + 1) - d.lgamma(k + 1) - d.lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p);
  let stat = 0,
    cells = 0,
    restExpected = draws.length,
    restSeen = draws.length;
  for (let k = 0; k <= n; k++) {
    const e = draws.length * Math.exp(lpmf(k));
    if (e < 5) continue;
    const o = tally.get(k) || 0;
    stat += (o - e) ** 2 / e;
    cells++;
    restExpected -= e;
    restSeen -= o;
  }
  if (restExpected >= 5) {
    stat += (restSeen - restExpected) ** 2 / restExpected;
    cells++;
  }
  return d.pchisq(stat, cells - 1, false);
}

test("binomial draws have the right distribution in every sampler", () => {
  const random = randomGenerator(2026);
  for (const [n, p] of [
    [20, 0.3], // inversion
    [60, 0.1], // inversion near the switch
    [1000, 0.3], // transformed rejection
    [100000, 0.001], // rejection at n·p = 100
    [50, 0.9], // the complement
    [200, 0.5],
  ]) {
    const draws = Array.from({ length: 20000 }, () => binomial(n, p, random));
    assert.ok(draws.every((k) => Number.isInteger(k) && k >= 0 && k <= n), `range ${n} ${p}`);
    const mean = draws.reduce((s, k) => s + k, 0) / draws.length;
    const variance = draws.reduce((s, k) => s + (k - mean) ** 2, 0) / (draws.length - 1);
    const sd = Math.sqrt(n * p * (1 - p));
    assert.ok(Math.abs(mean - n * p) < (4 * sd) / Math.sqrt(draws.length), `mean ${n} ${p}: ${mean}`);
    assert.ok(Math.abs(variance / (sd * sd) - 1) < 0.06, `variance ${n} ${p}: ${variance}`);
    assert.ok(goodnessOfFit(draws, n, p) > 0.001, `goodness of fit ${n} ${p}`);
  }
  assert.equal(binomial(10, 0, random), 0);
  assert.equal(binomial(10, 1, random), 10);
});

test("multinomial draws keep the total and the proportions", () => {
  const random = randomGenerator(99);
  const weights = [5, 0, 1, 3, 1];
  const sums = new Float64Array(weights.length);
  for (let i = 0; i < 4000; i++) {
    const counts = multinomial(1000, weights, random);
    assert.equal(counts.reduce((s, k) => s + k, 0), 1000);
    assert.equal(counts[1], 0, "a zero weight never draws");
    counts.forEach((k, j) => (sums[j] += k));
  }
  weights.forEach((w, j) => assert.ok(Math.abs(sums[j] / 4000 / 1000 - w / 10) < 0.002, "share " + j));
});
