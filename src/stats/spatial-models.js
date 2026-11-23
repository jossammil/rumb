// Maximum-likelihood spatial regression (Ord 1975; Anselin 1988):
// - spatial lag:   y = ρWy + Xβ + ε
// - spatial error: y = Xβ + u, u = λWu + ε
// The log-likelihood is concentrated on ρ (or λ) and maximized by Brent's
// method on (1/ω_min, 1/ω_max). log|I − ρW| = Σ log(1 − ρω_i) uses the
// eigenvalues ω of W, taken from the symmetric matrix D^-½ S D^-½ that is
// similar to the row-standardized W = D⁻¹S; so S, the raw weights, must be
// symmetric. Standard errors invert the full information matrix, as
// spatialreg's eigen method does; the traces of W(I − ρW)⁻¹ come from
// Neumann series over the sparse weights. The lag model also reports direct,
// indirect and total impacts (LeSage & Pace 2009). Pure.
import { pchisq, pnorm } from "./dist.js";
import { inverse, leastSquares, qr, symmetricEigenvalues } from "./linalg.js";
import { lag } from "./regression.js";

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Whether raw weights are symmetric: j ∈ N(i) with w_ij exactly when i ∈ N(j) with w_ji = w_ij. */
export function symmetricWeights(rows, w) {
  const at = rows.map((row, i) => new Map(row.map((j, k) => [j, w ? w[i][k] : 1])));
  return rows.every((row, i) => row.every((j, k) => Math.abs((at[j].get(i) ?? NaN) - (w ? w[i][k] : 1)) <= 1e-12 * (w ? w[i][k] : 1)));
}

/** The eigenvalues of the row-standardized W for symmetric raw weights, ascending. */
export function weightEigenvalues(rows, w) {
  const n = rows.length;
  if (n > 2500) throw new Error("Spatial models use the eigenvalues of the weights; that is limited to 2,500 areas.");
  if (!symmetricWeights(rows, w))
    throw new Error("Spatial models need symmetric weights: contiguity, a distance band, inverse distance or symmetric nearest neighbors.");
  const total = rows.map((row, i) => (w ? w[i].reduce((s, x) => s + x, 0) : row.length));
  const dh = total.map((t) => 1 / Math.sqrt(t));
  const M = rows.map((row, i) => {
    const out = new Float64Array(n);
    row.forEach((j, k) => (out[j] = (w ? w[i][k] : 1) * dh[i] * dh[j]));
    return out;
  });
  return symmetricEigenvalues(M);
}

/** Brent's minimization of f on [a, b] (golden sections with parabolic steps). */
export function brent(f, a, b, tol = 1e-12) {
  const golden = 0.3819660112501051;
  let x = a + golden * (b - a),
    w = x,
    v = x,
    fx = f(x),
    fw = fx,
    fv = fx,
    d = 0,
    e = 0;
  for (let iter = 0; iter < 500; iter++) {
    const m = (a + b) / 2,
      tol1 = tol * Math.abs(x) + 1e-15,
      tol2 = 2 * tol1;
    if (Math.abs(x - m) <= tol2 - (b - a) / 2) break;
    let golden_step = true;
    if (Math.abs(e) > tol1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw),
        p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      else q = -q;
      if (Math.abs(p) < Math.abs(0.5 * q * e) && p > q * (a - x) && p < q * (b - x)) {
        e = d;
        d = p / q;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = x < m ? tol1 : -tol1;
        golden_step = false;
      }
    }
    if (golden_step) {
      e = x < m ? b - x : a - x;
      d = golden * e;
    }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1);
    const fu = f(u);
    if (fu <= fx) {
      if (u < x) b = x;
      else a = x;
      [v, fv, w, fw, x, fx] = [w, fw, x, fx, u, fu];
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) [v, fv, w, fw] = [w, fw, u, fu];
      else if (fu <= fv || v === x || v === w) [v, fv] = [u, fu];
    }
  }
  return x;
}

