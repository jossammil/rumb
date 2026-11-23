// Derived fields a layer's stack entry asks for, as small specs that projects
// and share links carry and the app recomputes: smoothed rates
// (stats/rates.js) and a regression's predictions and residuals
// (stats/models.js). Pure.
import { weightsSpec } from "../stats/neighbors.js";
import { rateSpec } from "../stats/rates.js";

export const MODEL_KINDS = ["ols", "lag", "error", "poisson", "nb"];

/** A model spec made safe: { kind: "model", type, y, xs, weights }. */
export function modelSpec(spec) {
  if (spec?.kind !== "model" || typeof spec.y !== "string" || !spec.y) return null;
  const xs = Array.isArray(spec.xs) ? [...new Set(spec.xs.filter((x) => typeof x === "string" && x && x !== spec.y))].slice(0, 12) : [];
  if (!xs.length) return null;
  const { kind, k, miles, power, symmetric } = weightsSpec(spec.weights);
  return {
    kind: "model",
    type: MODEL_KINDS.includes(spec.type) ? spec.type : "ols",
    y: spec.y,
    xs,
    weights: { kind, k, miles, power, symmetric },
  };
}

/** Any derived spec made safe, or null. */
export const derivedSpec = (spec) => (spec?.kind === "model" ? modelSpec(spec) : rateSpec(spec));

/** The fields a model spec adds: predicted, residual and standardized residual. */
export const modelFields = (spec) => ["fit_" + spec.y, "res_" + spec.y, "sres_" + spec.y];
