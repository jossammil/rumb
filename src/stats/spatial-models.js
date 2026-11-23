// Maximum-likelihood spatial regression (Ord 1975; Anselin 1988):
// - spatial lag:   y = ρWy + Xβ + ε
// - spatial error: y = Xβ + u, u = λWu + ε
// The log-likelihood is concentrated on ρ (or λ) and maximized by Brent's
// method. Up to 2,500 areas, log|I − ρW| = Σ log(1 − ρω_i) uses the
// eigenvalues ω of W, taken from the symmetric matrix D^-½ S D^-½ that is
// similar to the row-standardized W = D⁻¹S; so S, the raw weights, must be
// symmetric. Standard errors then invert the full information matrix, as
// spatialreg's eigen method does; the traces of W(I − ρW)⁻¹ come from
// Neumann series over the sparse weights. The lag model also reports direct,
// indirect and total impacts (LeSage & Pace 2009).
//
// Above 2,500 areas (and up to 20,000) the eigenvalues are out of reach:
// - log|I − ρW| is the Chebyshev approximation of Pace & LeSage (2004),
//   Σ_j c_j(ρ) tr T_j(W) − (n/2) c_0(ρ) over ρ in (−1, 0.999), with exact
//   traces of the powers of the same symmetric matrix (similar to W, so the
//   traces agree), taken row by row: tr S^2m = ‖S^m‖²_F and
//   tr S^(2m+1) = ⟨S^m, S^(m+1)⟩;
// - standard errors invert a numerical Hessian of the log-likelihood
//   concentrated on σ², over (ρ or λ, β), as spatialreg does for its
//   approximate methods;
// - the impacts' tr((I − ρW)⁻¹) is the power series Σ ρ^j tr W^j, with the
//   exact traces to order 8 and seeded Monte Carlo estimates beyond (Barry &
//   Pace 1999; LeSage & Pace 2009). Pure.
import { pchisq, pnorm } from "./dist.js";
import { inverse, leastSquares, qr, symmetricEigenvalues } from "./linalg.js";
import { randomGenerator } from "./random.js";
import { lag } from "./regression.js";

/** The most areas whose weights' eigenvalues are computed; larger layers use the Chebyshev approximation. */
export const EIGEN_LIMIT = 2500;
/** The most areas a spatial model fits. */
export const MODEL_LIMIT = 20000;
/** The order of the Chebyshev approximation of log|I − ρW| (spatialreg's cheb_q). */
export const CHEBYSHEV_ORDER = 7;
// Traces of the powers of W known exactly: tr W^0 … tr W^8.
const EXACT_ORDER = 8;
const SYMMETRIC_MESSAGE =
  "Spatial models need symmetric weights: contiguity, a distance band, inverse distance or symmetric nearest neighbors.";

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Whether raw weights are symmetric: j ∈ N(i) with w_ij exactly when i ∈ N(j) with w_ji = w_ij. */
export function symmetricWeights(rows, w) {
  const at = rows.map((row, i) => new Map(row.map((j, k) => [j, w ? w[i][k] : 1])));
  return rows.every((row, i) => row.every((j, k) => Math.abs((at[j].get(i) ?? NaN) - (w ? w[i][k] : 1)) <= 1e-12 * (w ? w[i][k] : 1)));
}

/** The eigenvalues of the row-standardized W for symmetric raw weights, ascending. */
export function weightEigenvalues(rows, w) {
  const n = rows.length;
  if (n > EIGEN_LIMIT) throw new Error("Spatial models use the eigenvalues of the weights; that is limited to 2,500 areas.");
  if (!symmetricWeights(rows, w)) throw new Error(SYMMETRIC_MESSAGE);
  const total = rows.map((row, i) => (w ? w[i].reduce((s, x) => s + x, 0) : row.length));
  const dh = total.map((t) => 1 / Math.sqrt(t));
  const M = rows.map((row, i) => {
    const out = new Float64Array(n);
    row.forEach((j, k) => (out[j] = (w ? w[i][k] : 1) * dh[i] * dh[j]));
    return out;
  });
  return symmetricEigenvalues(M);
}

