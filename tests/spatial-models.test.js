// Spatial lag and spatial error models against spatialreg (lagsarlm and
// errorsarlm, method = "eigen", and impacts) over queen and distance-band
// weights, for PLACES diabetes on four ACS covariates over 869 tracts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { band, connectingBand } from "../src/stats/neighbors.js";
import { brent, spatialModel, symmetricWeights, weightEigenvalues } from "../src/stats/spatial-models.js";
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
