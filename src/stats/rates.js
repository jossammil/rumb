// Rates from event counts and a base (population, births, person-years):
// raw and excess-risk rates, empirical Bayes smoothing toward the overall rate
// (Marshall 1991, as spdep::EBest) or toward each area's neighborhood
// (spdep::EBlocal with geoda = TRUE, as GeoDa's spatial EB), the spatial
// window rate over an area and its neighbors, exact Poisson limits, and
// reliability flags. Pure.
import { poissonCI } from "./dist.js";

/** The smoothing methods a rate can add as fields: prefix, label, and whether neighbors are needed. */
export const RATE_METHODS = {
  eb: { prefix: "eb_", label: "empirical Bayes", spatial: false },
  seb: { prefix: "seb_", label: "spatial empirical Bayes", spatial: true },
  sr: { prefix: "sr_", label: "spatial window rate", spatial: true },
  er: { prefix: "er_", label: "excess risk (observed ÷ expected)", spatial: false },
  ci: { prefix: "lcl_", label: "95% limits", spatial: false },
};

const usable = (e, n) => Number.isFinite(e) && e >= 0 && Number.isFinite(n) && n > 0;

/** Pooled rate b = Σ events / Σ base over usable areas. */
function pooled(events, base) {
  let e = 0,
    n = 0,
    m = 0;
  events.forEach((x, i) => {
    if (usable(x, base[i])) {
      e += x;
      n += base[i];
      m++;
    }
  });
  return { b: e / n, total: n, m };
}

/** Observed over expected at the overall rate: r_i / b. */
export function excessRisk(events, base) {
  const { b } = pooled(events, base);
  return events.map((e, i) => (usable(e, base[i]) ? e / base[i] / b : null));
}

/**
 * Global empirical Bayes (method of moments): each rate shrunk toward the
 * overall rate b by a / (a + b / n_i), with a = s² − b / n̄ (0 if negative).
 */
export function empiricalBayes(events, base) {
  const { b, total, m } = pooled(events, base);
  let s2 = 0;
  events.forEach((e, i) => {
    if (usable(e, base[i])) s2 += (base[i] * (e / base[i] - b) ** 2) / total;
  });
  const a = Math.max(0, s2 - b / (total / m));
  const estimates = events.map((e, i) => {
    if (!usable(e, base[i])) return null;
    const r = e / base[i];
    return b + (a * (r - b)) / (a + b / base[i]);
  });
  return { estimates, a, b };
}

/**
 * Spatial empirical Bayes: as above within each area's window (itself and
 * its neighbors, rows by index), with the window's variance about its own
 * rate, as GeoDa computes it. Areas without usable counts are left out of
 * every window.
 */
export function spatialEmpiricalBayes(events, base, rows) {
  return events.map((e, i) => {
    if (!usable(e, base[i])) return null;
    const window = [i, ...rows[i]].filter((j) => usable(events[j], base[j]));
    let sumE = 0,
      sumN = 0;
    for (const j of window) {
      sumE += events[j];
      sumN += base[j];
    }
    const m = sumE / sumN,
      nbar = sumN / window.length;
    let C = 0;
    for (const j of window) C += base[j] * (events[j] / base[j] - m) ** 2;
    const a = Math.max(0, C / sumN - m / nbar);
    const r = e / base[i];
    if (a === 0 && m === 0) return m;
    return m + (r - m) * (a / (a + m / base[i]));
  });
}

/** The window rate: Σ events / Σ base over each area and its neighbors. */
export function spatialRate(events, base, rows) {
  return events.map((e, i) => {
    if (!usable(e, base[i])) return null;
    let sumE = 0,
      sumN = 0;
    for (const j of [i, ...rows[i]])
      if (usable(events[j], base[j])) {
        sumE += events[j];
        sumN += base[j];
      }
    return sumE / sumN;
  });
}

/** Exact Poisson 95% limits for each rate, on the rate's scale. */
export function rateLimits(events, base, scale = 1, level = 0.95) {
  return events.map((e, i) => {
    // Exact limits need whole-number counts.
    if (!usable(e, base[i]) || !Number.isInteger(e)) return null;
    const [lo, hi] = poissonCI(e, level);
    return [(lo / base[i]) * scale, (hi / base[i]) * scale];
  });
}

/** NCHS's rule: a rate on fewer than 20 events is unstable. */
export const UNSTABLE_EVENTS = 20;

/**
 * The reliability of an ACS estimate from its 90% margin of error: the
 * coefficient of variation (MOE / 1.645 / estimate) under 12% is high, 12–40%
 * medium, over 40% low.
 */
export function acsReliability(estimate, moe, level = 90) {
  if (!Number.isFinite(estimate) || !Number.isFinite(moe)) return null;
  if (estimate === 0) return moe === 0 ? "high" : "low";
  const z = level === 95 ? 1.96 : level === 99 ? 2.576 : 1.645;
  const cv = moe / z / Math.abs(estimate);
  return cv < 0.12 ? "high" : cv <= 0.4 ? "medium" : "low";
}

/** A rate spec made safe: { kind: "rate", measure, methods } with known methods. */
export function rateSpec(spec) {
  if (spec?.kind !== "rate" || typeof spec.measure !== "string" || !spec.measure) return null;
  const methods = [...new Set((spec.methods || []).filter((m) => RATE_METHODS[m]))];
  return methods.length ? { kind: "rate", measure: spec.measure, methods } : null;
}

/**
 * The fields a rate spec adds to a layer's features: { fields, extraFields,
 * values } where values[name] lines up with the features. `info` is the
 * measure's metadata and `pool` its numerator, denominator and scale; `rows`
 * are contiguity neighbors by feature index (for the spatial methods).
 */
export function rateFields(features, spec, { info, pool, label, rows }) {
  const events = features.map((f) => f.properties?.[pool.numerator] ?? null);
  const base = features.map((f) => f.properties?.[pool.denominator] ?? null);
  const scale = pool.scale ?? 1,
    unit = info?.unit,
    format = info?.format || "number";
  const out = { fields: [], extraFields: {}, values: {} };
  const add = (name, meta, values) => {
    out.fields.push(name);
    out.extraFields[name] = { ...meta, derivedFrom: spec.measure };
    out.values[name] = values.map((v) => (v == null || !Number.isFinite(v) ? null : v));
  };
  const scaled = (values) => values.map((v) => (v == null ? null : v * scale));
  for (const method of spec.methods) {
    const name = RATE_METHODS[method].prefix + spec.measure;
    const meta = { label: label + ": " + RATE_METHODS[method].label, format, unit, smoothed: method !== "er" && method !== "ci" };
    if (method === "eb") add(name, meta, scaled(empiricalBayes(events, base).estimates));
    else if (method === "seb" && rows) add(name, meta, scaled(spatialEmpiricalBayes(events, base, rows)));
    else if (method === "sr" && rows) add(name, meta, scaled(spatialRate(events, base, rows)));
    else if (method === "er") add(name, { label: label + ": excess risk (observed ÷ expected)", format: "number" }, excessRisk(events, base));
    else if (method === "ci") {
      const limits = rateLimits(events, base, scale);
      add("lcl_" + spec.measure, { label: label + ": lower 95% limit (exact Poisson)", format, unit }, limits.map((x) => x?.[0]));
      add("ucl_" + spec.measure, { label: label + ": upper 95% limit (exact Poisson)", format, unit }, limits.map((x) => x?.[1]));
    }
  }
  return out;
}
