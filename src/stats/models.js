// Fits a regression over a layer's areas from the same inputs as the other
// analyses: the measure to explain (values), covariates by name, the weights
// used for spatial diagnostics (and spatial models), and an optional study
// area. Areas missing any variable, outside the study area or without an
// eligible neighbor are left out and say why. Areas are classed by their
// standardized residual for the map. Pure.
import { countModel } from "./glm.js";
import { randomGenerator, shuffle } from "./random.js";
import { lag, ols, standardize } from "./regression.js";
import { spatialModel, weightEigenvalues } from "./spatial-models.js";
import { prepareUniverse } from "./stats.js";

export const MODEL_TYPES = {
  ols: "Ordinary least squares",
  lag: "Spatial lag (maximum likelihood)",
  error: "Spatial error (maximum likelihood)",
  poisson: "Poisson (counts, log-population offset)",
  nb: "Negative binomial (counts, log-population offset)",
};
export const COUNT_TYPES = new Set(["poisson", "nb"]);

/** Moran's I of residuals over row-standardized W, with a seeded two-sided permutation p. */
function residualMoran(e, W, permutations = 999, seed = 12345) {
  const I = (v) => {
    const l = lag(W, v);
    let num = 0,
      den = 0;
    for (let i = 0; i < v.length; i++) {
      num += v[i] * l[i];
      den += v[i] * v[i];
    }
    return num / den;
  };
  const observed = I(e),
    expected = -1 / (e.length - 1);
  const random = randomGenerator(seed),
    shuffled = e.slice();
  let extreme = 0;
  for (let d = 0; d < permutations; d++) if (Math.abs(I(shuffle(shuffled, random)) - expected) >= Math.abs(observed - expected) - 1e-12) extreme++;
  return { I: observed, p: (extreme + 1) / (permutations + 1), permutations };
}

/** Residual classes by standardized residual, as GeoDa and ArcGIS map them. */
export function residualClass(z) {
  if (!Number.isFinite(z)) return "NA";
  const a = Math.abs(z),
    side = z < 0 ? "N" : "P";
  return a < 0.5 ? "Z" : side + (a < 1.5 ? 1 : a < 2.5 ? 2 : 3);
}

/**
 * GeoDa's guide to the spatial diagnostics (Anselin 2005): keep OLS when
 * neither LM test is significant; else the one that is; when both are, the
 * one whose robust form is.
 */
export function suggestion(spatial, alpha = 0.05) {
  if (!spatial) return null;
  const lag = spatial.lmLag.p <= alpha,
    err = spatial.lmError.p <= alpha;
  if (!lag && !err) return "No spatial dependence detected: OLS is adequate.";
  if (lag && !err) return "Spatial lag model suggested (LM-lag significant).";
  if (err && !lag) return "Spatial error model suggested (LM-error significant).";
  const rLag = spatial.robustLmLag.p <= alpha,
    rErr = spatial.robustLmError.p <= alpha;
  if (rLag && !rErr) return "Spatial lag model suggested (robust LM-lag significant).";
  if (rErr && !rLag) return "Spatial error model suggested (robust LM-error significant).";
  return spatial.robustLmLag.statistic >= spatial.robustLmError.statistic
    ? "Both robust tests are significant; the lag model's is larger."
    : "Both robust tests are significant; the error model's is larger.";
}

/**
 * A model: { modelType ("ols"), values (y by id), covariates
 * ({ name: { id: x } }), and the weights inputs of stats.analyze }.
 */
export function fitModel(input) {
  const { covariates = {}, modelType: type = "ols", events, base } = input;
  const names = Object.keys(covariates);
  if (!names.length) throw new Error("Choose at least one covariate.");
  if (!MODEL_TYPES[type]) throw new Error("Unknown model type " + type + ".");
  const counting = COUNT_TYPES.has(type);
  if (counting && !events) throw new Error("Count models need a measure with counts: a numerator and a denominator.");
  // Count models explain the events with log(base) as the offset.
  const values = counting
    ? Object.fromEntries(Object.keys(events).map((id) => [id, base?.[id] > 0 ? events[id] : null]))
    : input.values;
  // An area needs the outcome and every covariate.
  const complete = Object.fromEntries(
    Object.entries(values).map(([id, v]) => [
      id,
      Number.isFinite(v) && names.every((n) => Number.isFinite(covariates[n][id])) ? v : null,
    ]),
  );
  const { ids, byId, rows, w, weights } = prepareUniverse({ ...input, values: complete });
  for (const id of Object.keys(byId))
    if (byId[id].reason === "Missing estimate" && Number.isFinite(values[id])) byId[id].reason = "Missing covariate";
  const y = ids.map((id) => values[id]),
    X = ids.map((id) => [1, ...names.map((n) => covariates[n][id])]);
  const W = standardize(rows, w);
  if (counting) return countResult(type, ids, byId, X, y, ids.map((id) => Math.log(base[id])), W, names, weights);
  const olsFit = ols(X, y, { names: ["(Intercept)", ...names], W });
  // A spatial model reports its own estimates; the OLS diagnostics stay beside them.
  const fit =
    type === "ols"
      ? olsFit
      : {
          ...olsFit,
          ...spatialModel(type, X, y, W, weightEigenvalues(rows, w), { names: ["(Intercept)", ...names], olsLogLik: olsFit.logLik }),
          olsAic: olsFit.aic,
        };
  ids.forEach((id, i) => {
    const z = fit.standardized[i];
    Object.assign(byId[id], {
      value: y[i],
      fitted: fit.fitted[i],
      residual: fit.residuals[i],
      standardized: z,
      cluster: residualClass(z),
    });
  });
  const { fitted, residuals, standardized, ...summary } = fit;
  return {
    ...summary,
    method: "model",
    modelType: type,
    byId,
    weights,
    suggestion: suggestion(fit.spatial),
    covariates: names,
    permutations: 0,
    alpha: 0.05,
    fdr: false,
    methodNote:
      MODEL_TYPES[type] +
      " with an intercept" +
      (type === "ols"
        ? "; standard errors from σ²(XᵀX)⁻¹"
        : "; log|I − ρW| from the eigenvalues of W; asymptotic standard errors from the information matrix") +
      "; OLS residual Moran's I with its exact moments and Lagrange multiplier tests over row-standardized " +
      weights.label +
      ".",
  };
}

// A count model's result, in the same shape as the linear models'.
function countResult(type, ids, byId, X, y, offset, W, names, weights) {
  const fit = countModel(type, X, y, offset, { names: ["(Intercept)", ...names] });
  ids.forEach((id, i) => {
    const z = fit.residuals[i];
    Object.assign(byId[id], { value: y[i], fitted: fit.fitted[i], residual: z, standardized: z, cluster: residualClass(z) });
  });
  const { fitted, residuals, standardized, ...summary } = fit;
  return {
    ...summary,
    method: "model",
    modelType: type,
    byId,
    weights,
    covariates: names,
    residualMoran: residualMoran(residuals, W),
    permutations: 0,
    alpha: 0.05,
    fdr: false,
    methodNote:
      MODEL_TYPES[type] +
      " with an intercept, log link and log-population offset; " +
      (type === "nb" ? "β by IRLS alternating with θ by maximum likelihood; " : "fitted by IRLS; ") +
      "Wald z tests and rate ratios; Pearson residuals, with Moran's I over row-standardized " +
      weights.label +
      " and a 999-permutation p.",
  };
}
