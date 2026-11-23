// Fits a regression over a layer's areas from the same inputs as the other
// analyses: the measure to explain (values), covariates by name, the weights
// used for spatial diagnostics (and spatial models), and an optional study
// area. Areas missing any variable, outside the study area or without an
// eligible neighbor are left out and say why. Areas are classed by their
// standardized residual for the map. Pure.
import { ols, standardize } from "./regression.js";
import { prepareUniverse } from "./stats.js";

export const MODEL_TYPES = { ols: "Ordinary least squares" };

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
  const { values, covariates = {}, modelType: type = "ols" } = input;
  const names = Object.keys(covariates);
  if (!names.length) throw new Error("Choose at least one covariate.");
  if (!MODEL_TYPES[type]) throw new Error("Unknown model type " + type + ".");
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
  const fit = ols(X, y, { names: ["(Intercept)", ...names], W });
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
      " with an intercept; standard errors from σ²(XᵀX)⁻¹; residual Moran's I with its exact moments under the regression and Lagrange multiplier tests over row-standardized " +
      weights.label +
      ".",
  };
}
