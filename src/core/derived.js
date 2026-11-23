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

/**
 * An access spec made safe: { kind: "access", layer (point facilities),
 * size (a field, or null to count each facility once), population (field),
 * within and catchment (miles), decay ("gaussian" or "step") }.
 */
export function accessSpec(spec) {
  if (spec?.kind !== "access" || typeof spec.layer !== "string" || !spec.layer) return null;
  if (typeof spec.population !== "string" || !spec.population) return null;
  const miles = (v, fallback) => (Number(v) >= 0.5 && Number(v) <= 200 ? Number(v) : fallback);
  return {
    kind: "access",
    layer: spec.layer,
    size: typeof spec.size === "string" && spec.size ? spec.size : null,
    population: spec.population,
    within: miles(spec.within, 10),
    catchment: miles(spec.catchment, 30),
    decay: spec.decay === "step" ? "step" : "gaussian",
  };
}

/** The fields an access spec adds: nearest distance, count within, E2SFCA ratio. */
export const accessFields = (spec) => ["near_" + spec.layer, "in_" + spec.layer, "acc_" + spec.layer];

/** Any derived spec made safe, or null. */
export const derivedSpec = (spec) =>
  spec?.kind === "model" ? modelSpec(spec) : spec?.kind === "access" ? accessSpec(spec) : rateSpec(spec);

/** The fields a model spec adds: predicted, residual and standardized residual. */
export const modelFields = (spec) => ["fit_" + spec.y, "res_" + spec.y, "sres_" + spec.y];
