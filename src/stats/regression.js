// Ordinary least squares with the diagnostics GeoDa reports: coefficients
// with t tests; R², the F test, log-likelihood, AIC and Schwarz's criterion;
// multicollinearity (the Belsley condition number and each covariate's VIF);
// residual normality (Jarque–Bera); heteroskedasticity (Breusch–Pagan and
// Koenker's studentized form); and spatial dependence in the residuals:
// Moran's I with its exact moments under the regression (Cliff & Ord 1981)
// and the Lagrange multiplier tests for a spatial lag or error and their
// robust forms (Anselin 1988; Anselin, Bera, Florax & Yoon 1996).
// Weights are row-standardized and kept sparse; every trace is taken
// without forming an n × n matrix. Pure.
import { pchisq, pf, pnorm, pt } from "./dist.js";
import { crossprodInverse, leastSquares, qr, symmetricEigenvalues } from "./linalg.js";

const sum = (v) => v.reduce((s, x) => s + x, 0);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Row-standardized sparse weights { rows, w } with w the standardized weights. */
export function standardize(rows, w) {
  return {
    rows,
    w: rows.map((row, i) => {
      const total = w ? w[i].reduce((s, x) => s + x, 0) : row.length;
      return row.map((_, k) => (w ? w[i][k] : 1) / total);
    }),
  };
}

/** W v for sparse row-standardized weights. */
export const lag = (W, v) => W.rows.map((row, i) => row.reduce((s, j, k) => s + W.w[i][k] * v[j], 0));
/** Wᵀ v. */
export function lagT(W, v) {
  const out = new Float64Array(v.length);
  W.rows.forEach((row, i) => row.forEach((j, k) => (out[j] += W.w[i][k] * v[i])));
  return Array.from(out);
}

/** tr(WW) and tr(WᵀW) for sparse weights. */
export function traces(W) {
  const at = W.rows.map((row, i) => new Map(row.map((j, k) => [j, W.w[i][k]])));
  let ww = 0,
    wtw = 0;
  W.rows.forEach((row, i) =>
    row.forEach((j, k) => {
      const wij = W.w[i][k];
      wtw += wij * wij;
      ww += wij * (at[j].get(i) || 0);
    }),
  );
  return { ww, wtw };
}

/** The columns of a matrix given as rows. */
const columnsOf = (X) => X[0].map((_, j) => X.map((r) => r[j]));
/** Aᵀ B for column lists A and B (p × q). */
const cross = (A, B) => A.map((a) => B.map((b) => dot(a, b)));
const matTrace = (M) => M.reduce((s, row, i) => s + row[i], 0);
const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, x, k) => s + x * B[k][j], 0)));

/** Belsley's condition number: √(λmax/λmin) of XᵀX with unit-length columns. */
export function conditionNumber(X) {
  const cols = columnsOf(X).map((c) => {
    const norm = Math.sqrt(dot(c, c));
    return c.map((x) => x / norm);
  });
  const values = symmetricEigenvalues(cross(cols, cols));
  return Math.sqrt(values.at(-1) / values[0]);
}

/** Variance inflation: 1 / (1 − R²) of each covariate on the others (with the intercept). */
export function vif(X) {
  const p = X[0].length;
  const out = [];
  for (let j = 1; j < p; j++) {
    const y = X.map((r) => r[j]),
      Z = X.map((r) => r.filter((_, k) => k !== j));
    const fit = leastSquares(Z, y);
    const mean = sum(y) / y.length;
    const tss = y.reduce((s, v) => s + (v - mean) ** 2, 0);
    const rss = fit.residuals.reduce((s, e) => s + e * e, 0);
    out.push(1 / (rss / tss));
  }
  return out;
}

/** Jarque–Bera normality of residuals: n/6 (S² + (K − 3)²/4), χ²(2). */
export function jarqueBera(e) {
  const n = e.length,
    m = sum(e) / n;
  const m2 = e.reduce((s, x) => s + (x - m) ** 2, 0) / n,
    m3 = e.reduce((s, x) => s + (x - m) ** 3, 0) / n,
    m4 = e.reduce((s, x) => s + (x - m) ** 4, 0) / n;
  const S = m3 / m2 ** 1.5,
    K = m4 / (m2 * m2);
  const stat = (n / 6) * (S * S + (K - 3) ** 2 / 4);
  return { statistic: stat, df: 2, p: pchisq(stat, 2, false) };
}

/**
 * Breusch–Pagan on the regressors: the original (half the explained sum of
 * squares of e²/σ̂² on X) and Koenker's studentized form (n R² of e² on X).
 */
export function breuschPagan(X, e) {
  const n = e.length,
    k = X[0].length;
  const e2 = e.map((x) => x * x),
    s2 = sum(e2) / n;
  const g = e2.map((x) => x / s2);
  const fitG = leastSquares(X, g);
  const gm = sum(g) / n;
  const essG = fitG.fitted.reduce((s, v) => s + (v - gm) ** 2, 0);
  const fitE = leastSquares(X, e2);
  const em = sum(e2) / n;
  const tssE = e2.reduce((s, v) => s + (v - em) ** 2, 0),
    rssE = fitE.residuals.reduce((s, v) => s + v * v, 0);
  const bp = essG / 2,
    koenker = n * (1 - rssE / tssE);
  return {
    breuschPagan: { statistic: bp, df: k - 1, p: pchisq(bp, k - 1, false) },
    koenker: { statistic: koenker, df: k - 1, p: pchisq(koenker, k - 1, false) },
  };
}