/** The symmetric D^-½ S D^-½ similar to the row-standardized W, as compressed rows. */
function similarMatrix(rows, w) {
  const n = rows.length,
    start = new Int32Array(n + 1);
  rows.forEach((row, i) => (start[i + 1] = start[i] + row.length));
  const dh = rows.map((row, i) => 1 / Math.sqrt(w ? w[i].reduce((s, x) => s + x, 0) : row.length));
  const col = new Int32Array(start[n]),
    val = new Float64Array(start[n]);
  rows.forEach((row, i) =>
    row.forEach((j, k) => {
      col[start[i] + k] = j;
      val[start[i] + k] = (w ? w[i][k] : 1) * dh[i] * dh[j];
    }),
  );
  return { n, start, col, val };
}

/**
 * Exact traces tr S^0 … tr S^8 of a symmetric sparse S (compressed rows),
 * from rows i of S, S², S³ and S⁴ built one at a time: Σ_i ⟨(S^p)_i, (S^q)_i⟩
 * = tr S^p S^q = tr S^(p+q). Nothing larger than a row is ever held.
 */
export function powerTraces(S) {
  const { n, start, col, val } = S;
  const acc = [1, 2, 3].map(() => new Float64Array(n)),
    seen = [1, 2, 3].map(() => new Uint8Array(n)),
    list = [1, 2, 3].map(() => new Int32Array(n)),
    size = [0, 0, 0];
  const t = new Float64Array(EXACT_ORDER + 1);
  // Row i of S^(p+2) into level p from the sparse row at level p − 1 (or row i of S).
  const grow = (p, from, fromList, fromSize) => {
    const out = acc[p],
      mark = seen[p],
      ids = list[p];
    let m = 0;
    for (let a = 0; a < fromSize; a++) {
      const k = fromList[a],
        v = from(a, k);
      for (let b = start[k]; b < start[k + 1]; b++) {
        const j = col[b];
        if (!mark[j]) {
          mark[j] = 1;
          ids[m++] = j;
        }
        out[j] += v * val[b];
      }
    }
    size[p] = m;
  };
  for (let i = 0; i < n; i++) {
    const r0 = start[i],
      r1 = start[i + 1],
      rowList = col.subarray(r0, r1);
    t[0] += 1;
    for (let b = r0; b < r1; b++) {
      if (col[b] === i) t[1] += val[b];
      t[2] += val[b] * val[b];
    }
    grow(0, (a) => val[r0 + a], rowList, r1 - r0);
    for (let b = r0; b < r1; b++) t[3] += val[b] * acc[0][col[b]];
    grow(1, (a, k) => acc[0][k], list[0], size[0]);
    grow(2, (a, k) => acc[1][k], list[1], size[1]);
    for (let a = 0; a < size[0]; a++) {
      const j = list[0][a];
      t[4] += acc[0][j] * acc[0][j];
      t[5] += acc[0][j] * acc[1][j];
    }
    for (let a = 0; a < size[1]; a++) {
      const j = list[1][a];
      t[6] += acc[1][j] * acc[1][j];
      t[7] += acc[1][j] * acc[2][j];
    }
    for (let a = 0; a < size[2]; a++) t[8] += acc[2][list[2][a]] ** 2;
    for (let p = 0; p < 3; p++)
      for (let a = 0; a < size[p]; a++) {
        const j = list[p][a];
        acc[p][j] = 0;
        seen[p][j] = 0;
      }
  }
  return t;
}

/** The traces tr T_j(W), j = 0 … q, of the Chebyshev polynomials T_j, from the traces of the powers. */
function chebyshevTraces(power, q) {
  // Coefficients of T_j in powers of x: T_0 = 1, T_1 = x, T_j = 2x T_(j−1) − T_(j−2).
  const T = [[1], [0, 1]];
  for (let j = 2; j <= q; j++) T.push(Array.from({ length: j + 1 }, (_, m) => 2 * (T[j - 1][m - 1] ?? 0) - (T[j - 2][m] ?? 0)));
  return T.slice(0, q + 1).map((c) => c.reduce((s, a, m) => s + a * power[m], 0));
}

