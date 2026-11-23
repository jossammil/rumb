// Probability distributions for the statistics: log-gamma, the regularized
// incomplete gamma and beta functions, and from them the normal, t, F,
// chi-square, gamma and Poisson distributions, their quantiles, and exact
// Poisson confidence limits. Pure.
//
// Written from the published methods, not ported from any GPL source:
// - log-gamma: Lanczos (1964) with g = 7 and nine coefficients, and the
//   reflection formula below 1/2;
// - large shapes: the prefactors x^a e^−x / Γ(a) and x^a (1−x)^b / B(a, b) in
//   Loader's (2000) saddle-point form, with Stirling's series for the error
//   in log-gamma, so they keep relative precision when a and b are large;
// - incomplete gamma: its power series below a + 1, and Legendre's continued
//   fraction above it, evaluated by the modified Lentz method (Lentz 1976;
//   Thompson & Barnett 1986);
// - incomplete beta: its continued fraction (Abramowitz & Stegun 26.5.8),
//   also by Lentz, with the symmetry I_x(a, b) = 1 − I_{1−x}(b, a);
// - normal tail areas: erfc(z) = Q(1/2, z²), so tails keep full relative
//   precision far from the mean;
// - quantiles: a starting value (Abramowitz & Stegun 26.2.23 for the normal,
//   Wilson–Hilferty for chi-square and gamma), then safeguarded Newton or
//   Halley steps on the distribution function.
// Accuracy is checked against R in tests/dist.test.js.

const EPS = 1e-16;
const TINY = 1e-300;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];
const LOG_SQRT_2PI = 0.9189385332046727;

/** ln Γ(x) for x > 0 (and for negative non-integers by reflection). */
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  // Small integers are exact through factorials.
  if (x === Math.floor(x) && x <= 30) {
    let f = 1;
    for (let k = 2; k < x; k++) f *= k;
    return Math.log(f);
  }
  x -= 1;
  let sum = LANCZOS[0];
  const t = x + 7.5;
  for (let k = 1; k < 9; k++) sum += LANCZOS[k] / (x + k);
  return LOG_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** ln B(a, b). With one large argument, lgamma(a) − lgamma(a + b) is taken in Stirling form. */
export function lbeta(a, b) {
  if (a < b) [a, b] = [b, a];
  if (a < 10) return lgamma(a) + lgamma(b) - lgamma(a + b);
  return lgamma(b) - (a - 0.5) * Math.log1p(b / a) - b * Math.log(a + b) + b + stirlerr(a) - stirlerr(a + b);
}

/** lgamma(a) minus Stirling's approximation (a − ½) ln a − a + ln √(2π). */
function stirlerr(a) {
  if (a <= 15) return lgamma(a) - ((a - 0.5) * Math.log(a) - a + LOG_SQRT_2PI);
  const a2 = a * a;
  return (1 / 12 - (1 / 360 - (1 / 1260 - (1 / 1680 - 1 / (1188 * a2)) / a2) / a2) / a2) / a;
}
/** x ln(x/m) + m − x, without cancellation when x is near m (Loader 2000). */
function bd0(x, m) {
  if (Math.abs(x - m) < 0.1 * (x + m)) {
    let v = (x - m) / (x + m),
      s = (x - m) * v,
      ej = 2 * x * v;
    const v2 = v * v;
    for (let j = 1; j < 1000; j++) {
      ej *= v2;
      const next = s + ej / (2 * j + 1);
      if (next === s) return next;
      s = next;
    }
    return s;
  }
  return x * Math.log(x / m) + m - x;
}

// ln(x^a e^{−x} / Γ(a)), shared by both incomplete-gamma branches.
const gammaPrefix = (a, x) =>
  a < 10
    ? a * Math.log(x) - x - lgamma(a)
    : -bd0(a, x) + 0.5 * Math.log(a) - LOG_SQRT_2PI - stirlerr(a);

// ln(x^a (1 − x)^b / B(a, b)).
function betaPrefix(a, b, x) {
  if (Math.min(a, b) < 10) return a * Math.log(x) + b * Math.log1p(-x) - lbeta(a, b);
  const n = a + b;
  return (
    -bd0(a, n * x) - bd0(b, n * (1 - x)) + 0.5 * Math.log((a * b) / n) - LOG_SQRT_2PI -
    stirlerr(a) - stirlerr(b) + stirlerr(n)
  );
}

