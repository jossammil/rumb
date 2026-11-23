// The workspace state: what a saved project records, its defaults, and how a
// state from an older project (Field Atlas, before the rename) is brought up to date.
import { referenceLayer, starterSQL } from "../catalog/catalog.js";

/** Settings each map layer remembers when you switch away from it and back. */
export const LAYER_VIEW_KEYS = [
  "measure",
  "palette",
  "classification",
  "count",
  "rule",
  "study",
  "permutations",
  "seed",
  "fdr",
  "selected",
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
    palette: "Lagoon",
    classification: "quantile",
    count: 5,
    rule: "queen",
    study: "all",
    permutations: 999,
    seed: 12345,
    fdr: false,
    selected: null,
    result: null,
    mode: "value",
    inspector: false,
    sql: starterSQL(ref),
    layers: [],
    layerViews: {},
    comparisons: {},
    compareLayer: null,
    graticule: false,
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
export function normalizeState(saved, catalog) {
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
  return state;
}
