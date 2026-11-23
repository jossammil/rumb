// The analysis methods the "Spatial analysis" section runs, and how each one's
// result reads everywhere it shows: the map's classes and legend, the
// inspector's feature rows and summary, the statistics CSV, the PNG note and
// the report. A result names its method; one without (saved before methods
// existed) is a Local Moran result. Pure.
import { number } from "../catalog/format.js";
import { clusters } from "../map/classify.js";

const fixed = (v, d = 4) => (v == null || !Number.isFinite(v) ? "" : number(v, d));

/** CSV columns every method shares, after its own. */
const SHARED_CSV = ["eligible_neighbors", "reason", "study_area", "neighbor_rule", "permutations", "seed", "alpha", "FDR_applied", "method"];
const sharedRow = (record, result, rule) => [
  record.neighbors.join(" "),
  record.reason,
  result.studyName,
  result.weights?.label || rule,
  result.permutations,
  result.seed,
  result.alpha,
  result.fdr,
  result.methodNote || result.method,
];

export const METHODS = {
  lisa: {
    id: "lisa",
    label: "Clusters and outliers (Local Moran)",
    title: "Cluster analysis",
    legendTitle: "Local Moran clusters",
    modeLabel: "Clusters",
    short: "clusters",
    request: "analyze",
    file: "spatial-clusters.csv",
    /** Map classes: key → [label, color]; NS and NA take the theme's neutral colors. */
    classes: () => clusters,
    /** The keys a compact legend shows for a layer that is not the focus. */
    swatches: ["HH", "LL", "HL", "LH"],
    classOf: (record) => record?.cluster ?? "NA",
    featureRows: (record) => [
      ["Local Moran’s I", fixed(record.localI)],
      ["Permutation p", fixed(record.p)],
      ["FDR q", fixed(record.q)],
      ["Classification", clusters[record.cluster][0]],
    ],
    summaryRows: (result) => [
      ["Global Moran’s I", fixed(result.globalI)],
      ["Permutation p", fixed(result.globalP)],
      ["Eligible areas", number(result.n, 0)],
    ],
    /** One line for the report's summary table. */
    reportText: (result) =>
      "Global Moran's I " + fixed(result.globalI) + " · p " + fixed(result.globalP) + " · " + result.studyName,
    /** What the significance rule was, for notes under the map. */
    rule: (result) => (result.fdr ? "FDR q" : "p") + " ≤ " + (result.alpha ?? 0.05),
    csvFields: [
      "GEOID_or_feature_ID",
      "measure",
      "value",
      "z",
      "neighbor_mean_z",
      "local_I",
      "permutation_p",
      "FDR_q",
      "cluster",
      ...SHARED_CSV.slice(0, 4),
      "global_I",
      "global_p",
      ...SHARED_CSV.slice(4),
    ],
    csvRow: (id, r, result, state) => {
      const shared = sharedRow(r, result, state.rule);
      return [
        id,
        state.measure,
        r.value,
        r.z,
        r.lag,
        r.localI,
        r.p,
        r.q,
        r.cluster,
        ...shared.slice(0, 4),
        result.globalI,
        result.globalP,
        ...shared.slice(4),
      ];
    },
    scatter: true,
    reading: true,
  },
};

/** The methods in the order the menu lists them. */
export const METHOD_LIST = Object.values(METHODS);

/** The method that made a result (Local Moran for results saved before methods). */
export const methodOf = (result) => METHODS[result?.method] || METHODS.lisa;

/** A known method id, or "lisa". */
export const methodId = (id) => (METHODS[id] ? id : "lisa");