/**
 * The weights' spectrum for a spatial model over symmetric raw weights:
 * up to 2,500 areas, the eigenvalues of W (ascending, as weightEigenvalues);
 * above, { method: "chebyshev", n, order, traces (tr T_j(W)), power (tr W^j,
 * j ≤ 8), S } for the Chebyshev approximation. Refuses above 20,000 areas.
 */
export function weightSpectrum(rows, w) {
  const n = rows.length;
  if (n <= EIGEN_LIMIT) return weightEigenvalues(rows, w);
  if (n > MODEL_LIMIT)
    throw new Error(
      "Spatial models are limited to 20,000 areas; this layer has " + n.toLocaleString("en-US") + ". Choose a study area or a coarser layer.",
    );
  if (!symmetricWeights(rows, w)) throw new Error(SYMMETRIC_MESSAGE);
  const S = similarMatrix(rows, w),
    power = powerTraces(S);
  return { method: "chebyshev", n, order: CHEBYSHEV_ORDER, power, traces: chebyshevTraces(power, CHEBYSHEV_ORDER), S };
}

/**
 * log|I − ρW| by the Chebyshev approximation of Pace & LeSage (2004): with
 * nodes x_k = cos(π(k − ½)/(q + 1)), k = 1 … q + 1, and coefficients
 * c_j(ρ) = 2/(q + 1) Σ_k log(1 − ρ x_k) T_j(x_k),
 * log|I − ρW| ≈ Σ_j c_j tr T_j(W) − (n/2) c_0.
 */
export function chebyshevLogDet(rho, { n, order: q, traces }) {
  const q1 = q + 1;
  let total = 0,
    c0 = 0;
  for (let j = 0; j <= q; j++) {
    let c = 0;
    for (let k = 1; k <= q1; k++) c += Math.log(1 - rho * Math.cos((Math.PI * (k - 0.5)) / q1)) * Math.cos((Math.PI * j * (k - 0.5)) / q1);
    c *= 2 / q1;
    if (j === 0) c0 = c;
    total += c * traces[j];
  }
  return total - (n / 2) * c0;
}

/**
 * The mean of the diagonal of (I − ρW)⁻¹, (1/n) Σ_j ρ^j tr W^j: exact traces
 * to order 8, then Hutchinson's estimates from `probes` seeded ±1 vectors z,
 * tr S^2m ≈ ‖S^m z‖² and tr S^(2m+1) ≈ ⟨S^m z, S^(m+1) z⟩, until |ρ|^j falls
 * below 1e-10 (at most order 1,000, with the rest as a geometric tail).
 */
export function meanInverseDiagonal(rho, { n, power, S }, { probes = 50, seed = 12345 } = {}) {
  let order = Math.abs(rho) < 1e-12 ? 0 : Math.ceil(Math.log(1e-10) / Math.log(Math.abs(rho)));
  order = Math.min(1000, Math.max(EXACT_ORDER, order));
  const t = new Float64Array(order + 1);
  t.set(power.subarray(0, EXACT_ORDER + 1));
  if (order > EXACT_ORDER) {
    const random = randomGenerator(seed),
      steps = Math.ceil(order / 2);
    let v = new Float64Array(n),
      next = new Float64Array(n);
    const estimate = new Float64Array(order + 2);
    for (let r = 0; r < probes; r++) {
      for (let i = 0; i < n; i++) v[i] = random() < 0.5 ? -1 : 1;
      for (let m = 1; m <= steps; m++) {
        const { start, col, val } = S;
        let odd = 0,
          even = 0;
        for (let i = 0; i < n; i++) {
          let x = 0;
          for (let b = start[i]; b < start[i + 1]; b++) x += val[b] * v[col[b]];
          next[i] = x;
          odd += v[i] * x;
          even += x * x;
        }
        estimate[2 * m - 1] += odd / probes;
        estimate[2 * m] += even / probes;
        [v, next] = [next, v];
      }
    }
    for (let j = EXACT_ORDER + 1; j <= order; j++) t[j] = estimate[j];
  }
  let sum = 0,
    rj = 1;
  for (let j = 0; j <= order; j++) {
    sum += rj * t[j];
    rj *= rho;
  }
  // The terms past the last order, as if tr W^j stayed at its last value.
  if (Math.abs(rho) < 1) sum += (rj * t[order]) / (1 - rho);
  return sum / n;
}

