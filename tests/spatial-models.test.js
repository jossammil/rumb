// Spatial lag and spatial error models against spatialreg (lagsarlm and
// errorsarlm, method = "eigen", and impacts) over queen and distance-band
// weights, for PLACES diabetes on four ACS covariates over 869 tracts; and,
// above 2,500 areas, against method = "Chebyshev" on a 60 × 60 rook lattice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { band, connectingBand } from "../src/stats/neighbors.js";
import {
  brent,
  chebyshevLogDet,
  powerTraces,
  spatialModel,
  symmetricWeights,
  weightEigenvalues,
  weightSpectrum,
} from "../src/stats/spatial-models.js";
import { ols, standardize } from "../src/stats/regression.js";
import { fitModel } from "../src/stats/models.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const reference = read("./models-reference.json");
const la = reference.linalg,
  ids = reference.ols.ids;
const table = (file) => {
  const t = read("../public/data/ms/tables/" + file);
  return { at: new Map(t.ids.map((id, i) => [id, i])), columns: t.columns };
};
const acs = table("tracts-acs.json"),
  places = table("tracts-places.json");
const X = ids.map((id) => [1, ...la.covariates.map((c) => acs.columns[c][acs.at.get(id)])]);
const y = ids.map((id) => places.columns[la.outcome][places.at.get(id)]);
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

const queen = read("../public/data/ms/neighbors.json").queen;
const at = new Map(ids.map((id, i) => [id, i]));
const queenRows = ids.map((id) => queen[id].filter((j) => at.has(j)).map((j) => at.get(j)));
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const centers = read("../public/data/ms/tables/tracts-centers.json");
const where = new Map(centers.ids.map((id, i) => [id, projection.forward([centers.lon[i], centers.lat[i]])]));
const xy = ids.map((id) => where.get(id));
const bandRows = band(xy, connectingBand(xy));

for (const [name, rows] of [
  ["queen", queenRows],
  ["band", bandRows],
]) {
  test(`spatial lag and error models match spatialreg over ${name} weights`, () => {
    const W = standardize(rows),
      omega = weightEigenvalues(rows),
      base = ols(X, y);
    const want = reference.spatial[name];
    const lag = spatialModel("lag", X, y, W, omega, { olsLogLik: base.logLik });
    close(lag.parameter.estimate, want.lag.rho, 1e-6, "rho");
    close(lag.parameter.se, want.lag.rhoSe, 1e-5, "rho SE");
    lag.coefficients.forEach((c, j) => {
      close(c.estimate, want.lag.coef[j], 1e-6, "lag coef " + j);
      close(c.se, want.lag.se[j], 1e-5, "lag SE " + j);
    });
    close(lag.logLik, want.lag.logLik, 1e-9, "lag log-likelihood");
    close(lag.aic, want.lag.aic, 1e-9, "lag AIC");
    close(lag.lr.statistic, want.lag.lr, 1e-6, "lag LR");
    close(lag.wald.statistic, want.lag.wald, 1e-4, "lag Wald");
    lag.impacts.forEach((imp, j) => {
      close(imp.direct, want.lag.direct[j][0], 1e-6, "direct " + j);
      close(imp.indirect, want.lag.indirect[j][0], 1e-6, "indirect " + j);
      close(imp.total, want.lag.total[j][0], 1e-6, "total " + j);
    });
    const error = spatialModel("error", X, y, W, omega, { olsLogLik: base.logLik });
    close(error.parameter.estimate, want.error.lambda, 1e-6, "lambda");
    close(error.parameter.se, want.error.lambdaSe, 1e-5, "lambda SE");
    error.coefficients.forEach((c, j) => {
      close(c.estimate, want.error.coef[j], 1e-6, "error coef " + j);
      close(c.se, want.error.se[j], 1e-5, "error SE " + j);
    });
    close(error.logLik, want.error.logLik, 1e-9, "error log-likelihood");
    close(error.aic, want.error.aic, 1e-9, "error AIC");
    close(error.lr.statistic, want.error.lr, 1e-6, "error LR");
  });
}

test("spatial models need symmetric weights, and Brent finds a minimum", () => {
  assert.ok(symmetricWeights(queenRows));
  assert.ok(!symmetricWeights([[1], [2], [0]]));
  assert.throws(() => weightEigenvalues([[1], [2], [0]]), /symmetric weights/);
  const x = brent((v) => (v - 0.3) ** 2 + 1, -1, 1);
  assert.ok(Math.abs(x - 0.3) < 1e-9);
});

test("fitModel runs a spatial lag model end to end", () => {
  const values = Object.fromEntries(ids.map((id, i) => [id, y[i]]));
  const covariates = Object.fromEntries(la.covariates.map((c, j) => [c, Object.fromEntries(ids.map((id, i) => [id, X[i][j + 1]]))]));
  const neighbors = Object.fromEntries(ids.map((id, i) => [id, queenRows[i].map((j) => ids[j])]));
  const result = fitModel({ values, covariates, neighbors, weights: { kind: "queen" }, modelType: "lag" });
  close(result.parameter.estimate, reference.spatial.queen.lag.rho, 1e-6, "rho");
  assert.equal(result.n, ids.length);
  assert.ok(result.spatial.lmLag.statistic > 0, "OLS diagnostics stay beside the spatial fit");
  assert.ok(Object.values(result.byId).every((r) => r.reason || Number.isFinite(r.standardized)));
});

