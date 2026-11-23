// Poisson and negative binomial regression against R (glm and MASS::glm.nb)
// for drug overdose deaths by county with a log person-years offset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countModel, thetaML } from "../src/stats/glm.js";
import { digamma, trigamma } from "../src/stats/dist.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./models-reference.json").counts;
const chr = new Map(read("../public/data/ms/layers/chr_counties_2025.geojson").features.map((f) => [String(f.id), f.properties]));
const rows = ref.ids.map((id) => chr.get(id));
const X = rows.map((p) => [1, ...ref.covariates.map((c) => p[c])]);
const y = rows.map((p) => p.v138_numerator);
const offset = rows.map((p) => Math.log(p.v138_denominator));
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

for (const type of ["poisson", "nb"]) {
  test(`${type === "nb" ? "negative binomial" : "Poisson"} regression matches R`, () => {
    const fit = countModel(type, X, y, offset);
    const want = ref[type];
    fit.coefficients.forEach((c, j) => {
      close(c.estimate, want.coef[j], 1e-7, "coef " + j);
      close(c.se, want.se[j], 1e-6, "se " + j);
      close(c.statistic, want.z[j], 1e-6, "z " + j);
      close(c.ratio, Math.exp(want.coef[j]), 1e-7, "rate ratio " + j);
    });
    close(fit.deviance.residual, want.deviance, 1e-7, "deviance");
    close(fit.deviance.null, want.nullDeviance, 1e-7, "null deviance");
    close(fit.aic, want.aic, 1e-8, "AIC");
    close(fit.logLik, want.logLik, 1e-8, "log-likelihood");
    fit.residuals.forEach((r, i) => close(r, want.pearson[i], 1e-6, "Pearson residual " + i));
    if (type === "nb") {
      close(fit.theta.estimate, want.theta, 1e-6, "theta");
      close(fit.theta.se, want.thetaSe, 1e-5, "theta SE");
    } else assert.ok(fit.dispersion > 1.5, "these deaths are overdispersed for a Poisson model");
  });
}

test("digamma and trigamma match R, and counts must be whole numbers", () => {
  close(digamma(1), -0.577215664901532, 1e-14, "digamma(1)");
  close(trigamma(0.5), 4.93480220054468, 1e-14, "trigamma(0.5)");
  assert.throws(() => countModel("poisson", X, y.map((v) => v + 0.5), offset), /whole-number counts/);
  const { theta } = thetaML([0, 2, 5, 1, 9], [2, 2, 3, 2, 4]);
  assert.ok(theta > 0);
});