/**
 * The Hessian of f at theta by central differences, with steps h × scale_i
 * (scale_i a rough standard error, so every step moves f alike).
 */
export function numericalHessian(f, theta, scale, h = 1e-2) {
  const p = theta.length,
    step = scale.map((s) => h * s),
    at = (di, dj) => {
      const x = theta.slice();
      for (const [i, d] of [di, dj]) if (i >= 0) x[i] += d * step[i];
      return f(x);
    };
  const f0 = f(theta);
  const H = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    H[i][i] = (at([i, 1], [-1, 0]) - 2 * f0 + at([i, -1], [-1, 0])) / step[i] ** 2;
    for (let j = 0; j < i; j++)
      H[i][j] = H[j][i] =
        (at([i, 1], [j, 1]) - at([i, 1], [j, -1]) - at([i, -1], [j, 1]) + at([i, -1], [j, -1])) / (4 * step[i] * step[j]);
  }
  return H;
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
 * row-standardized ({ rows, w } from regression.standardize); `spectrum` is
 * weightSpectrum's: the eigenvalues of W, or the Chebyshev approximation's
 * traces above 2,500 areas; olsLogLik is the OLS log-likelihood for the LR
 * test.
 */
export function spatialModel(type, X, y, W, spectrum, { names = [], olsLogLik, seed = 12345 } = {}) {
  const n = y.length,
    k = X[0].length;
  const chebyshev = spectrum.method === "chebyshev",
    omega = chebyshev ? null : spectrum;
  const logDetOf = chebyshev ? (r) => chebyshevLogDet(r, spectrum) : (r) => logDet(r, omega);
  // spatialreg's interval for the approximate methods, (−1, 0.999).
  const lower = chebyshev ? -1 : 1 / omega[0] + 1e-9,
    upper = chebyshev ? 0.999 : 1 / omega.at(-1) - 1e-9;
  const cols = X[0].map((_, j) => X.map((r) => r[j]));
  const Wy = lag(W, y);
  const WX = type === "lag" ? null : cols.map((c) => lag(W, c));
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
          const negLogLik = (rho) => (n / 2) * Math.log(sse(rho) / n) - logDetOf(rho);
          const rho = brent(negLogLik, lower, upper);
          return { parameter: rho, beta: e0.coef.map((b, j) => b - rho * eL.coef[j]), s2: sse(rho) / n, logDet: logDetOf(rho) };
        })()
      : (() => {
          const filtered = (lambda) => {
            const ys = y.map((v, i) => v - lambda * Wy[i]);
            const Xs = X.map((r, i) => r.map((x, j) => x - lambda * WX[j][i]));
            return { Xs, fit: leastSquares(Xs, ys) };
          };
          const negLogLik = (lambda) => {
            const { fit } = filtered(lambda);
            return (n / 2) * Math.log(dot(fit.residuals, fit.residuals) / n) - logDetOf(lambda);
          };
          const lambda = brent(negLogLik, lower, upper);
          const { Xs, fit } = filtered(lambda);
          return { parameter: lambda, beta: fit.coef, s2: dot(fit.residuals, fit.residuals) / n, logDet: logDetOf(lambda), Xs };
        })();
  const { parameter: p, beta, s2 } = fit;
  const logLik = -(n / 2) * (Math.log(2 * Math.PI) + Math.log(s2) + 1) + fit.logDet;
  const C = compressed(W);
  const { pSE, betaSE } = chebyshev
    ? hessianErrors(type, X, y, Wy, WX, fit, logDetOf, [lower, upper])
    : informationErrors(type, X, cols, beta, s2, fit, C, p, omega);
  const z = p / pSE;
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
    logDetMethod: chebyshev ? "chebyshev" : "eigen",
    parameter: { name: type === "lag" ? "ρ (rho)" : "λ (lambda)", estimate: p, se: pSE, z, p: 2 * pnorm(-Math.abs(z)) },
    coefficients: beta.map((b, j) => {
      const zj = b / betaSE[j];
      return { name: names[j] ?? (j ? "x" + j : "(Intercept)"), estimate: b, se: betaSE[j], statistic: zj, p: 2 * pnorm(-Math.abs(zj)) };
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
    const meanInv = chebyshev ? meanInverseDiagonal(p, spectrum, { seed }) : omega.reduce((s, w) => s + 1 / (1 - p * w), 0) / n;
    result.impacts = beta.slice(1).map((b, j) => ({
      name: names[j + 1] ?? "x" + (j + 1),
      direct: b * meanInv,
      indirect: b / (1 - p) - b * meanInv,
      total: b / (1 - p),
    }));
  }
  return result;
}