/** Row-standardized weights as compressed rows: { start, col, val }. */
function compressed(W) {
  const n = W.rows.length,
    start = new Int32Array(n + 1);
  W.rows.forEach((row, i) => (start[i + 1] = start[i] + row.length));
  const col = new Int32Array(start[n]),
    val = new Float64Array(start[n]);
  W.rows.forEach((row, i) =>
    row.forEach((j, k) => {
      col[start[i] + k] = j;
      val[start[i] + k] = W.w[i][k];
    }),
  );
  return { n, start, col, val };
}

/** out = W v, for compressed rows. */
function multiply(C, v, out) {
  const { n, start, col, val } = C;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = start[i]; k < start[i + 1]; k++) s += val[k] * v[col[k]];
    out[i] = s;
  }
  return out;
}

/**
 * (I − ρW)⁻¹ v by the Neumann series Σ (ρW)^k v, which converges for |ρ| < 1
 * because row-standardized W has norm 1. Stops when a term is below 1e-16
 * of the sum.
 */
function solveIRW(C, rho, v) {
  const n = C.n;
  let term = Float64Array.from(v),
    next = new Float64Array(n);
  const out = Float64Array.from(v);
  let scale = 0;
  for (const x of out) scale = Math.max(scale, Math.abs(x));
  for (let k = 0; k < 5000; k++) {
    multiply(C, term, next);
    let size = 0;
    for (let i = 0; i < n; i++) {
      const t = rho * next[i];
      next[i] = t;
      out[i] += t;
      if (Math.abs(t) > size) size = Math.abs(t);
    }
    [term, next] = [next, term];
    if (size <= 1e-16 * Math.max(scale, 1e-300)) break;
  }
  return out;
}

/**
 * Traces for the information matrix, with A = W(I − ρW)⁻¹: tr(A) and tr(AA)
 * from the eigenvalues; tr(AᵀA), the squared Frobenius norm, column by column.
 */
function informationTraces(C, rho, omega) {
  const n = omega.length;
  let trA = 0,
    trAA = 0;
  for (const w of omega) {
    const a = w / (1 - rho * w);
    trA += a;
    trAA += a * a;
  }
  let trAtA = 0;
  const unit = new Float64Array(n),
    col = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    unit[j] = 1;
    multiply(C, solveIRW(C, rho, unit), col);
    unit[j] = 0;
    for (let i = 0; i < n; i++) trAtA += col[i] * col[i];
  }
  return { trA, trAA, trAtA };
}

const logDet = (rho, omega) => omega.reduce((s, w) => s + Math.log(1 - rho * w), 0);

/**
 * Fits a spatial lag or error model. X has a leading column of ones; W is
 * row-standardized ({ rows, w } from regression.standardize); omega are the
 * eigenvalues of W; olsLogLik is the OLS log-likelihood for the LR test.
 */