/**
 * Spatial diagnostics of OLS residuals over row-standardized weights W:
 * Moran's I with its moments under the regression, and the LM tests.
 */
export function spatialDiagnostics(X, y, coef, e, W, xtxInverse) {
  const n = y.length,
    k = X[0].length;
  const cols = columnsOf(X);
  const WX = cols.map((c) => lag(W, c)),
    WtX = cols.map((c) => lagT(W, c));
  const A = xtxInverse;
  // tr(MW) = −tr(A XᵀWX), tr(MWMW) and tr(MWMWᵀ) from p × p products only,
  // with M = I − X A Xᵀ and A = (XᵀX)⁻¹.
  const XWX = cross(cols, WX),
    XWWX = cross(WtX, WX),
    XWWtX = cross(WtX, WtX),
    XWtWX = cross(WX, WX);
  const { ww, wtw } = traces(W);
  const AXWX = matMul(A, XWX),
    XWXt = XWX[0].map((_, j) => XWX.map((row) => row[j]));
  const trMW = -matTrace(AXWX);
  const trMWMW = ww - 2 * matTrace(matMul(A, XWWX)) + matTrace(matMul(AXWX, AXWX));
  const trMWMWt =
    wtw - matTrace(matMul(A, XWWtX)) - matTrace(matMul(A, XWtWX)) + matTrace(matMul(AXWX, matMul(A, XWXt)));
  const ee = dot(e, e),
    We = lag(W, e);
  // Row-standardized weights sum to n, so n / S0 = 1.
  const I = dot(e, We) / ee;
  const EI = trMW / (n - k);
  const VI = (trMWMWt + trMWMW + trMW * trMW) / ((n - k) * (n - k + 2)) - EI * EI;
  const zI = (I - EI) / Math.sqrt(VI);
  // Lagrange multipliers, with σ² = e'e / n.
  const s2 = ee / n;
  const T = ww + wtw;
  const dErr = dot(e, We) / s2,
    dLag = dot(e, lag(W, y)) / s2;
  const WXb = lag(
    W,
    X.map((r) => dot(r, coef)),
  );
  // (WXb)' M (WXb) = ‖WXb‖² − (Xᵀ WXb)' A (Xᵀ WXb).
  const xt = cols.map((c) => dot(c, WXb));
  const MWXb = dot(WXb, WXb) - dot(xt, A.map((row) => dot(row, xt)));
  const nJ = MWXb / s2 + T;
  const test = (statistic, df = 1) => ({ statistic, df, p: pchisq(statistic, df, false) });
  return {
    moran: { I, expected: EI, variance: VI, z: zI, p: 2 * pnorm(-Math.abs(zI)) },
    lmError: test((dErr * dErr) / T),
    lmLag: test((dLag * dLag) / nJ),
    robustLmError: test((dErr - (T / nJ) * dLag) ** 2 / (T - (T * T) / nJ)),
    robustLmLag: test((dLag - dErr) ** 2 / (nJ - T)),
    sarma: test((dLag - dErr) ** 2 / (nJ - T) + (dErr * dErr) / T, 2),
  };
}

/**
 * OLS of y on X (rows with a leading 1 for the intercept). `W` (row-
 * standardized, from standardize()) adds the spatial diagnostics.
 */
export function ols(X, y, { names = [], W = null } = {}) {
  const n = y.length,
    k = X[0].length;
  if (n <= k + 1) throw new Error("The model needs more areas than coefficients.");
  const f = qr(X);
  const fit = leastSquares(X, y, f);
  const e = fit.residuals;
  const rss = dot(e, e),
    mean = sum(y) / n,
    tss = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const df = n - k,
    sigma2 = rss / df;
  const A = crossprodInverse(f.R);
  const se = A.map((row, j) => Math.sqrt(sigma2 * row[j]));
  const t = fit.coef.map((b, j) => b / se[j]);
  const r2 = 1 - rss / tss;
  const F = ((tss - rss) / (k - 1)) / (rss / df);
  const logLik = -(n / 2) * (Math.log(2 * Math.PI) + Math.log(rss / n) + 1);
  const sigmaML = Math.sqrt(rss / n);
  return {
    type: "ols",
    n,
    k,
    names,
    coefficients: fit.coef.map((b, j) => ({
      name: names[j] ?? (j ? "x" + j : "(Intercept)"),
      estimate: b,
      se: se[j],
      statistic: t[j],
      p: 2 * pt(-Math.abs(t[j]), df),
    })),
    sigma: Math.sqrt(sigma2),
    r2,
    adjR2: 1 - (1 - r2) * ((n - 1) / df),
    F: { statistic: F, df1: k - 1, df2: df, p: pf(F, k - 1, df, false) },
    logLik,
    // σ counts as a parameter, as in R's AIC() and spatialreg, so OLS compares with the spatial models.
    aic: -2 * logLik + 2 * (k + 1),
    sc: -2 * logLik + (k + 1) * Math.log(n),
    conditionNumber: conditionNumber(X),
    vif: k > 2 ? vif(X) : k === 2 ? [1] : [],
    jarqueBera: jarqueBera(e),
    ...breuschPagan(X, e),
    fitted: fit.fitted,
    residuals: e,
    standardized: e.map((r) => r / sigmaML),
    spatial: W ? spatialDiagnostics(X, y, fit.coef, e, W, A) : null,
  };
}