// Standard errors from the full information matrix over (σ², ρ or λ, β), as
// spatialreg's eigen method orders and computes it.
function informationErrors(type, X, cols, beta, s2, fit, C, p, omega) {
  const n = X.length,
    k = X[0].length;
  const { trA, trAA, trAtA } = informationTraces(C, p, omega);
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
  return { pSE: se[1], betaSE: se.slice(2) };
}

// Standard errors from a numerical Hessian of the log-likelihood concentrated
// on σ² (σ² = SSE/n), over θ = (ρ or λ, β), as spatialreg computes them for
// its approximate log-determinants. Steps are a hundredth of a rough standard
// error: σ²(XᵀX)⁻¹ for β, and the curvature in ρ alone for ρ.
function hessianErrors(type, X, y, Wy, WX, fit, logDetOf, [lower, upper]) {
  const n = y.length,
    k = X[0].length;
  const sse =
    type === "lag"
      ? (r, b) => {
          let s = 0;
          for (let i = 0; i < n; i++) {
            let e = y[i] - r * Wy[i];
            for (let j = 0; j < k; j++) e -= X[i][j] * b[j];
            s += e * e;
          }
          return s;
        }
      : (r, b) => {
          let s = 0;
          for (let i = 0; i < n; i++) {
            let e = y[i] - r * Wy[i];
            for (let j = 0; j < k; j++) e -= (X[i][j] - r * WX[j][i]) * b[j];
            s += e * e;
          }
          return s;
        };
  const logLik = (theta) => {
    const b = theta.slice(1);
    return logDetOf(theta[0]) - (n / 2) * (Math.log(2 * Math.PI) + Math.log(sse(theta[0], b) / n) + 1);
  };
  const theta = [fit.parameter, ...fit.beta];
  const design = type === "lag" ? X : fit.Xs;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => design.reduce((s, r) => s + r[i] * r[j], 0)));
  const xtxInv = inverse(xtx);
  const d = 1e-4,
    f0 = logLik(theta),
    curve = -(logLik([theta[0] + d, ...fit.beta]) - 2 * f0 + logLik([theta[0] - d, ...fit.beta])) / (d * d);
  const scale = [curve > 0 ? 1 / Math.sqrt(curve) : 0.01, ...xtxInv.map((row, j) => Math.sqrt(fit.s2 * row[j]))];
  // Keep the steps in ρ inside the interval.
  scale[0] = Math.min(scale[0], (0.5 * Math.min(theta[0] - lower, upper - theta[0])) / 1e-2);
  const H = numericalHessian(logLik, theta, scale);
  const cov = inverse(H.map((row) => row.map((v) => -v)));
  const se = cov.map((row, i) => Math.sqrt(row[i]));
  return { pSE: se[0], betaSE: se.slice(1) };
}
