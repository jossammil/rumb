// Count regression with a log link and an offset (log population), so the
// coefficients describe rates (McCullagh & Nelder 1989):
// - Poisson, fitted by iteratively reweighted least squares (IRLS);
// - negative binomial (NB2, variance μ + μ²/θ), alternating IRLS for β with
//   Newton steps for θ by maximum likelihood, the scheme of Venables &
//   Ripley's glm.nb (MASS).
// Reports z tests, incidence rate ratios with Wald limits, deviance, AIC
// and overdispersion, and Pearson residuals. Pure.
import { digamma, lgamma, pchisq, pnorm, qnorm, trigamma } from "./dist.js";
import { crossprodInverse, leastSquares, qr } from "./linalg.js";

const sum = (v) => v.reduce((s, x) => s + x, 0);
const xlogy = (x, y) => (x === 0 ? 0 : x * Math.log(y));

/** IRLS for a log-link GLM with variance function V(μ). Returns { beta, mu, eta, R }. */
function irls(X, y, offset, variance, start) {
  const n = y.length;
  let mu = start || y.map((v) => v + 0.1),
    eta = mu.map((m) => Math.log(m)),
    beta = null,
    R = null,
    dev = Infinity;
  for (let iter = 0; iter < 100; iter++) {
    // Working response and weights for the log link: dμ/dη = μ.
    const w = mu.map((m) => (m * m) / variance(m));
    const z = eta.map((e, i) => e - offset[i] + (y[i] - mu[i]) / mu[i]);
    const sw = w.map(Math.sqrt);
    const f = qr(X.map((row, i) => row.map((x) => x * sw[i])));
    beta = leastSquares(X.map((row, i) => row.map((x) => x * sw[i])), z.map((v, i) => v * sw[i]), f).coef;
    R = f.R;
    eta = X.map((row, i) => row.reduce((s, x, j) => s + x * beta[j], 0) + offset[i]);
    mu = eta.map(Math.exp);
    const next = deviance(y, mu, variance);
    if (Math.abs(next - dev) / (Math.abs(next) + 0.1) < 1e-12) {
      dev = next;
      break;
    }
    dev = next;
  }
  return { beta, mu, eta, R };
}

// Unit deviances: Poisson, or negative binomial with its θ on the variance function.
function deviance(y, mu, variance) {
  const theta = variance.theta;
  return 2 * sum(
    y.map((v, i) =>
      theta == null
        ? xlogy(v, v / mu[i]) - (v - mu[i])
        : xlogy(v, v / mu[i]) - (v + theta) * Math.log((v + theta) / (mu[i] + theta)),
    ),
  );
}

const poissonVariance = (m) => m;
const nbVariance = (theta) => Object.assign((m) => m + (m * m) / theta, { theta });

const poissonLogLik = (y, mu) => sum(y.map((v, i) => xlogy(v, mu[i]) - mu[i] - lgamma(v + 1)));
const nbLogLik = (y, mu, theta) =>
  sum(
    y.map(
      (v, i) =>
        lgamma(theta + v) - lgamma(theta) - lgamma(v + 1) + theta * Math.log(theta) + xlogy(v, mu[i]) - (theta + v) * Math.log(theta + mu[i]),
    ),
  );

/** θ by maximum likelihood for fixed μ (Newton on the score; MASS's theta.ml). */
export function thetaML(y, mu, start) {
  const n = y.length;
  let theta = start ?? n / sum(y.map((v, i) => (v / mu[i] - 1) ** 2));
  let info = 0;
  for (let iter = 0; iter < 100; iter++) {
    let score = 0;
    info = 0;
    for (let i = 0; i < n; i++) {
      score += digamma(theta + y[i]) - digamma(theta) + Math.log(theta) + 1 - Math.log(theta + mu[i]) - (y[i] + theta) / (mu[i] + theta);
      info += -trigamma(theta + y[i]) + trigamma(theta) - 1 / theta + 2 / (mu[i] + theta) - (y[i] + theta) / (mu[i] + theta) ** 2;
    }
    const step = score / info;
    theta = Math.max(theta + step, theta / 10);
    if (Math.abs(step) < 1e-12 * Math.max(1, theta)) break;
  }
  return { theta, se: Math.sqrt(1 / info) };
}

/**
 * A Poisson ("poisson") or negative binomial ("nb") regression of counts y
 * on X (with a leading 1) and log offsets.
 */
export function countModel(type, X, y, offset, { names = [] } = {}) {
  const n = y.length,
    k = X[0].length;
  if (n <= k + 1) throw new Error("The model needs more areas than coefficients.");
  if (y.some((v) => !(v >= 0) || !Number.isInteger(v))) throw new Error("Count models need whole-number counts of zero or more.");
  let fit = irls(X, y, offset, poissonVariance),
    theta = null,
    thetaSE = null,
    variance = poissonVariance;
  if (type === "nb") {
    let t = thetaML(y, fit.mu);
    for (let iter = 0; iter < 50; iter++) {
      variance = nbVariance(t.theta);
      fit = irls(X, y, offset, variance, fit.mu);
      const next = thetaML(y, fit.mu, t.theta);
      const done = Math.abs(next.theta - t.theta) < 1e-10 * t.theta;
      t = next;
      if (done) break;
    }
    theta = t.theta;
    thetaSE = t.se;
    variance = nbVariance(theta);
    fit = irls(X, y, offset, variance, fit.mu);
  }
  const { beta, mu, R } = fit;
  const cov = crossprodInverse(R);
  const z975 = qnorm(0.975);
  const coefficients = beta.map((b, j) => {
    const se = Math.sqrt(cov[j][j]),
      zj = b / se;
    return {
      name: names[j] ?? (j ? "x" + j : "(Intercept)"),
      estimate: b,
      se,
      statistic: zj,
      p: 2 * pnorm(-Math.abs(zj)),
      ratio: Math.exp(b),
      lower: Math.exp(b - z975 * se),
      upper: Math.exp(b + z975 * se),
    };
  });
  const logLik = type === "nb" ? nbLogLik(y, mu, theta) : poissonLogLik(y, mu);
  const params = k + (type === "nb" ? 1 : 0);
  // The null model: an intercept and the offset only.
  const ones = y.map(() => [1]);
  const nullMu = irls(ones, y, offset, variance).mu;
  const pearson = y.map((v, i) => (v - mu[i]) / Math.sqrt(variance(mu[i])));
  const chi2 = sum(pearson.map((r) => r * r));
  const dev = deviance(y, mu, variance);
  return {
    type,
    n,
    k,
    coefficients,
    theta: theta == null ? null : { estimate: theta, se: thetaSE },
    logLik,
    aic: -2 * logLik + 2 * params,
    sc: -2 * logLik + params * Math.log(n),
    deviance: { residual: dev, null: deviance(y, nullMu, variance), df: n - k, p: pchisq(dev, n - k, false) },
    dispersion: chi2 / (n - k),
    fitted: mu,
    residuals: pearson,
    standardized: pearson,
  };
}