// The lattice: cell r, c is r·60 + c, its rook neighbors in index order.
const cheb = reference.chebyshev;
const side = cheb.side;
const latticeRows = Array.from({ length: side * side }, (_, id) => {
  const r = Math.floor(id / side),
    c = id % side;
  return [r > 0 && id - side, c > 0 && id - 1, c < side - 1 && id + 1, r < side - 1 && id + side].filter((j) => j !== false);
});

test("above 2,500 areas, Chebyshev fits match spatialreg's on a 60 × 60 lattice", () => {
  const W = standardize(latticeRows),
    spectrum = weightSpectrum(latticeRows);
  assert.equal(spectrum.method, "chebyshev");
  assert.equal(spectrum.order, cheb.order);
  const X = cheb.x1.map((x, i) => [1, x, cheb.x2[i]]);
  // Tolerances, relative (or absolute below 1), with what was achieved: the estimates and
  // LR follow the same approximation and optimizer tolerance (2e-8); the log-likelihood and
  // AIC (1e-15). Standard errors come from two numerical Hessians: rumb's change by 1e-6
  // across steps of 0.005–0.05 standard errors, so the gap (2.3e-4) is nlme::fdHess's.
  // spatialreg's impacts use the exact inverse, rumb's the power series with Monte Carlo
  // traces past order 8 (direct and indirect 1.8e-6; total 5e-8).
  const tol = { estimate: 1e-6, logLik: 1e-9, se: 1e-3, impact: 1e-5 };
  const lag = spatialModel("lag", X, cheb.yLag, W, spectrum, { olsLogLik: cheb.lag.olsLogLik });
  const want = cheb.lag;
  assert.equal(lag.logDetMethod, "chebyshev");
  close(lag.parameter.estimate, want.rho, tol.estimate, "rho");
  close(lag.parameter.se, want.rhoSe, tol.se, "rho SE");
  lag.coefficients.forEach((c, j) => {
    close(c.estimate, want.coef[j], tol.estimate, "lag coef " + j);
    close(c.se, want.se[j], tol.se, "lag SE " + j);
  });
  close(lag.logLik, want.logLik, tol.logLik, "lag log-likelihood");
  close(lag.aic, want.aic, tol.logLik, "lag AIC");
  close(lag.lr.statistic, want.lr, tol.estimate, "lag LR");
  lag.impacts.forEach((imp, j) => {
    close(imp.direct, want.direct[j][0], tol.impact, "direct " + j);
    close(imp.indirect, want.indirect[j][0], tol.impact, "indirect " + j);
    close(imp.total, want.total[j][0], tol.estimate, "total " + j);
  });
  const error = spatialModel("error", X, cheb.yError, W, spectrum, { olsLogLik: cheb.error.olsLogLik });
  const e = cheb.error;
  close(error.parameter.estimate, e.lambda, tol.estimate, "lambda");
  close(error.parameter.se, e.lambdaSe, tol.se, "lambda SE");
  error.coefficients.forEach((c, j) => {
    close(c.estimate, e.coef[j], tol.estimate, "error coef " + j);
    close(c.se, e.se[j], tol.se, "error SE " + j);
  });
  close(error.logLik, e.logLik, tol.logLik, "error log-likelihood");
  close(error.aic, e.aic, tol.logLik, "error AIC");
  close(error.lr.statistic, e.lr, tol.estimate, "error LR");
});

test("the exact sparse traces match the eigenvalues, and the Chebyshev log-determinant is close", () => {
  const omega = weightEigenvalues(queenRows);
  const n = queenRows.length,
    dh = queenRows.map((r) => 1 / Math.sqrt(r.length));
  const start = new Int32Array(n + 1);
  queenRows.forEach((r, i) => (start[i + 1] = start[i] + r.length));
  const S = { n, start, col: Int32Array.from(queenRows.flat()), val: Float64Array.from(queenRows.flatMap((r, i) => r.map((j) => dh[i] * dh[j]))) };
  const traces = powerTraces(S);
  traces.forEach((t, p) => close(t, omega.reduce((s, w) => s + w ** p, 0), 1e-12, "tr W^" + p));
  // T_j traces from the eigenvalues, and log|I − ρW| within the approximation's error.
  const T = (x, j) => (j === 0 ? 1 : j === 1 ? x : 2 * x * T(x, j - 1) - T(x, j - 2));
  const spectrum = { n, order: 7, traces: Array.from({ length: 8 }, (_, j) => omega.reduce((s, w) => s + T(w, j), 0)) };
  for (const rho of [-0.5, 0.3, 0.6]) {
    const exact = omega.reduce((s, w) => s + Math.log(1 - rho * w), 0);
    assert.ok(Math.abs(chebyshevLogDet(rho, spectrum) - exact) < 0.01 * Math.abs(exact), "log-determinant at " + rho);
  }
});

test("spatial models refuse above 20,000 areas and asymmetric weights at any size", () => {
  const ring = (n) => Array.from({ length: n }, (_, i) => [(i + n - 1) % n, (i + 1) % n]);
  assert.throws(() => weightSpectrum(ring(20001)), /limited to 20,000 areas/);
  assert.throws(() => weightSpectrum(Array.from({ length: 3000 }, (_, i) => [(i + 1) % 3000])), /symmetric weights/);
});
