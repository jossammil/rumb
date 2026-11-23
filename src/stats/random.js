// Seeded random numbers for permutation tests and Monte Carlo replicates.
// A uint32 seed determines every draw, so results repeat across browsers.
// Pure.

import { lgamma } from "./dist.js";

/** Mulberry32: a function returning uniform numbers in [0, 1). */
export function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles an array in place (Fisher–Yates) and returns it. */
export function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

// Inversion (Kachitvichyanukul & Schmeiser's BINV): walk the distribution
// function from zero. Used while n·p is small, so the walk is short.
function binomialInversion(n, p, random) {
  const q = 1 - p,
    s = p / q,
    a = (n + 1) * s;
  for (;;) {
    let r = q ** n,
      u = random(),
      x = 0;
    while (u > r) {
      u -= r;
      x++;
      if (x > n) break;
      r *= a / x - s;
    }
    if (x <= n) return x;
  }
}

// Transformed rejection with squeeze (Hörmann 1993, "BTRS"), for n·p ≥ 10.
function binomialRejection(n, p, random) {
  const q = 1 - p,
    spq = Math.sqrt(n * p * q),
    b = 1.15 + 2.53 * spq,
    a = -0.0873 + 0.0248 * b + 0.01 * p,
    c = n * p + 0.5,
    vr = 0.92 - 4.2 / b,
    alpha = (2.83 + 5.1 / b) * spq,
    lpq = Math.log(p / q),
    m = Math.floor((n + 1) * p),
    h = lgamma(m + 1) + lgamma(n - m + 1);
  for (;;) {
    const u = random() - 0.5,
      us = 0.5 - Math.abs(u);
    let v = random();
    const k = Math.floor(((2 * a) / us + b) * u + c);
    if (k < 0 || k > n) continue;
    if (us >= 0.07 && v <= vr) return k;
    v = Math.log((v * alpha) / (a / (us * us) + b));
    if (v <= h - lgamma(k + 1) - lgamma(n - k + 1) + (k - m) * lpq) return k;
  }
}

/** A binomial draw: successes in n trials with probability p. */
export function binomial(n, p, random) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  // Draw the rarer outcome, so the samplers see p ≤ ½.
  if (p > 0.5) return n - binomial(n, 1 - p, random);
  return n * p < 10 ? binomialInversion(n, p, random) : binomialRejection(n, p, random);
}

/**
 * A multinomial draw of n items over categories with the given weights
 * (any non-negative scale), by sequential conditional binomials. Returns an
 * Int32Array of counts. `tail` may pass precomputed suffix sums of the weights.
 */
export function multinomial(n, weights, random, tail = suffixSums(weights)) {
  const counts = new Int32Array(weights.length);
  let left = n;
  for (let i = 0; i < weights.length && left > 0; i++) {
    if (tail[i] <= 0) break;
    const k = i === weights.length - 1 ? left : binomial(left, Math.min(1, weights[i] / tail[i]), random);
    counts[i] = k;
    left -= k;
  }
  return counts;
}

/** Suffix sums: tail[i] = weights[i] + … + weights[last]. */
export function suffixSums(weights) {
  const tail = new Float64Array(weights.length);
  let sum = 0;
  for (let i = weights.length - 1; i >= 0; i--) tail[i] = sum += weights[i];
  return tail;
}
