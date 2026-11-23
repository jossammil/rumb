// The workspace state: what a saved project records, its defaults, and how a
// state from an older project (Field Atlas, before the rename) is brought up to date.
import { referenceLayer, starterSQL } from "../catalog/catalog.js";
import { normalizeStack, stackEntry } from "./stack.js";

/** Settings each map layer remembers when you switch away from it and back. */
export const LAYER_VIEW_KEYS = [
  "measure",
  "category",
  "palette",
  "classification",
  "count",
  "breaks",
  "method",
  "inference",
  "yField",
  "scan",
  "model",
  "rule",
  "k",
  "band",
  "power",
  "symmetric",
  "study",
  "permutations",
  "seed",
  "fdr",
  "selected",
  "picks",
  "result",
  "mode",
  "inspector",
];

export function defaults(catalog) {
  const ref = referenceLayer(catalog);
  return {
    view: "map",
    region: catalog.region.id,
    active: ref.id,
    measure: ref.measures[0],
    // A text field to color by instead of a measure (null: color by the measure).
    category: null,
    palette: "Lagoon",
    classification: "quantile",
    count: 5,
    // Manual class breaks, used when classification is "manual".
    breaks: null,
    // Spatial weights: queen or rook contiguity, or k nearest (k), a distance
    // band (band, in miles; null finds the smallest that leaves no area alone)
    // or inverse distance within that band (power 1 or 2). See stats/neighbors.js.
    // The analysis to run (stats/methods.js).
    method: "lisa",
    // How hot spot p-values are found: the normal approximation or permutations.
    inference: "normal",
    // The second measure for bivariate clusters (its neighbors' values).
    yField: null,
    // Spatial scan windows: the largest share of the population, an optional
    // radius in miles, and whether to look for high rates, low or both.
    scan: { maxPop: 0.25, maxMiles: null, direction: "high" },
    // Regression: the model type and its covariates (the measure is the outcome).
    model: { type: "ols", xs: [] },
    rule: "queen",
    k: 6,
    band: null,
    power: 1,
    symmetric: false,
    study: "all",
    permutations: 999,
    seed: 12345,
    fdr: false,
    selected: null,
    // More selected features (Shift-click), for pooled measures and buffers.
    picks: [],
    result: null,
    mode: "value",
    inspector: false,
    sql: starterSQL(ref),
    layers: [],
    layerViews: {},
    comparisons: {},
    compareLayer: null,
    graticule: false,
    // Layers drawn on the map, bottom to top (core/stack.js); `active` is the focus.
    stack: [stackEntry(ref.id)],
    // Census roads draw above area fills, or below them.
    roads: "above",
    // The spatial filter (geo/filter.js) and whether features outside it are dimmed or hidden.
    filter: null,
    filterMode: "dim",
  };
}

/** Defaults for a layer's view settings, with its preferred measure. */
export function layerViewDefaults(catalog, measure) {
  const all = defaults(catalog);
  const view = Object.fromEntries(LAYER_VIEW_KEYS.map((k) => [k, all[k]]));
  view.measure = measure;
  return view;
}

/**
 * A saved state merged over today's defaults. Query layers saved before the
 * rename used `tracts` and `baseMeasures` for what are now `reference` and
 * `referenceFields`; the map camera travels separately.
 */
/**
 * The data fields a state names: each layer view's measure and second
 * variable, and Compare's components. Restores use it to read the tables those
 * fields come from before drawing.
 */
export function stateFields(state) {
  const views = [state, ...Object.values(state?.layerViews || {})];
  const fields = views.flatMap((v) => [v?.measure, v?.yField]);
  for (const config of Object.values(state?.comparisons || {}))
    for (const c of config?.components || []) fields.push(c?.field);
  return [...new Set(fields.filter((f) => typeof f === "string" && f))];
}

export function normalizeState(saved, catalog, isLibraryLayer = () => false) {
  const { camera, mapCamera, ...rest } = saved;
  const state = { ...defaults(catalog), ...rest };
  state.region = catalog.region.id;
  state.layers = (state.layers || []).map(({ tracts, baseMeasures, ...layer }) => ({
    ...layer,
    reference: layer.reference ?? !!tracts,
    referenceFields: layer.referenceFields ?? !!baseMeasures,
  }));
  state.layerViews ||= {};
  state.comparisons ||= {};
  // Projects saved before layers could stack drew only the active layer.
  const known = new Set([referenceLayer(catalog).id, ...state.layers.map((l) => l.id)]);
  state.stack = normalizeStack(
    saved.stack ?? [stackEntry(state.active)],
    state.active,
    (id) => known.has(id) || isLibraryLayer(id),
  );
  return state;
}