export function spatialModel(type, X, y, W, omega, { names = [], olsLogLik } = {}) {
  const n = y.length,
    k = X[0].length;
  const lower = 1 / omega[0] + 1e-9,
    upper = 1 / omega.at(-1) - 1e-9;
  const cols = X[0].map((_, j) => X.map((r) => r[j]));
  const Wy = lag(W, y);
  const fit =
    type === "lag"
      ? (() => {
          // e(ρ) = e0 − ρ eL from two OLS fits on y and Wy.
          const f = qr(X);
          const e0 = leastSquares(X, y, f),
            eL = leastSquares(X, Wy, f);
          const sse = (rho) => {
            let s = 0;
            for (let i = 0; i < n; i++) s += (e0.residuals[i] - rho * eL.residuals[i]) ** 2;
            return s;
          };
          const negLogLik = (rho) => (n / 2) * Math.log(sse(rho) / n) - logDet(rho, omega);
          const rho = brent(negLogLik, lower, upper);
          return { parameter: rho, beta: e0.coef.map((b, j) => b - rho * eL.coef[j]), s2: sse(rho) / n, logDet: logDet(rho, omega) };
        })()
      : (() => {
          const WX = cols.map((c) => lag(W, c));
          const filtered = (lambda) => {
            const ys = y.map((v, i) => v - lambda * Wy[i]);
            const Xs = X.map((r, i) => r.map((x, j) => x - lambda * WX[j][i]));
            return { Xs, fit: leastSquares(Xs, ys) };
          };
          const negLogLik = (lambda) => {
            const { fit } = filtered(lambda);
            return (n / 2) * Math.log(dot(fit.residuals, fit.residuals) / n) - logDet(lambda, omega);
          };
          const lambda = brent(negLogLik, lower, upper);
          const { Xs, fit } = filtered(lambda);
          return { parameter: lambda, beta: fit.coef, s2: dot(fit.residuals, fit.residuals) / n, logDet: logDet(lambda, omega), Xs };
        })();
  const { parameter: p, beta, s2 } = fit;
  const logLik = -(n / 2) * (Math.log(2 * Math.PI) + Math.log(s2) + 1) + fit.logDet;
  const C = compressed(W);
  const { trA, trAA, trAtA } = informationTraces(C, p, omega);
  // The information matrix over (σ², ρ or λ, β), as spatialreg orders it.
  const info = Array.from({ length: k + 2 }, () => new Array(k + 2).fill(0));
  info[0][0] = n / (2 * s2 * s2);
  info[0][1] = info[1][0] = trA / s2;
  if (type === "lag") {
    const Xb = X.map((r) => dot(r, beta));
    const AXb = Array.from(multiply(C, solveIRW(C, p, Xb), new Float64Array(n)));
    info[1][1] = trAA + trAtA + dot(AXb, AXb) / s2;
    cols.forEach((c, j) => (info[1][j + 2] = info[j + 2][1] = dot(c, AXb) / s2));
    cols.forEach((ci, i) => cols.forEach((cj, j) => (info[i + 2][j + 2] = dot(ci, cj) / s2)));
  } else {
    info[1][1] = trAA + trAtA;
    const xs = fit.Xs[0].map((_, j) => fit.Xs.map((r) => r[j]));
    xs.forEach((ci, i) => xs.forEach((cj, j) => (info[i + 2][j + 2] = dot(ci, cj) / s2)));
  }
  const cov = inverse(info);
  const se = cov.map((row, i) => Math.sqrt(row[i]));
  const pSE = se[1],
    z = p / pSE;
  // Fitted values: the lag model's ρWy + Xβ; the error model's Xβ + λW(y − Xβ).
  const Xb = X.map((r) => dot(r, beta));
  const fitted =
    type === "lag"
      ? Xb.map((v, i) => v + p * Wy[i])
      : (() => {
          const u = y.map((v, i) => v - Xb[i]),
            Wu = lag(W, u);
          return Xb.map((v, i) => v + p * Wu[i]);
        })();
  const residuals = y.map((v, i) => v - fitted[i]);
  const sigma = Math.sqrt(s2);
  const lr = olsLogLik != null ? 2 * (logLik - olsLogLik) : null;
  const result = {
    type,
    n,
    k,
    parameter: { name: type === "lag" ? "ρ (rho)" : "λ (lambda)", estimate: p, se: pSE, z, p: 2 * pnorm(-Math.abs(z)) },
    coefficients: beta.map((b, j) => {
      const zj = b / se[j + 2];
      return { name: names[j] ?? (j ? "x" + j : "(Intercept)"), estimate: b, se: se[j + 2], statistic: zj, p: 2 * pnorm(-Math.abs(zj)) };
    }),
    sigma,
    logLik,
    aic: -2 * logLik + 2 * (k + 2),
    sc: -2 * logLik + (k + 2) * Math.log(n),
    lr: lr != null ? { statistic: lr, df: 1, p: pchisq(lr, 1, false) } : null,
    wald: { statistic: z * z, df: 1, p: pchisq(z * z, 1, false) },
    bounds: [lower, upper],
    fitted,
    residuals,
    standardized: residuals.map((e) => e / sigma),
    residualMoran: dot(residuals, lag(W, residuals)) / dot(residuals, residuals),
  };
  if (type === "lag") {
    // Average impacts: direct = β tr((I − ρW)⁻¹)/n, total = β / (1 − ρ).
    const meanInv = omega.reduce((s, w) => s + 1 / (1 - p * w), 0) / n;
    result.impacts = beta.slice(1).map((b, j) => ({
      name: names[j + 1] ?? "x" + (j + 1),
      direct: b * meanInv,
      indirect: b / (1 - p) - b * meanInv,
      total: b / (1 - p),
    }));
  }
  return result;
}
