// OLS and its diagnostics against R: lm, VIF and Jarque–Bera by formula,
// lmtest::bptest, and spdep's lm.morantest and lm.RStests over queen and
// 6-nearest-neighbor weights, for PLACES diabetes on four ACS covariates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { knn } from "../src/stats/neighbors.js";
import { ols, standardize } from "../src/stats/regression.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const reference = read("./models-reference.json");
const ref = reference.ols,
  la = reference.linalg;
const table = (file) => {
  const t = read("../public/data/ms/tables/" + file);
  return { at: new Map(t.ids.map((id, i) => [id, i])), columns: t.columns };
};
const acs = table("tracts-acs.json"),
  places = table("tracts-places.json");
const ids = ref.ids;
const X = ids.map((id) => [1, ...la.covariates.map((c) => acs.columns[c][acs.at.get(id)])]);
const y = ids.map((id) => places.columns[la.outcome][places.at.get(id)]);
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

const queen = read("../public/data/ms/neighbors.json").queen;
const at = new Map(ids.map((id, i) => [id, i]));
const queenW = standardize(ids.map((id) => queen[id].filter((j) => at.has(j)).map((j) => at.get(j))));
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const centers = read("../public/data/ms/tables/tracts-centers.json");
const where = new Map(centers.ids.map((id, i) => [id, projection.forward([centers.lon[i], centers.lat[i]])]));
const knnW = standardize(knn(ids.map((id) => where.get(id)), 6));

test("OLS estimates and fit statistics match lm", () => {
  const fit = ols(X, y, { names: ["(Intercept)", ...la.covariates] });
  fit.coefficients.forEach((c, j) => {
    close(c.estimate, ref.coef[j], 1e-10, "coef " + j);
    close(c.se, ref.se[j], 1e-10, "se " + j);
    close(c.statistic, ref.t[j], 1e-10, "t " + j);
    close(c.p, ref.p[j], 1e-9, "p " + j);
  });
  close(fit.sigma, ref.sigma, 1e-12, "sigma");
  close(fit.r2, ref.r2, 1e-12, "R²");
  close(fit.adjR2, ref.adjR2, 1e-12, "adjusted R²");
  close(fit.F.statistic, ref.F, 1e-10, "F");
  close(fit.logLik, ref.logLik, 1e-12, "log-likelihood");
  close(fit.aic, ref.aic, 1e-12, "AIC");
  close(fit.sc, ref.sc, 1e-12, "Schwarz");
});

test("multicollinearity, normality and heteroskedasticity diagnostics match R", () => {
  const fit = ols(X, y);
  fit.vif.forEach((v, j) => close(v, ref.vif[j], 1e-10, "VIF " + j));
  close(fit.conditionNumber, ref.conditionNumber, 1e-10, "condition number");
  close(fit.jarqueBera.statistic, ref.jarqueBera, 1e-10, "Jarque–Bera");
  close(fit.breuschPagan.statistic, ref.breuschPagan, 1e-10, "Breusch–Pagan");
  close(fit.koenker.statistic, ref.koenker, 1e-10, "Koenker");
});

test("residual Moran's I and the LM tests match spdep for queen and k-nearest weights", () => {
  for (const [name, W] of [
    ["queen", queenW],
    ["knn6", knnW],
  ]) {
    const { spatial } = ols(X, y, { W });
    const want = ref[name];
    close(spatial.moran.I, want.I, 1e-10, name + " I");
    close(spatial.moran.expected, want.expected, 1e-10, name + " E[I]");
    close(spatial.moran.variance, want.variance, 1e-9, name + " Var[I]");
    for (const t of ["lmError", "lmLag", "robustLmError", "robustLmLag", "sarma"])
      close(spatial[t].statistic, want[t], 1e-9, name + " " + t);
  }
});