function gammaSeries(a, x) {
  let term = 1 / a,
    sum = term;
  for (let n = 1; n < 10000; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(gammaPrefix(a, x));
}

function gammaFraction(a, x) {
  let b = x + 1 - a,
    c = 1 / TINY,
    d = 1 / b,
    h = d;
  for (let n = 1; n < 10000; n++) {
    const an = -n * (n - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.exp(gammaPrefix(a, x)) * h;
}

/** The regularized lower incomplete gamma function P(a, x). */
export function gammaP(a, x) {
  if (!(a > 0) || Number.isNaN(x)) return NaN;
  if (x <= 0) return 0;
  if (x === Infinity) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaFraction(a, x);
}

/** The regularized upper incomplete gamma function Q(a, x) = 1 − P(a, x). */
export function gammaQ(a, x) {
  if (!(a > 0) || Number.isNaN(x)) return NaN;
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaFraction(a, x);
}

function betaFraction(a, b, x) {
  const qab = a + b,
    qap = a + 1,
    qam = a - 1;
  let c = 1,
    d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/**
 * The regularized incomplete beta function I_x(a, b), or its complement
 * 1 − I_x(a, b) when `upper` is true, each without cancellation.
 */
export function betaI(x, a, b, upper = false) {
  if (!(a > 0 && b > 0) || Number.isNaN(x)) return NaN;
  if (x <= 0) return upper ? 1 : 0;
  if (x >= 1) return upper ? 0 : 1;
  const front = Math.exp(betaPrefix(a, b, x));
  // The fraction converges fast below the mean; above it, use the symmetry.
  if (x < (a + 1) / (a + b + 2)) {
    const lower = (front * betaFraction(a, b, x)) / a;
    return upper ? 1 - lower : lower;
  }
  const tail = (front * betaFraction(b, a, 1 - x)) / b;
  return upper ? tail : 1 - tail;
}

// ---- distributions: (value, parameters, lower tail?) → probability ------------

/** The standard normal distribution function (or upper tail). */
export function pnorm(x, lower = true) {
  if (Number.isNaN(x)) return NaN;
  // Φ(x) = ½ erfc(−x/√2) and erfc(z) = Q(½, z²) for z ≥ 0.
  const z = x / Math.SQRT2;
  const below = z < 0 ? 0.5 * gammaQ(0.5, z * z) : 1 - 0.5 * gammaQ(0.5, z * z);
  if (lower) return below;
  return z > 0 ? 0.5 * gammaQ(0.5, z * z) : 1 - 0.5 * gammaQ(0.5, z * z);
}

/** The standard normal density. */
export const dnorm = (x) => Math.exp(-0.5 * x * x - LOG_SQRT_2PI);

/** The standard normal quantile. */
export function qnorm(p, lower = true) {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (!lower) p = 1 - p;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  // Work in the lower half, where p keeps its precision.
  const flip = p > 0.5,
    q = flip ? 1 - p : p;
  const t = Math.sqrt(-2 * Math.log(q));
  let x = -(t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
  for (let i = 0; i < 50; i++) {
    const f = pnorm(x) - q,
      d = dnorm(x);
    if (d === 0) break;
    const step = f / d / (1 + (x * f) / (2 * d));
    x -= step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(x))) break;
  }
  return flip ? -x : x;
}

/** Student's t distribution function with df degrees of freedom. */
export function pt(t, df, lower = true) {
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (t === Infinity) return lower ? 1 : 0;
  if (t === -Infinity) return lower ? 0 : 1;
  // P(|T| > |t|) = I_{df/(df+t²)}(df/2, ½), computed in the tail directly.
  const x = df / (df + t * t);
  const tail = 0.5 * (x < 0.5 ? betaI(x, df / 2, 0.5) : betaI(1 - x, 0.5, df / 2, true));
  return t > 0 === lower ? 1 - tail : tail;
}

/** The F distribution function with (d1, d2) degrees of freedom. */
export function pf(f, d1, d2, lower = true) {
  if (Number.isNaN(f) || !(d1 > 0 && d2 > 0)) return NaN;
  if (f <= 0) return lower ? 0 : 1;
  if (f === Infinity) return lower ? 1 : 0;
  const x = (d1 * f) / (d1 * f + d2);
  return x < 0.5 ? betaI(x, d1 / 2, d2 / 2, !lower) : betaI(d2 / (d1 * f + d2), d2 / 2, d1 / 2, lower);
}

/** The chi-square distribution function with k degrees of freedom. */
export const pchisq = (x, k, lower = true) => (lower ? gammaP(k / 2, x / 2) : gammaQ(k / 2, x / 2));

/** The gamma distribution function with the given shape and rate. */
export const pgamma = (x, shape, rate = 1, lower = true) =>
  lower ? gammaP(shape, x * rate) : gammaQ(shape, x * rate);

/** P(X ≤ k) for a Poisson count with mean λ (or P(X > k)). */
export function ppois(k, lambda, lower = true) {
  if (!(lambda >= 0) || Number.isNaN(k)) return NaN;
  k = Math.floor(k);
  if (k < 0) return lower ? 0 : 1;
  if (lambda === 0) return lower ? 1 : 0;
  return lower ? gammaQ(k + 1, lambda) : gammaP(k + 1, lambda);
}

/** The density of the gamma distribution (shape, rate 1) on the log scale. */
const lgammaDensity = (x, a) => (a - 1) * Math.log(x) - x - lgamma(a);

/** The gamma quantile (shape, rate). */
export function qgamma(p, shape, rate = 1, lower = true) {
  if (Number.isNaN(p) || p < 0 || p > 1 || !(shape > 0) || !(rate > 0)) return NaN;
  if (!lower) p = 1 - p;
  if (p === 0) return 0;
  if (p === 1) return Infinity;
  // Wilson–Hilferty starting value, then Newton steps kept inside a bracket.
  const z = qnorm(p),
    nu = 2 * shape;
  const c = 2 / (9 * nu);
  let x = Math.max((nu * (1 - c + z * Math.sqrt(c)) ** 3) / 2, 1e-300);
  if (shape < 1 && p < 0.5) {
    // P(a, x) ≈ x^a / Γ(a + 1) near zero; a quantile this small underflows to 0.
    x = Math.exp((Math.log(p) + lgamma(shape + 1)) / shape);
    if (x === 0) return 0;
  }
  let lo = 0,
    hi = Infinity;
  // Solve in whichever tail p is small, so tiny upper-tail areas keep precision.
  const upperSide = p > 0.5,
    target = upperSide ? 1 - p : p;
  for (let i = 0; i < 200; i++) {
    const f = upperSide ? target - gammaQ(shape, x) : gammaP(shape, x) - target;
    if (f === 0) break;
    if (f > 0) hi = x;
    else lo = x;
    const d = Math.exp(lgammaDensity(x, shape));
    let next = d > 0 ? x - f / d : NaN;
    if (Math.abs(next - x) <= 1e-15 * x) {
      x = next;
      break;
    }
    if (!(next > lo && next < hi)) next = hi === Infinity ? Math.max(2 * x, lo + 1) : (lo + hi) / 2;
    x = next;
  }
  return x / rate;
}

/** The chi-square quantile with k degrees of freedom. */
export const qchisq = (p, k, lower = true) => 2 * qgamma(p, k / 2, 1, lower);

/** Student's t quantile with df degrees of freedom. */
export function qt(p, df, lower = true) {
  if (Number.isNaN(p) || p < 0 || p > 1 || !(df > 0)) return NaN;
  if (!lower) p = 1 - p;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  const flip = p > 0.5,
    q = flip ? 1 - p : p;
  // Start from the normal quantile with Cornish–Fisher terms, then Newton.
  const z = qnorm(q);
  let x = z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
  const logc = lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  let lo = -Infinity,
    hi = 0;
  for (let i = 0; i < 200; i++) {
    const f = pt(x, df) - q;
    if (f === 0) break;
    if (f > 0) hi = x;
    else lo = x;
    const d = Math.exp(logc - ((df + 1) / 2) * Math.log1p((x * x) / df));
    let next = d > 0 ? x - f / d : NaN;
    if (Math.abs(next - x) <= 1e-15 * Math.max(1, Math.abs(x))) {
      x = next;
      break;
    }
    if (!(next > lo && next < hi)) next = lo === -Infinity ? Math.min(2 * x, hi - 1) : (lo + hi) / 2;
    x = next;
  }
  return flip ? -x : x;
}

/**
 * Exact (Garwood) confidence limits for a Poisson count: the mean λ with
 * P(X ≥ count) = α/2 and P(X ≤ count) = α/2. Divide by the base for a rate.
 */
export function poissonCI(count, level = 0.95) {
  const alpha = 1 - level;
  return [count > 0 ? qgamma(alpha / 2, count) : 0, qgamma(1 - alpha / 2, count + 1)];
}

/**
 * ψ(x), the digamma function: shifted up past 10 by ψ(x) = ψ(x + 1) − 1/x,
 * then the asymptotic series (Abramowitz & Stegun 6.3.18).
 */
export function digamma(x) {
  let shift = 0;
  while (x < 10) {
    shift -= 1 / x;
    x += 1;
  }
  const f = 1 / (x * x);
  return (
    shift +
    Math.log(x) -
    0.5 / x -
    f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f * (1 / 132 - (f * 691) / 32760)))))
  );
}

/** ψ′(x), the trigamma function, the same way (Abramowitz & Stegun 6.4.12). */
export function trigamma(x) {
  let shift = 0;
  while (x < 10) {
    shift += 1 / (x * x);
    x += 1;
  }
  const f = 1 / (x * x);
  return (
    shift +
    1 / x +
    f / 2 +
    (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f * (1 / 30 - (f * 5) / 66))))
  );
}
